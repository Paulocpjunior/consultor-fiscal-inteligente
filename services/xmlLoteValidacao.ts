/**
 * xmlLoteValidacao.ts — PURO (sem rede/DOM), testável.
 *
 * Antes de importar XML (avulso ou ZIP), conferir se o arquivo é MESMO da
 * empresa escolhida na tela. O combo vinha pré-selecionado com a primeira
 * empresa da lista: bastava arrastar o ZIP sem reparar no seletor para o lote
 * inteiro ser lançado no cliente errado — "cruzamento de informações
 * desencontradas" (Paulo, 27/07). Aqui saem os dados para a tela de
 * confirmação: de quem são os XMLs, quantos batem com a empresa escolhida e
 * qual empresa cadastrada é a dona de verdade.
 */
// 🚨 A NFS-e do padrão NACIONAL tem DONO, e é ele que responde aqui — não uma
// quarta leitura própria. Ver o comentário de `extrairDadosXml` abaixo.
import { ehNfseNacional, lerNfseNacional } from '../sefaz-backend/nfse-nacional-leitura.js';

/** Raiz (8 primeiros dígitos) do CNPJ — matriz e filiais compartilham. */
export function raizCnpj(cnpj: string | null | undefined): string {
    return String(cnpj || '').replace(/\D/g, '').slice(0, 8);
}

function soDigitos(v: string | null | undefined): string {
    return String(v || '').replace(/\D/g, '');
}

export interface DadosXml {
    /** CNPJ/CPF do emitente (14 ou 11 dígitos), quando identificável. */
    emit: string | null;
    /** CNPJ/CPF do destinatário. */
    dest: string | null;
    /** Chave do documento, quando presente — 44 dígitos na NF-e/CT-e e **50**
     *  na NFS-e do padrão nacional. Recortar em 44 daria chave inexistente. */
    chave: string | null;
}

/**
 * Extrai emitente/destinatário/chave de um XML de NF-e/NFC-e sem parser DOM
 * (o lote pode ter milhares de arquivos; regex é ordens de grandeza mais
 * barato e aqui só precisamos identificar as partes).
 */
export function extrairDadosXml(xml: string): DadosXml {
    const txt = String(xml || '');

    // 🚨 QUARTA VEZ DA MESMA CLASSE — e desta vez a empresa era a TOMADORA
    // (03/09, Paulo, GOLDLOG 17.390.490/0001-82: *"o CFI voltou a não
    // reconhecer as notas de serviços tomados, pois está considerando o CNPJ do
    // prestador em vez do CNPJ da empresa como tomadora"*). O modal dizia
    // *"Nenhum dos 4 XMLs é desta empresa — são do CNPJ 33.105.122/0001-00"*,
    // e o botão Importar nem existia.
    //
    // 🔴 A CAUSA: no leiaute NACIONAL o tomador é **`<toma>`**, e esta leitura
    // conhecia `<dest>`, `<rem>` e os blocos do ABRASF — nenhum deles. Como o
    // nacional TAMBÉM traz `<emit>` (o prestador é o emitente), o `emit` saía
    // preenchido e o `dest` VAZIO: a tela via só o prestador e concluía que o
    // arquivo era de outra empresa. É o mesmo defeito do CT-e (19/08, `<rem>`)
    // e do ABRASF (31/08, `<PrestadorServico>`), no leiaute que entrou em
    // 01/09 — três correções pontuais e a quarta forma ficou de fora.
    //
    // ✂️ POR ISSO ELA DEIXOU DE SER UMA LEITURA PRÓPRIA E PASSOU A DELEGAR: o
    // dono do leiaute nacional é `nfse-nacional-leitura.js` — o MESMO que o
    // `xmlParserService` (quem de fato importa) usa desde 01/09, e que já sabe
    // que o prestador é `<emit>`, o tomador é `<toma>` e a chave tem 50
    // caracteres. Corrigir a tag aqui fecharia a INSTÂNCIA e deixaria a classe
    // aberta pela quinta vez; delegar faz a tela aprender junto com o
    // importador, que é a única forma de as duas pararem de divergir.
    if (ehNfseNacional(txt)) {
        const lida: any = lerNfseNacional(txt);
        return {
            emit: soDigitos(lida?.prestador?.cnpjCpf) || null,
            dest: soDigitos(lida?.tomador?.cnpjCpf) || null,
            // ⚠️ A chave do nacional tem 50 caracteres, não 44 — ela sai como o
            // dono a lê. Recortá-la em 44 daria uma chave que não existe.
            chave: String(lida?.chave || '') || null,
        };
    }

    const bloco = (tag: 'emit' | 'dest' | 'rem'): string | null => {
        const m = txt.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
        if (!m) return null;
        const doc = m[1].match(/<(CNPJ|CPF)>\s*([\d.\-/]+)\s*<\/\1>/i);
        return doc ? soDigitos(doc[2]) : null;
    };
    const chaveMatch = txt.match(/(?:Id\s*=\s*"?(?:NFe|CTe)|<ch(?:NFe|CTe)>\s*)(\d{44})/i);
    const chave = chaveMatch ? chaveMatch[1] : null;
    // Sem bloco <emit> (resumo/evento), o emitente ainda sai da chave:
    // posições 7-20 (índices 6..20) são o CNPJ de quem emitiu.
    const emit = bloco('emit') || (chave ? chave.slice(6, 20) : null);
    // 🚨 CT-e: o REMETENTE é a contraparte principal, não o <dest> — o mesmo
    // backend que importa o arquivo (parseCTeXml, services/xmlParserService.ts)
    // já faz essa troca ("CT-e usa remetente como contraparte principal no
    // campo destinatário"). Esta era uma SEGUNDA leitura do mesmo XML, sem essa
    // regra — a A CASTELLANO aparecia como "0 de 6 XMLs desta empresa" na
    // tela de confirmação, e o botão Importar nem chegava a existir, mesmo o
    // backend estando pronto pra aceitar (caso real, 19/08: ela é a `<rem>`
    // do CT-e, não o `<dest>`, que é o destinatário FINAL da mercadoria — só
    // o transportador e o pagador do frete têm a ver com o cliente). Para
    // NF-e a tag `<rem>` não existe, então isto nunca muda nada nela.
    const dest = bloco('rem') || bloco('dest');
    // 🚨 NFS-e NÃO TEM <emit>/<dest> — e por isso o lote de Santo André saiu
    // como "1 sem CNPJ legível · 0 desta empresa", com a tela GRITANDO
    // *"Arquivo não é desta empresa"* sobre um arquivo que é dela (31/08,
    // MARCOS ANTONIO ZAMBOLIN INFORMATICA).
    //
    // O padrão ABRASF põe as partes em <PrestadorServico>/<TomadorServico> (ou
    // <Prestador>/<Tomador>), com o documento dentro de <IdentificacaoX> e, na
    // v2, embrulhado mais uma vez em <CpfCnpj>. O `xmlParserService` — o
    // backend que de fato importa — já lê todas essas formas desde sempre;
    // esta era a SEGUNDA leitura do mesmo XML, sem elas. É exatamente o que
    // aconteceu com o CT-e em 19/08, um bloco acima.
    //
    // ⚠️ A busca é pelo bloco INTEIRO e pega o primeiro CNPJ/CPF que ele
    // contiver: as três gerações do leiaute aninham diferente, e casar a
    // estrutura exata faria a próxima prefeitura cair no mesmo silêncio.
    const blocoServico = (tags: string[]): string | null => {
        for (const tag of tags) {
            const m = txt.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
            if (!m) continue;
            const doc = m[1].match(/<(Cnpj|Cpf|CNPJ|CPF)>\s*([\d.\-/]+)\s*<\/\1>/i);
            if (doc) return soDigitos(doc[2]);
        }
        return null;
    };
    // No serviço, quem "emite" é o PRESTADOR e quem "recebe" é o TOMADOR — o
    // mesmo par que o importador usa para decidir a direção.
    const emitFinal = emit || blocoServico(['PrestadorServico', 'Prestador', 'IdentificacaoPrestador']);
    const destFinal = dest || blocoServico(['TomadorServico', 'Tomador', 'IdentificacaoTomador']);
    return { emit: emitFinal, dest: destFinal, chave };
}

export interface ResumoLote {
    total: number;
    /** CNPJ do emitente → quantidade. */
    porEmitente: Record<string, number>;
    /** CNPJ do destinatário → quantidade. */
    porDestinatario: Record<string, number>;
    /**
     * "emit|dest" → quantidade. Guarda o PAR de cada nota: sem isso não dá pra
     * contar direito a nota em que a empresa é a destinatária (entrada) —
     * contar emitente e destinatário em listas separadas duplica ou perde.
     */
    pares: Record<string, number>;
    /** XMLs em que não deu para identificar nenhuma das pontas. */
    semIdentificacao: number;
}

export function resumirLoteXmls(xmls: string[]): ResumoLote {
    const resumo: ResumoLote = { total: 0, porEmitente: {}, porDestinatario: {}, pares: {}, semIdentificacao: 0 };
    for (const xml of xmls || []) {
        resumo.total++;
        const d = extrairDadosXml(xml);
        if (d.emit) resumo.porEmitente[d.emit] = (resumo.porEmitente[d.emit] || 0) + 1;
        if (d.dest) resumo.porDestinatario[d.dest] = (resumo.porDestinatario[d.dest] || 0) + 1;
        if (!d.emit && !d.dest) { resumo.semIdentificacao++; continue; }
        const chave = `${d.emit || ''}|${d.dest || ''}`;
        resumo.pares[chave] = (resumo.pares[chave] || 0) + 1;
    }
    return resumo;
}

export interface EmpresaConhecida {
    id: string;
    nome: string;
    cnpj: string;
}

export interface DonoProvavel {
    cnpj: string;
    qtd: number;
    /** Empresa cadastrada com essa raiz de CNPJ, se houver. */
    empresa: EmpresaConhecida | null;
}

export interface ValidacaoLote {
    total: number;
    /** XMLs em que a empresa escolhida aparece como emitente ou destinatário. */
    compativeis: number;
    /** Dos compatíveis: quantos ela emitiu (saída) e quantos recebeu (entrada). */
    comoEmitente: number;
    comoDestinatario: number;
    /** XMLs que não têm nada a ver com a empresa escolhida. */
    incompativeis: number;
    semIdentificacao: number;
    /** Quem realmente aparece nos arquivos incompatíveis (maior primeiro). */
    donosProvaveis: DonoProvavel[];
    /** Nenhum arquivo bate: importar aqui é erro certo. */
    bloquear: boolean;
    /**
     * 🚨 NENHUM XML pôde ser LIDO — e isso NÃO é "não é desta empresa".
     * Sem este campo o modal cairia no verde "✓ Confirmar importação" sobre uma
     * conferência que não aconteceu: ausência de alarme não pode ser
     * indistinguível de "está tudo certo" (22/08).
     */
    naoConferido: boolean;
    /** Frase pronta pra tela — sempre com a AÇÃO. */
    mensagem: string;
}

/**
 * Cruza o lote com a empresa escolhida. Compatível = a raiz do CNPJ da empresa
 * aparece como emitente OU destinatário (raiz cobre filial, mesmo critério da
 * captura).
 */
export function validarLoteParaEmpresa(
    resumo: ResumoLote,
    empresaCnpj: string,
    empresas: EmpresaConhecida[] = [],
): ValidacaoLote {
    const raizAlvo = raizCnpj(empresaCnpj);
    let compativeis = 0;
    let comoEmitente = 0;
    let comoDestinatario = 0;
    const foraPorCnpj: Record<string, number> = {};

    // Conta POR NOTA (par emit|dest): a nota de ENTRADA tem emitente de
    // terceiro e a empresa no destinatário — contar as duas listas separadas
    // fazia o fornecedor virar "dono provável" de uma nota que é da empresa.
    for (const [par, qtd] of Object.entries(resumo.pares)) {
        const [emit, dest] = par.split('|');
        const ehEmit = !!emit && raizCnpj(emit) === raizAlvo;
        const ehDest = !!dest && raizCnpj(dest) === raizAlvo;
        if (ehEmit || ehDest) {
            compativeis += qtd;
            if (ehEmit) comoEmitente += qtd; else comoDestinatario += qtd;
        } else {
            // Só nota que NÃO é da empresa aponta um dono alheio (pelo emitente,
            // que é quem define a posse da saída).
            const alheio = emit || dest;
            if (alheio) foraPorCnpj[alheio] = (foraPorCnpj[alheio] || 0) + qtd;
        }
    }

    const porRaiz = new Map<string, EmpresaConhecida>();
    for (const e of empresas || []) {
        const r = raizCnpj(e.cnpj);
        if (r && !porRaiz.has(r)) porRaiz.set(r, e);
    }
    const donosProvaveis: DonoProvavel[] = Object.entries(foraPorCnpj)
        .map(([cnpj, qtd]) => ({ cnpj, qtd, empresa: porRaiz.get(raizCnpj(cnpj)) || null }))
        .sort((a, b) => b.qtd - a.qtd)
        .slice(0, 5);

    const incompativeis = Math.max(0, resumo.total - compativeis - resumo.semIdentificacao);
    // 🚨 "NÃO É DESTA EMPRESA" ≠ "NÃO CONSEGUI LER" — e a tela afirmava o
    // primeiro sobre o segundo (31/08, NFS-e de Santo André). Quem lê o alarme
    // vai conferir o CADASTRO DO CLIENTE, que está certo, e o arquivo, que
    // também está: a primeira parada errada, sobre um arquivo legítimo.
    //
    // ⚠️ Ilegível não bloqueia porque a tela NÃO É a autoridade — quem decide a
    // posse é o backend (`documento-posse`, que tem até o caso
    // `posse-indeterminada`). Bloquear aqui é a tela recusando o que o servidor
    // aceita, que é literalmente o defeito do CT-e da A CASTELLANO (19/08).
    const tudoIlegivel = resumo.total > 0 && resumo.semIdentificacao === resumo.total;
    const bloquear = resumo.total > 0 && compativeis === 0 && !tudoIlegivel;

    let mensagem: string;
    if (resumo.total === 0) {
        mensagem = 'Nenhum XML encontrado nos arquivos.';
    } else if (tudoIlegivel) {
        mensagem = `Não consegui LER o CNPJ ${resumo.total > 1 ? `de nenhum dos ${resumo.total} XMLs` : 'deste XML'} `
            + '— o que NÃO quer dizer que o arquivo seja de outra empresa. Pode ser um leiaute de NFS-e que '
            + 'esta pré-conferência ainda não conhece (cada prefeitura tem o seu). '
            + 'Quem decide de quem é o documento é o servidor, na importação: pode importar, e se ele for '
            + 'mesmo de outro CNPJ a importação recusa NOMEANDO o dono.';
    } else if (bloquear) {
        const dono = donosProvaveis[0];
        const deQuem = dono
            ? (dono.empresa
                ? `são de ${dono.empresa.nome} (${dono.cnpj})`
                : `são do CNPJ ${dono.cnpj}, que NÃO está cadastrado`)
            : 'não trazem o CNPJ desta empresa';
        mensagem = `Nenhum dos ${resumo.total} XMLs é desta empresa — ${deQuem}. `
            + (dono?.empresa
                ? 'Troque a empresa selecionada antes de importar.'
                : 'Confira o arquivo e o cadastro do cliente antes de importar.');
    } else if (incompativeis > 0) {
        mensagem = `${compativeis} de ${resumo.total} XMLs são desta empresa; ${incompativeis} são de outro CNPJ e serão RECUSADOS pelo importador. `
            + 'Confirme se o arquivo é o certo (ou importe o restante depois, na empresa dona).';
    } else if (resumo.semIdentificacao > 0) {
        mensagem = `${compativeis} XMLs desta empresa; ${resumo.semIdentificacao} sem CNPJ identificável (o servidor decide na importação).`;
    } else {
        const detalhe = comoEmitente && comoDestinatario
            ? `${comoEmitente} de saída (ela emitiu) e ${comoDestinatario} de entrada (ela recebeu)`
            : comoEmitente ? 'todos de saída (ela emitiu)' : 'todos de entrada (ela recebeu)';
        mensagem = `Todos os ${resumo.total} XMLs são desta empresa — ${detalhe}.`;
    }

    return {
        total: resumo.total,
        compativeis,
        comoEmitente,
        comoDestinatario,
        incompativeis,
        semIdentificacao: resumo.semIdentificacao,
        donosProvaveis,
        bloquear,
        naoConferido: tudoIlegivel,
        mensagem,
    };
}
