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
    /** Chave de 44 dígitos, quando presente. */
    chave: string | null;
}

/**
 * Extrai emitente/destinatário/chave de um XML de NF-e/NFC-e sem parser DOM
 * (o lote pode ter milhares de arquivos; regex é ordens de grandeza mais
 * barato e aqui só precisamos identificar as partes).
 */
export function extrairDadosXml(xml: string): DadosXml {
    const txt = String(xml || '');
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
    return { emit, dest, chave };
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
    const bloquear = resumo.total > 0 && compativeis === 0;

    let mensagem: string;
    if (resumo.total === 0) {
        mensagem = 'Nenhum XML encontrado nos arquivos.';
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
        mensagem,
    };
}
