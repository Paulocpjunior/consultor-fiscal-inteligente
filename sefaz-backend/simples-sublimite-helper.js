// ============================================================================
// simples-sublimite-helper.js  (PURO — sem io/firebase, testavel)
//
// Calculo do RBT12 (receita bruta nos ultimos 12 meses) e classificacao
// quanto aos limites do Simples Nacional:
//
//   Teto Simples (LC 123/2006 art 3o II): R$ 4.800.000,00 anual.
//   Sublimite ICMS/ISS (CGSN 169/2022, mantido em 2026): R$ 3.600.000,00.
//
// Empresa que ultrapassa sublimite NAO PODE mais usar Simples pra ICMS/ISS no
// estado, mas continua no Simples Federal. Empresa que ultrapassa teto eh
// EXCLUIDA do Simples na competencia seguinte (CGSN 140/2018 art 81).
//
// Faixas de risco (% sobre RBT12 / limite):
//   < 70%  : ok
//   70-90% : alerta (precisa monitorar)
//   90-100%: critico (proximo do limite)
//   > 100% : ULTRAPASSOU (acao imediata)
// ============================================================================

export const LIMITE_TETO_SIMPLES = 4_800_000;
export const LIMITE_SUBLIMITE_ICMS_ISS = 3_600_000;

const PCT_ALERTA = 0.70;
const PCT_CRITICO = 0.90;

/**
 * Soma 12 meses a partir do mes anterior (igual o calcularResumoEmpresa).
 * @param {Record<string, number>} faturamentoManual  YYYY-MM -> valor
 * @param {string} [mesReferencia]  YYYY-MM (default = mes atual)
 * @returns {{ rbt12:number, mesesConsiderados:string[], mesesSemDado:string[] }}
 */
export function calcularRbt12(faturamentoManual, mesReferencia) {
    const fm = faturamentoManual || {};
    const ref = mesReferencia ? new Date(`${mesReferencia}-01T00:00:00`) : new Date();
    const out = { rbt12: 0, mesesConsiderados: [], mesesSemDado: [] };
    // 12 meses: do mes ANTERIOR a ref pra tras
    for (let i = 1; i <= 12; i++) {
        const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
        const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const v = Number(fm[mes]);
        if (Number.isFinite(v) && v > 0) {
            out.rbt12 += v;
            out.mesesConsiderados.push(mes);
        } else {
            out.mesesSemDado.push(mes);
        }
    }
    out.rbt12 = Math.round(out.rbt12 * 100) / 100;
    return out;
}

/**
 * @param {number} rbt12  receita bruta acumulada 12 meses
 * @returns {{
 *   teto: { limite:number, pct:number, faixa:'ok'|'alerta'|'critico'|'ultrapassou', restante:number },
 *   sublimite: { limite:number, pct:number, faixa:'ok'|'alerta'|'critico'|'ultrapassou', restante:number }
 * }}
 */
export function classificarRbt12(rbt12) {
    return {
        teto: classificarContraLimite(rbt12, LIMITE_TETO_SIMPLES),
        sublimite: classificarContraLimite(rbt12, LIMITE_SUBLIMITE_ICMS_ISS),
    };
}

function classificarContraLimite(rbt12, limite) {
    const pct = limite > 0 ? rbt12 / limite : 0;
    let faixa;
    if (pct > 1) faixa = 'ultrapassou';
    else if (pct >= PCT_CRITICO) faixa = 'critico';
    else if (pct >= PCT_ALERTA) faixa = 'alerta';
    else faixa = 'ok';
    return {
        limite,
        pct: Math.round(pct * 10000) / 100, // 0-100+ com 2 casas
        faixa,
        restante: Math.max(0, limite - rbt12),
    };
}

export const _constantes = { LIMITE_TETO_SIMPLES, LIMITE_SUBLIMITE_ICMS_ISS, PCT_ALERTA, PCT_CRITICO };
