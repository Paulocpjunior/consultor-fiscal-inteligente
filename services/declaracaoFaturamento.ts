/**
 * declaracaoFaturamento — núcleo puro da Declaração de Faturamento.
 *
 * Documento pedido pelo Paulo (05/08) no modelo do PDF do SAGE, "porém de
 * forma melhorada, com nossa assinatura de layout". Diferente do resto do
 * menu Relatórios, ele SAI DO ESCRITÓRIO ASSINADO (banco, licitação, locador)
 * — por isso o app PROPÕE os valores a partir dos registros fiscais e o
 * responsável CONFIRMA, podendo ajustar mês a mês. Ajuste fica marcado no
 * papel: quem assina precisa saber o que mudou em relação ao apurado.
 */

/** Meses 'AAAA-MM' de `de` até `ate`, inclusive. Ordem cronológica. */
export function mesesDoPeriodo(de: string, ate: string): string[] {
    const parse = (s: string) => {
        const m = /^(\d{4})-(\d{2})$/.exec(String(s || '').trim());
        if (!m) return null;
        const ano = Number(m[1]);
        const mes = Number(m[2]);
        return mes >= 1 && mes <= 12 ? { ano, mes } : null;
    };
    const a = parse(de);
    const b = parse(ate);
    if (!a || !b) return [];
    const inicio = a.ano * 12 + (a.mes - 1);
    const fim = b.ano * 12 + (b.mes - 1);
    if (fim < inicio) return [];
    // 60 meses de teto: período maior quase sempre é erro de digitação, e a
    // varredura é uma leitura por mês.
    if (fim - inicio >= 60) return [];
    const out: string[] = [];
    for (let i = inicio; i <= fim; i++) {
        out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
    }
    return out;
}

export interface MesDeclaracao {
    competencia: string;
    /** Apurado nos registros fiscais (saídas autorizadas da competência). */
    apurado: number;
    /** Valor que vai no documento — igual ao apurado até alguém mudar. */
    valor: number;
    ajustado: boolean;
    /** Competência sem NENHUM documento lido — zero pode ser falha de captura. */
    semDocumentos: boolean;
}

export function montarMeses(
    competencias: string[],
    apuradoPorMes: Record<string, { valor: number; docs: number }>,
    ajustes: Record<string, number> = {},
): MesDeclaracao[] {
    return competencias.map((c) => {
        const base = apuradoPorMes[c] || { valor: 0, docs: 0 };
        const temAjuste = Object.prototype.hasOwnProperty.call(ajustes, c)
            && Number.isFinite(Number(ajustes[c]));
        const valor = temAjuste ? Number(ajustes[c]) : base.valor;
        return {
            competencia: c,
            apurado: base.valor,
            valor,
            ajustado: temAjuste && Math.abs(valor - base.valor) > 0.005,
            semDocumentos: base.docs === 0,
        };
    });
}

export const totalDeclaracao = (meses: MesDeclaracao[]): number =>
    Math.round(meses.reduce((t, m) => t + (Number(m.valor) || 0), 0) * 100) / 100;

/**
 * Avisos que PRECISAM sair no documento e na tela.
 *
 * Farol honesto num papel assinado: mês zerado pode ser "não faturou" ou
 * "não capturamos" — e a diferença importa muito quando o documento vai a um
 * banco. O app não sabe distinguir, então DIZ que não sabe.
 */
export function avisosDaDeclaracao(meses: MesDeclaracao[]): string[] {
    const avisos: string[] = [];
    const vazios = meses.filter((m) => m.semDocumentos);
    if (vazios.length) {
        avisos.push(
            `${vazios.length} mês(es) sem nenhum documento capturado (${vazios.map((m) => m.competencia).join(', ')}) — `
            + 'zero aqui pode ser "não faturou" OU falha de captura. Confira antes de assinar.',
        );
    }
    const ajustados = meses.filter((m) => m.ajustado);
    if (ajustados.length) {
        avisos.push(
            `${ajustados.length} mês(es) com valor ajustado manualmente em relação ao apurado nos registros fiscais.`,
        );
    }
    return avisos;
}
