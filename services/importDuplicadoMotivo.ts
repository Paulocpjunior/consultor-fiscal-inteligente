/**
 * importDuplicadoMotivo — por que aquele XML não entrou.
 *
 * ═══ O BECO QUE ISTO RESOLVE ════════════════════════════════════════════════
 *
 * Paulo, 14/08, com 12 arquivos na tela: *"0 ok, 12 duplicado(s)"* e, linha a
 * linha, `Já importado (chave 3526…)`. A frase é VERDADE e mesmo assim não
 * serve para nada: ela não diz **em qual empresa** o documento está, **quando**
 * entrou, **por qual trilho**, nem se ele está **visível** no app. Sem isso,
 * "já importado" é um beco — e a saída que sobra para a pessoa é repetir o
 * clique, que nunca vai mudar de resposta.
 *
 * É a mesma régua do resto da casa: **a causa vai junto do número**. Um alarme
 * que não diz o que fazer é alarme que a equipe aprende a ignorar.
 *
 * ═══ AS TRÊS SITUAÇÕES TÊM AÇÕES OPOSTAS ════════════════════════════════════
 *
 * 1. **Está aqui mesmo** — nada a fazer; o documento aparece na lista de XMLs.
 *    Se ele não aparece na APURAÇÃO, o problema é outro (regime, pendência,
 *    dedup do art. 136) e reimportar não toca nisso.
 * 2. **Está em OUTRA empresa** — reimportar NÃO move a nota de dona. É o caso
 *    caro: a nota existe, mas na empresa errada, e a apuração da certa fica a
 *    menor sem ninguém ver.
 * 3. **Está com lápide de exclusão** — aí ele está invisível no app E bloqueia
 *    a reentrada, que é o pior dos dois mundos. Esse é o único caso em que
 *    reimportar É a ação certa, e por isso ele não é "duplicado": é REINCLUSÃO.
 *
 * Módulo PURO: recebe o que o banco devolveu e a empresa escolhida, e devolve a
 * leitura. Sem Firebase, sem fetch — a decisão se testa sozinha.
 */

export type SituacaoDuplicado =
    /** Mesma empresa, documento vivo. Nada a fazer aqui. */
    | 'ja-esta-nesta-empresa'
    /** Gravado em OUTRA empresa — reimportar não corrige a dona. */
    | 'em-outra-empresa'
    /** As DUAS empresas são partes do documento: saída de uma, entrada da outra. */
    | 'contraparte-na-carteira'
    /** Tem lápide de exclusão: invisível no app e bloqueando a reentrada. */
    | 'excluido-pode-reincluir'
    /**
     * O que está no banco é RESUMO/incompleto e o arquivo é a NF-e COMPLETA —
     * importar aqui é UPGRADE, não duplicidade (caso PWR, 19/08).
     */
    | 'resumo-pode-completar'
    /** Documento cancelado — está aqui, mas fora dos totais por natureza. */
    | 'ja-esta-cancelado';

import { decidirPosseDocumento } from '../sefaz-backend/documento-posse.js';
// A régua de upgrade mora no módulo PURO (não no xml-importer, que puxa
// firebase-admin e não entra no bundle do navegador).
import { decidirGravacaoNFe } from '../sefaz-backend/gravacao-nfe-regua.js';

export interface DocumentoExistente {
    empresaId?: string | null;
    /** Partes do documento — é delas que sai "as duas empresas estão certas". */
    cnpjEmit?: string | null;
    cnpjDest?: string | null;
    emitente?: any;
    destinatario?: any;
    empresaNome?: string | null;
    empresaCnpj?: string | null;
    origem?: string | null;
    status?: string | null;
    importadoEm?: string | null;
    importadoPorEmail?: string | null;
    _deleted?: boolean;
    _merged_into?: string | null;
    /** Campos que a régua de upgrade lê (resumo × completa × incompleto). */
    schema?: string | null;
    tipoDoc?: string | null;
    temItens?: boolean | null;
    chave?: string | null;
    competencia?: string | null;
    dhEmi?: string | null;
    valorTotal?: number | null;
    eventosBeforeNFe?: boolean | null;
}

export interface LeituraDuplicado {
    situacao: SituacaoDuplicado;
    /** Deve o app GRAVAR mesmo assim? Só a lápide libera. */
    permiteReincluir: boolean;
    /**
     * O que está no banco é RESUMO/incompleto — gravar a COMPLETA é upgrade,
     * com MERGE (preserva os eventos que o resumo já recebeu). Decidido pela
     * MESMA régua do importer do backend (`decidirGravacaoNFe`), nunca por
     * uma cópia local.
     */
    permiteCompletar?: boolean;
    /** Vermelho quando alguém precisa fazer alguma coisa. */
    exigeAcao: boolean;
    /** Uma frase, com os três dados que faltavam: onde, quando, por qual trilho. */
    mensagem: string;
    /** O que fazer — null quando realmente não há nada a fazer. */
    acao: string | null;
}

const texto = (v: unknown): string => String(v ?? '').trim();
const soDigitos = (v: unknown): string => texto(v).replace(/\D/g, '');

/**
 * O documento está ESCONDIDO do app?
 *
 * ═══ A RÉGUA DA IMPORTAÇÃO TEM QUE SER A MESMA DA LISTAGEM ══════════════════
 *
 * Existe mais de uma lápide, e TODAS tiram o documento da vista: todo
 * enumerador do app filtra `_merged_into` **e** `_deleted`. A primeira versão
 * desta correção olhou só o `_deleted` — então quem excluiu pelo outro caminho
 * continuou preso exatamente no mesmo lugar: o documento invisível no app E
 * bloqueando a reentrada (Paulo, 14/08, na segunda vez que teve que apontar o
 * mesmo problema).
 *
 * Conferir lápide por lápide é a trava-escrita-como-LISTA de novo. A pergunta
 * certa é uma só — **este documento aparece no app?** — e ela se responde com a
 * MESMA função que a listagem usa. Lápide nova entra aqui, e os dois lados
 * mudam juntos.
 */
export function ocultoDoApp(d: DocumentoExistente | null | undefined): 'excluido' | 'mesclado' | null {
    if (!d) return null;
    if (d._deleted) return 'excluido';
    if (texto(d._merged_into)) return 'mesclado';
    return null;
}

/** Nome do trilho como a equipe fala dele, não como a coleção grava. */
const TRILHO: Record<string, string> = {
    sefaz: 'captura na SEFAZ',
    email: 'cofre de e-mail',
    manual: 'importação manual',
    autxml: 'autXML/cofre',
    conferencia: 'conferência por chaves',
    'consulta-chave': 'consulta por chave',
    csv: 'importação de CSV',
    pdf: 'importação de PDF',
};

const CANCELADOS = new Set(['cancelado', 'denegado']);

function quando(iso?: string | null): string {
    const s = texto(iso);
    if (!s) return 'data não registrada';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return 'data não registrada';
    return `em ${d.toLocaleDateString('pt-BR')}`;
}

function porQual(origem?: string | null): string {
    const o = texto(origem).toLowerCase();
    if (!o) return 'trilho não registrado';
    return TRILHO[o] || `trilho "${o}"`;
}

/**
 * Lê o documento que já estava lá e diz o que a pessoa precisa saber.
 *
 * @param existente  o que veio de `documentos_fiscais`
 * @param empresaEscolhida  a empresa selecionada na tela de importação
 */
export function lerDuplicado(
    existente: DocumentoExistente | null | undefined,
    empresaEscolhida: { id?: string | null; nome?: string | null; cnpj?: string | null },
): LeituraDuplicado {
    const d = existente || {};
    const dono = texto(d.empresaNome) || texto(d.empresaCnpj) || 'empresa não registrada no documento';
    const carimbo = `${quando(d.importadoEm)} · ${porQual(d.origem)}`;

    // A LÁPIDE VEM PRIMEIRO: documento escondido está invisível na lista de
    // XMLs e ao mesmo tempo bloqueia a reimportação — o pior dos dois mundos.
    // Chamar isso de "duplicado" é o que fecha o beco: aqui reimportar é a ação
    // CERTA, e o nome dela é reinclusão.
    //
    // Vale para QUALQUER lápide, não só a de exclusão — é a régua da listagem
    // que decide, não uma lista de campos escrita aqui.
    const oculto = ocultoDoApp(d);
    if (oculto) {
        return {
            situacao: 'excluido-pode-reincluir',
            permiteReincluir: true,
            exigeAcao: false,
            mensagem: oculto === 'mesclado'
                // Mesclado tem um detalhe que muda a leitura: ele foi juntado a
                // OUTRO documento, então reincluir pode ressuscitar uma
                // duplicata de verdade. A frase diz isso em vez de omitir.
                ? `Estava fora do app — MESCLADO no documento ${texto(d._merged_into)} (${dono}, ${carimbo}). `
                  + 'Reincluído agora a partir deste arquivo; confira se não passou a existir em duplicidade.'
                : `Estava EXCLUÍDO (${dono}, ${carimbo}) — reincluído agora a partir deste arquivo.`,
            acao: null,
        };
    }

    // Empresa diferente: o caso caro. A nota existe, mas a apuração da empresa
    // certa fica a menor e nada na tela denuncia isso.
    const mesmaEmpresa = (texto(d.empresaId) && texto(d.empresaId) === texto(empresaEscolhida.id))
        || (soDigitos(d.empresaCnpj) && soDigitos(d.empresaCnpj) === soDigitos(empresaEscolhida.cnpj));
    if (!mesmaEmpresa) {
        // 🚨 AS DUAS PODEM ESTAR CERTAS. Quando a empresa escolhida E a dona são
        // partes do documento (KROYA × GOLDLOG, 17/08), a nota é saída de uma e
        // entrada da outra — ninguém errou, e mandar "corrigir na origem" faria
        // o colaborador cobrar do cliente uma nota que está perfeita.
        //
        // O que impede a segunda escrituração é o CFI: o id do documento é a
        // CHAVE, então uma chave só comporta um dono. A frase DIZ isso, em vez
        // de culpar o cadastro ou o emissor.
        // A pergunta NÃO é "a empresa escolhida é parte?" — é "as DUAS são?".
        // Escolhida parte + dono que não é parte continua sendo posse errada, e
        // a primeira versão disto engoliu esse caso (pego pelo teste na hora).
        // Quem responde é a MESMA régua do importer, nunca uma cópia aqui.
        const posse = decidirPosseDocumento({
            existente: d,
            pretendente: { empresaId: empresaEscolhida.id, empresaCnpj: empresaEscolhida.cnpj },
            documento: d,
        });
        if (posse.situacao === 'contraparte-legitima') {
            return {
                situacao: 'contraparte-na-carteira',
                permiteReincluir: false,
                exigeAcao: true,
                mensagem: `Esta NF-e é da ${texto(empresaEscolhida.nome) || 'empresa selecionada'} TAMBÉM — ela é `
                    + `saída de uma das duas e entrada da outra. Hoje o documento está gravado em ${dono} `
                    + `(${carimbo}), e o CFI ainda guarda UM dono por chave.`,
                acao: 'Ninguém errou aqui: as duas empresas precisam escriturar. Enquanto a identidade do '
                    + 'documento não separa os dois lados, lance a nota que falta pelo ✍️ Lançar nota sem XML '
                    + 'DEIXANDO A CHAVE EM BRANCO (com a chave ela cai no mesmo documento) — e avise o time, '
                    + 'porque essa é para sair quando a correção subir.',
            };
        }
        return {
            situacao: 'em-outra-empresa',
            permiteReincluir: false,
            exigeAcao: true,
            mensagem: `Este XML já está gravado em OUTRA empresa: ${dono} (${carimbo}).`,
            // Reimportar não move a nota de dona — repetir o clique não muda a
            // resposta, e é justamente o que a mensagem antiga convidava a fazer.
            acao: `Reimportar não transfere a nota. Confira qual empresa é a dona correta — se for `
                + `${texto(empresaEscolhida.nome) || 'a selecionada'}, a nota precisa ser corrigida na origem, `
                + 'não reimportada.',
        };
    }

    if (CANCELADOS.has(texto(d.status).toLowerCase())) {
        return {
            situacao: 'ja-esta-cancelado',
            permiteReincluir: false,
            exigeAcao: false,
            // Cancelada fora dos totais é o comportamento CERTO — dizer isso
            // evita que alguém reimporte tentando "fazer o valor aparecer".
            // E cancelada VEM ANTES do upgrade de propósito: completar uma
            // cancelada não muda total nenhum, e reescrever o status dela pelo
            // caminho manual é risco sem ganho.
            mensagem: `Já está aqui (${dono}, ${carimbo}) e está CANCELADA — por isso fica fora dos totais.`,
            acao: null,
        };
    }

    // ═══ RESUMO × COMPLETA — o caso PWR (19/08) ═════════════════════════════
    //
    // O DistDFe entrega PRIMEIRO um resumo (resNFe, ~531 bytes, sem itens/nº);
    // a completa só vem depois da Ciência. Se a completa nunca veio, a nota
    // fica na base sem itens, sem CST, sem número — e quando a colaboradora
    // importava o XML completo por cima, este módulo respondia "já está aqui",
    // recusando exatamente o arquivo que consertaria tudo. O trilho automático
    // do backend SEMPRE fez esse upgrade (decidirGravacaoNFe); o manual do
    // navegador é que não conhecia a régua. Mesma régua, um lugar só.
    //
    // O que chega pela importação manual é sempre um XML completo parseado
    // (nfeProc/procCTe) — nunca um resumo —, então tipoDoc/schema de entrada
    // não são de resumo por construção.
    const dec = decidirGravacaoNFe({
        existingData: d,
        tipoDoc: 'NFe',
        schema: null,
        chave: texto(d.chave),
    });
    if (dec.upgrade) {
        return {
            situacao: 'resumo-pode-completar',
            permiteReincluir: false,
            permiteCompletar: true,
            exigeAcao: false,
            mensagem: `Estava na base como RESUMO/incompleto (${dono}, ${carimbo}) — sem itens, CST nem número. `
                + 'COMPLETADA agora a partir deste arquivo; os eventos já recebidos foram preservados.',
            acao: null,
        };
    }

    return {
        situacao: 'ja-esta-nesta-empresa',
        permiteReincluir: false,
        exigeAcao: false,
        mensagem: `Já está aqui (${dono}, ${carimbo}).`,
        // Não some da apuração por causa da importação — e mandar reimportar
        // seria mandar repetir o que não muda nada.
        acao: 'Se ela não aparece na apuração, o motivo é outro (regime, pendência de cadastro ou dedup do '
            + 'art. 136) — reimportar o XML não altera nada disso.',
    };
}
