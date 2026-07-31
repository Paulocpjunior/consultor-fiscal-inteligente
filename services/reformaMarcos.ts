/**
 * reformaMarcos — cronograma OFICIAL da obrigatoriedade dos campos/destaque
 * de IBS e CBS nos documentos fiscais eletrônicos.
 *
 * Fonte: Ato Conjunto RFB/CGIBS nº 4/2026, publicado em 31/07/2026 — o
 * cronograma virou ESCALONADO (não houve adiamento geral):
 *
 *   03/08/2026  NF-e, NFC-e, CT-e e MDF-e (empresas do regime regular) —
 *               nota sem os campos IBS/CBS é REJEITADA (regra 1115).
 *   01/10/2026  NFS-e (prestadores de serviço).
 *   01/12/2026  NFAg (água/saneamento) e NF-e ABI (alienação de imóveis).
 *   01/01/2027  Optantes do SIMPLES NACIONAL (todos os documentos) e Duimp.
 *
 * Módulo puro (testável) — o banner só desenha. Se um novo ato mudar datas,
 * atualizar AQUI (tabela única) e o teste junto.
 */

export interface MarcoReforma {
    dataIso: string;         // YYYY-MM-DD
    docs: string;            // o que passa a exigir os campos
    publico: string;         // quem é atingido
}

export const MARCOS_REFORMA: MarcoReforma[] = [
    { dataIso: '2026-08-03', docs: 'NF-e, NFC-e, CT-e e MDF-e', publico: 'empresas do regime regular (fora do Simples) — nota sem os campos é rejeitada' },
    { dataIso: '2026-10-01', docs: 'NFS-e', publico: 'prestadores de serviço' },
    { dataIso: '2026-12-01', docs: 'NFAg e NF-e ABI', publico: 'água/saneamento e alienação de imóveis' },
    { dataIso: '2027-01-01', docs: 'todos os documentos + Duimp', publico: 'optantes do Simples Nacional' },
];

function parseIsoLocal(iso: string): Date | null {
    const [a, m, d] = iso.split('-').map(Number);
    if (!a || !m || !d) return null;
    return new Date(a, m - 1, d);
}

export function fmtDataBr(iso: string): string {
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
}

export interface EstadoMarcos {
    /** Próximo marco ainda não atingido (null = todos vigentes). */
    proximo: MarcoReforma | null;
    /** Dias até o próximo marco (0 = hoje). */
    diasAteProximo: number | null;
    /** Marcos já em vigor na data de referência. */
    vigentes: MarcoReforma[];
}

export function estadoMarcosReforma(hoje: Date, marcos: MarcoReforma[] = MARCOS_REFORMA): EstadoMarcos {
    const ref = new Date(hoje);
    ref.setHours(0, 0, 0, 0);

    const vigentes: MarcoReforma[] = [];
    let proximo: MarcoReforma | null = null;
    let diasAteProximo: number | null = null;

    for (const m of marcos) {
        const alvo = parseIsoLocal(m.dataIso);
        if (!alvo) continue;
        // Estritamente menor: no PRÓPRIO dia o marco ainda é "próximo" (0 dias)
        // — o banner mostra "É HOJE" em vez de pular pro lote seguinte.
        if (alvo.getTime() < ref.getTime()) {
            vigentes.push(m);
        } else if (!proximo) {
            proximo = m;
            diasAteProximo = Math.round((alvo.getTime() - ref.getTime()) / 86_400_000);
        }
    }
    return { proximo, diasAteProximo, vigentes };
}

/** Linha compacta do cronograma completo pra UI/e-mail. */
export function cronogramaCompacto(marcos: MarcoReforma[] = MARCOS_REFORMA): string {
    return marcos
        .map((m) => `${fmtDataBr(m.dataIso).slice(0, 5)}${m.dataIso.startsWith('2027') ? '/27' : ''} ${m.docs}`)
        .join(' · ');
}
