/**
 * efdReinfConference.ts — motor PURO de cruzamento EFD-Reinf × DCTFWeb (retenções).
 *
 * Sem firebase, sem fetch — testável direto em jest (igual dctfwebConference).
 *
 * Conceito fiscal: a EFD-Reinf é a FONTE das retenções; a DCTFWeb é alimentada
 * automaticamente por ela e consolida o DÉBITO. Se um evento da Reinf não foi
 * transmitido/processado, a retenção declarada não vira débito na DCTFWeb →
 * recolhimento a menor (risco). O cruzamento por FAMÍLIA de retenção pega isso.
 *
 * Famílias = como a DCTFWeb consolida (calibrado contra CONSXMLDECLARACAO real):
 *   INSS (cod 1162, Reinf R-2010/2020), IRRF (cod 1708, R-4010/4020) e
 *   CSRF (cod 5952 — CSLL+PIS+COFINS combinados 4,65%, R-4020).
 *
 * HONESTIDADE de cobertura: hoje só o INSS (R-2010 — serviços tomados) é
 * extraído de arquivo real do lado da Reinf. IRRF/CSRF entram no shape para
 * quando calibrarmos os eventos R-4010/4020; até lá ficam 0 do lado Reinf
 * (cruzar contra o débito DCTFWeb vira 'sem-reinf', não divergência fake).
 *
 * O lado DCTFWeb desta conferência é preenchido pelo orquestrador (que consulta
 * a DCTFWeb real). Aqui só cruzamos os dois lados já normalizados.
 */

export type RetencaoFamilia = 'INSS' | 'IRRF' | 'CSRF';
export const RETENCAO_FAMILIAS: RetencaoFamilia[] = ['INSS', 'IRRF', 'CSRF'];

export type DivergenciaSeveridade = 'ok' | 'baixa' | 'media' | 'alta';
export type DivergenciaStatus =
    | 'ok'                   // valores batem (dentro da tolerância)
    | 'divergente'          // ambos têm valor mas diferem
    | 'sem-dctfweb'         // Reinf declarou retenção mas não há débito na DCTFWeb
    | 'sem-reinf';          // DCTFWeb tem débito de retenção sem evento Reinf correspondente

export interface RetencoesPorFamilia {
    INSS: number;
    IRRF: number;
    CSRF: number;
}

export interface DivergenciaRetencao {
    familia: RetencaoFamilia;
    valorReinf: number;
    valorDctfweb: number;
    diferenca: number;       // valorReinf - valorDctfweb
    diferencaPct: number;    // % sobre o maior dos dois (0 se ambos 0)
    severidade: DivergenciaSeveridade;
    status: DivergenciaStatus;
}

export interface ConferenciaReinfResultado {
    competencia: string;
    divergencias: DivergenciaRetencao[];
    totalReinf: number;
    totalDctfweb: number;
    temDivergencia: boolean;     // alguma severidade != 'ok'
    resumo: { ok: number; baixa: number; media: number; alta: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Converte o `totais` do consolidarReinf (parser .js) para o shape de famílias
 * de retenção desta conferência. Só o INSS vem populado hoje (R-2010); CSRF
 * agrega CSLL+PIS+COFINS (como a DCTFWeb consolida via cod 5952).
 */
export function extrairRetencoesReinf(totais: {
    inssRetPrinc?: number; inssRetAdic?: number;
    irrf?: number; csll?: number; pis?: number; cofins?: number;
} | null | undefined): RetencoesPorFamilia {
    const t = totais || {};
    return {
        INSS: round2((t.inssRetPrinc || 0) + (t.inssRetAdic || 0)),
        IRRF: round2(t.irrf || 0),
        CSRF: round2((t.csll || 0) + (t.pis || 0) + (t.cofins || 0)),
    };
}

function severidadePorPct(pct: number): DivergenciaSeveridade {
    const a = Math.abs(pct);
    if (a === 0) return 'ok';
    if (a > 10) return 'alta';
    if (a > 5) return 'media';
    return 'baixa';
}

/**
 * Cruza as retenções declaradas (EFD-Reinf) contra as consolidadas (DCTFWeb).
 *
 * @param reinf        retenções somadas da Reinf (extrairRetencoesReinf)
 * @param dctfweb      retenções de débito da DCTFWeb
 * @param competencia  rótulo YYYY-MM
 * @param opts.toleranciaCentavos  diferença <= isto é tratada como OK (default 0.02)
 */
export function cruzarRetencoes(
    reinf: RetencoesPorFamilia,
    dctfweb: RetencoesPorFamilia,
    competencia: string,
    opts: { toleranciaCentavos?: number } = {},
): ConferenciaReinfResultado {
    const tol = opts.toleranciaCentavos ?? 0.02;
    const divergencias: DivergenciaRetencao[] = [];
    const resumo = { ok: 0, baixa: 0, media: 0, alta: 0 };
    let totalReinf = 0;
    let totalDctfweb = 0;

    for (const familia of RETENCAO_FAMILIAS) {
        const valorReinf = round2(reinf[familia] || 0);
        const valorDctfweb = round2(dctfweb[familia] || 0);
        totalReinf += valorReinf;
        totalDctfweb += valorDctfweb;

        const diferenca = round2(valorReinf - valorDctfweb);
        const base = Math.max(Math.abs(valorReinf), Math.abs(valorDctfweb));
        const diferencaPct = base === 0 ? 0 : round2((diferenca / base) * 100);

        let status: DivergenciaStatus;
        let severidade: DivergenciaSeveridade;

        if (Math.abs(diferenca) <= tol) {
            status = 'ok';
            severidade = 'ok';
        } else if (valorDctfweb === 0 && valorReinf > 0) {
            status = 'sem-dctfweb';
            severidade = 'alta'; // Reinf declarou e DCTFWeb não tem débito — recolhimento a menor
        } else if (valorReinf === 0 && valorDctfweb > 0) {
            status = 'sem-reinf';
            severidade = 'media'; // DCTFWeb tem débito sem evento Reinf — revisar transmissão
        } else {
            status = 'divergente';
            severidade = severidadePorPct(diferencaPct);
        }

        resumo[severidade]++;
        divergencias.push({ familia, valorReinf, valorDctfweb, diferenca, diferencaPct, severidade, status });
    }

    return {
        competencia,
        divergencias,
        totalReinf: round2(totalReinf),
        totalDctfweb: round2(totalDctfweb),
        temDivergencia: resumo.baixa + resumo.media + resumo.alta > 0,
        resumo,
    };
}
