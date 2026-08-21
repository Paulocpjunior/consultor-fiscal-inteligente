// ============================================================================
// sefaz-backend/ipi-varredura.js  (PURO — sem firebase/io, testável)
//
// Varredura de IPI: dado o IPI apurado pelo app (ficha) e se existe um
// mês-modelo com débito de IPI no MIT, classifica cada empresa industrial em:
//
//   - pronta            → IPI apurado E há código de IPI num mês-modelo do MIT.
//                         O preenchimento automático monta e transmite sozinho
//                         (CnpjEstabelecimento/ordem vêm do modelo — vide Experte).
//   - precisa_lancamento→ IPI apurado MAS nenhum mês anterior teve IPI no MIT.
//                         O builder nunca chuta código de receita → precisa lançar
//                         o IPI UMA vez no e-CAC; a partir daí o app assume.
//   - erro_consulta     → não deu pra consultar o MIT (cert/rate-limit) — reprocessar.
//   - sem_ipi           → sem IPI a recolher nessa competência (não é problema).
//
// Esta varredura antecipa QUAIS empresas vão cair no "precisa_lancamento",
// antes de virar urgência uma a uma (vide Experte 06/2026).
// ============================================================================

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** 'YYYY-MM' a partir de mesReferencia em formatos comuns (YYYY-MM, YYYY-MM-DD,
 *  MM/YYYY). null se não der pra normalizar. */
export function normalizarCompetencia(mes) {
    const s = String(mes ?? '').trim();
    let m = s.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
    m = s.match(/^(\d{2})\/(\d{4})$/);
    if (m) return `${m[2]}-${m[1]}`;
    return null;
}

/** IPI a recolher da ficha — MESMA fórmula do lucroService:
 *  max(0, ipiRecolher - saldoCredorIpi). 0 quando não há IPI. */
export function calcularIpiApuradoFicha(ficha) {
    const ipiRecolher = Number(ficha?.ipiRecolher) || 0;
    if (ipiRecolher <= 0) return 0;
    const saldo = Number(ficha?.saldoCredorIpi) || 0;
    return round2(Math.max(0, ipiRecolher - saldo));
}

/**
 * Acha a ficha da competência-alvo ('YYYY-MM') na fichaFinanceira.
 *
 * 🚨 É A RÉGUA ÚNICA DA LEITURA DA FICHA POR COMPETÊNCIA. O campo
 * `mesReferencia` aparece em 'YYYY-MM', 'YYYY-MM-DD' e 'MM/YYYY' conforme a
 * época do lançamento, e comparar com `===` na mão não devolve erro: devolve
 * NADA — indistinguível de "a ficha não foi lançada". Esse zero silencioso já
 * zerou o M200/M600 (F550 da AFFITTARE, 21/08), o saldo credor do SPED Fiscal
 * e a etapa de apuração da Rotina do Mês.
 */
export function acharFichaCompetencia(fichaFinanceira, competencia) {
    const alvo = normalizarCompetencia(competencia);
    if (!alvo) return null;
    return (fichaFinanceira || []).find((f) => normalizarCompetencia(f?.mesReferencia) === alvo) || null;
}

/**
 * As fichas de UMA OU MAIS competências — mesma régua, no plural.
 *
 * Existe porque o trimestral junta os 3 meses do trimestre (emissão de DARF) e
 * o mensal pega um só: fazer isso com `filter(=== )` na tela reabriria a mesma
 * porta que `acharFichaCompetencia` fecha.
 */
export function fichasDasCompetencias(fichaFinanceira, competencias) {
    const alvos = new Set(
        (Array.isArray(competencias) ? competencias : [competencias])
            .map(normalizarCompetencia)
            .filter(Boolean),
    );
    if (!alvos.size) return [];
    return (fichaFinanceira || []).filter((f) => alvos.has(normalizarCompetencia(f?.mesReferencia)));
}

/**
 * Classifica uma empresa na varredura de IPI.
 * @param {{ipiApurado:number, temModeloIpi:boolean, erroConsulta?:string|null}} args
 */
export function classificarIpiEmpresa({ ipiApurado, temModeloIpi, erroConsulta }) {
    const ipi = round2(ipiApurado);
    if (ipi <= 0) {
        return {
            status: 'sem_ipi',
            titulo: 'Sem IPI a recolher nesta competência',
            acao: 'Nada a fazer.',
            prioridade: 0,
        };
    }
    if (erroConsulta) {
        return {
            status: 'erro_consulta',
            titulo: 'Não foi possível consultar o MIT',
            acao: `Reprocessar: ${erroConsulta}`,
            prioridade: 2,
        };
    }
    if (temModeloIpi) {
        return {
            status: 'pronta',
            titulo: 'Pronta — transmite IPI automaticamente',
            acao: 'O preenchimento automático do MIT já monta e transmite o IPI desta empresa.',
            prioridade: 1,
        };
    }
    return {
        status: 'precisa_lancamento',
        titulo: 'Precisa lançar IPI 1x no e-CAC',
        acao: 'Nenhum mês anterior teve IPI no MIT — lance o IPI manualmente no '
            + 'e-CAC uma vez (vira modelo de código). A partir do mês seguinte o app assume.',
        prioridade: 3,
    };
}

/** Agrega o resumo do relatório. */
export function resumirVarreduraIpi(linhas) {
    const resumo = {
        total: linhas.length,
        comIpi: 0,
        pronta: 0,
        precisaLancamento: 0,
        erroConsulta: 0,
        semIpi: 0,
        ipiTotalApurado: 0,
        ipiTotalEmRisco: 0, // IPI das que precisam de lançamento manual ou deram erro
    };
    for (const l of linhas) {
        const ipi = Number(l.ipiApurado) || 0;
        switch (l.status) {
            case 'pronta':
                resumo.pronta++; resumo.comIpi++;
                resumo.ipiTotalApurado = round2(resumo.ipiTotalApurado + ipi);
                break;
            case 'precisa_lancamento':
                resumo.precisaLancamento++; resumo.comIpi++;
                resumo.ipiTotalApurado = round2(resumo.ipiTotalApurado + ipi);
                resumo.ipiTotalEmRisco = round2(resumo.ipiTotalEmRisco + ipi);
                break;
            case 'erro_consulta':
                resumo.erroConsulta++; resumo.comIpi++;
                resumo.ipiTotalApurado = round2(resumo.ipiTotalApurado + ipi);
                resumo.ipiTotalEmRisco = round2(resumo.ipiTotalEmRisco + ipi);
                break;
            default: resumo.semIpi++; break;
        }
    }
    return resumo;
}
