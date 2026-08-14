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
    /** Tem lápide de exclusão: invisível no app e bloqueando a reentrada. */
    | 'excluido-pode-reincluir'
    /** Documento cancelado — está aqui, mas fora dos totais por natureza. */
    | 'ja-esta-cancelado';

export interface DocumentoExistente {
    empresaId?: string | null;
    empresaNome?: string | null;
    empresaCnpj?: string | null;
    origem?: string | null;
    status?: string | null;
    importadoEm?: string | null;
    importadoPorEmail?: string | null;
    _deleted?: boolean;
    _merged_into?: string | null;
}

export interface LeituraDuplicado {
    situacao: SituacaoDuplicado;
    /** Deve o app GRAVAR mesmo assim? Só a lápide libera. */
    permiteReincluir: boolean;
    /** Vermelho quando alguém precisa fazer alguma coisa. */
    exigeAcao: boolean;
    /** Uma frase, com os três dados que faltavam: onde, quando, por qual trilho. */
    mensagem: string;
    /** O que fazer — null quando realmente não há nada a fazer. */
    acao: string | null;
}

const texto = (v: unknown): string => String(v ?? '').trim();
const soDigitos = (v: unknown): string => texto(v).replace(/\D/g, '');

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

    // A LÁPIDE VEM PRIMEIRO: documento excluído está invisível na lista de XMLs
    // (todo enumerador filtra `_deleted`) e ao mesmo tempo bloqueia a
    // reimportação. Chamar isso de "duplicado" é o que fecha o beco — aqui
    // reimportar é a ação CERTA, e o nome dela é reinclusão.
    if (d._deleted) {
        return {
            situacao: 'excluido-pode-reincluir',
            permiteReincluir: true,
            exigeAcao: false,
            mensagem: `Estava EXCLUÍDO (${dono}, ${carimbo}) — reincluído agora a partir deste arquivo.`,
            acao: null,
        };
    }

    // Empresa diferente: o caso caro. A nota existe, mas a apuração da empresa
    // certa fica a menor e nada na tela denuncia isso.
    const mesmaEmpresa = (texto(d.empresaId) && texto(d.empresaId) === texto(empresaEscolhida.id))
        || (soDigitos(d.empresaCnpj) && soDigitos(d.empresaCnpj) === soDigitos(empresaEscolhida.cnpj));
    if (!mesmaEmpresa) {
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
            mensagem: `Já está aqui (${dono}, ${carimbo}) e está CANCELADA — por isso fica fora dos totais.`,
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
