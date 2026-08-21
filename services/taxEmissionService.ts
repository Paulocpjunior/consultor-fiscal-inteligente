/**
 * services/taxEmissionService.ts
 * Cliente HTTP da Central de Emissões (fachada DAS + DARF).
 * Também provê sugestão de valor calculado pra DARF baseada na FichaFinanceira
 * já registrada para a empresa (Lucro Presumido / Real).
 */
import type {
    User, EmissaoResumoConsolidado, CatalogoEmissaoItem,
    DarfRegime, DarfTributo, LucroPresumidoEmpresa,
    FichaFinanceiraRegistro,
} from '../types';

import { getAuth } from 'firebase/auth';
import { fichasDasCompetencias } from '../sefaz-backend/ipi-varredura.js';

const BASE = '/api/admin/emission';

async function authHeaders(_user: User | null): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuario nao autenticado');
    const token = await u.getIdToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

export async function getResumoConsolidado(user: User | null): Promise<EmissaoResumoConsolidado> {
    const res = await fetch(`${BASE}/resumo`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`getResumoConsolidado: ${res.status}`);
    return res.json();
}

export async function getCatalogo(user: User | null, regime: string): Promise<CatalogoEmissaoItem[]> {
    const res = await fetch(`${BASE}/catalogo?regime=${encodeURIComponent(regime)}`, {
        headers: await authHeaders(user),
    });
    if (!res.ok) throw new Error(`getCatalogo: ${res.status}`);
    return res.json();
}


/* ──────────────────────────────────────────────────────────────────────────
 * Sugestão de valor DARF a partir da FichaFinanceira da empresa.
 *
 * Lê o registro da competência (mensal) ou agrega o trimestre (trimestral)
 * e extrai do `totalImpostos`/`detalhamento` o valor correspondente ao
 * tributo solicitado. Como a FichaFinanceira não persiste o split detalhado
 * de impostos (apenas totalImpostos), aplicamos uma heurística simples:
 * recalculamos via percentuais médios da receita do período.
 *
 * Quando o usuário tem o cálculo detalhado (LucroResult em cache), o
 * frontend pode passá-lo direto e pular essa heurística.
 * ────────────────────────────────────────────────────────────────────── */

export interface SugestaoDarfValor {
    valor: number;
    fonte: 'ficha-financeira' | 'heuristica' | 'manual';
    baseCalculo?: number;
    periodicidadeAplicada: 'mensal' | 'trimestral';
    detalhe?: string;
}

const PRESUNCAO_IRPJ_COMERCIO = 0.08;
const PRESUNCAO_IRPJ_SERVICO  = 0.32;
const PRESUNCAO_CSLL_COMERCIO = 0.12;
const PRESUNCAO_CSLL_SERVICO  = 0.32;
const ALIQ_IRPJ = 0.15;
const ALIQ_CSLL = 0.09;
const ALIQ_PIS_CUMULATIVO    = 0.0065;
const ALIQ_COFINS_CUMULATIVO = 0.03;
const ALIQ_PIS_NAO_CUMULATIVO    = 0.0165;
const ALIQ_COFINS_NAO_CUMULATIVO = 0.076;

function selecionarRegistros(
    empresa: LucroPresumidoEmpresa,
    competencia: string,                  // 'YYYY-MM'
    periodicidade: 'mensal' | 'trimestral'
): FichaFinanceiraRegistro[] {
    // RÉGUA ÚNICA (`fichasDasCompetencias`): `mesReferencia` aparece em três
    // formatos e comparar na mão devolve lista VAZIA — que aqui se lê como
    // "não há o que emitir", com a ficha lançada.
    const registros = empresa.fichaFinanceira || [];
    if (periodicidade === 'mensal') {
        return fichasDasCompetencias(registros, competencia);
    }
    // Trimestral: junta os 3 meses do trimestre da competência
    const [ano, mes] = competencia.split('-').map(Number);
    if (!ano || !mes) return [];
    const trimestre = Math.floor((mes - 1) / 3);
    const mesesTrim = [trimestre * 3 + 1, trimestre * 3 + 2, trimestre * 3 + 3]
        .map(m => `${ano}-${String(m).padStart(2, '0')}`);
    return fichasDasCompetencias(registros, mesesTrim);
}

export function sugerirValorDarf(
    empresa: LucroPresumidoEmpresa,
    tributo: DarfTributo,
    regime: DarfRegime,
    competencia: string,
    periodicidade: 'mensal' | 'trimestral' = 'trimestral'
): SugestaoDarfValor {
    const regs = selecionarRegistros(empresa, competencia, periodicidade);
    if (regs.length === 0) {
        return {
            valor: 0,
            fonte: 'manual',
            periodicidadeAplicada: periodicidade,
            detalhe: 'Sem registros de FichaFinanceira no período. Informe valor manualmente.',
        };
    }

    // Soma receitas por tipo no período
    const receitaComercio = regs.reduce((s, r) => s + (r.faturamentoMesComercio || 0)
        + (r.faturamentoFiliaisComercio || 0)
        + (r.faturamentoMesIndustria || 0)
        + (r.faturamentoFiliaisIndustria || 0), 0);
    const receitaServico = regs.reduce((s, r) => s + (r.faturamentoMesServico || 0)
        + (r.faturamentoFiliaisServico || 0)
        + (r.faturamentoMesLocacao || 0)
        + (r.faturamentoFiliaisLocacao || 0)
        + (r.faturamentoMesServicoHospitalar || 0)
        + (r.faturamentoFiliaisServicoHospitalar || 0), 0);
    const receitaTotal = receitaComercio + receitaServico
        + regs.reduce((s, r) => s + (r.receitaFinanceira || 0), 0);

    if (receitaTotal === 0) {
        return {
            valor: 0,
            fonte: 'manual',
            periodicidadeAplicada: periodicidade,
            detalhe: 'Receita zero no período. Informe valor manualmente.',
        };
    }

    let valor = 0;
    let detalhe = '';

    if (regime === 'Presumido') {
        if (tributo === 'IRPJ') {
            const base = receitaComercio * PRESUNCAO_IRPJ_COMERCIO
                       + receitaServico  * PRESUNCAO_IRPJ_SERVICO
                       + regs.reduce((s, r) => s + (r.receitaFinanceira || 0), 0);
            valor = base * ALIQ_IRPJ;
            detalhe = `Base presumida ${formatBRL(base)} × 15%`;
            // Retenções
            const retencaoIrpj = regs.reduce((s, r) => s + (r.retencaoIrpj || 0), 0);
            valor = Math.max(0, valor - retencaoIrpj);
            if (retencaoIrpj > 0) detalhe += ` − retenções ${formatBRL(retencaoIrpj)}`;
        } else if (tributo === 'CSLL') {
            const base = receitaComercio * PRESUNCAO_CSLL_COMERCIO
                       + receitaServico  * PRESUNCAO_CSLL_SERVICO
                       + regs.reduce((s, r) => s + (r.receitaFinanceira || 0), 0);
            valor = base * ALIQ_CSLL;
            detalhe = `Base presumida ${formatBRL(base)} × 9%`;
            const retencaoCsll = regs.reduce((s, r) => s + (r.retencaoCsll || 0), 0);
            valor = Math.max(0, valor - retencaoCsll);
            if (retencaoCsll > 0) detalhe += ` − retenções ${formatBRL(retencaoCsll)}`;
        } else if (tributo === 'PIS') {
            valor = receitaTotal * ALIQ_PIS_CUMULATIVO;
            const ret = regs.reduce((s, r) => s + (r.retencaoPis || 0), 0);
            valor = Math.max(0, valor - ret);
            detalhe = `Receita ${formatBRL(receitaTotal)} × 0,65% (cumulativo)`;
        } else if (tributo === 'COFINS') {
            valor = receitaTotal * ALIQ_COFINS_CUMULATIVO;
            const ret = regs.reduce((s, r) => s + (r.retencaoCofins || 0), 0);
            valor = Math.max(0, valor - ret);
            detalhe = `Receita ${formatBRL(receitaTotal)} × 3% (cumulativo)`;
        }
    } else if (regime === 'Real') {
        // Lucro Real exige ficha de apuração detalhada. Sugestão é grosseira —
        // usa totalImpostos da ficha como proxy.
        if (tributo === 'IRPJ' || tributo === 'CSLL') {
            const totalImp = regs.reduce((s, r) => s + (r.totalImpostos || 0), 0);
            // proxy ~ 60% IRPJ, 40% CSLL (heurística — só sugestão)
            valor = tributo === 'IRPJ' ? totalImp * 0.6 : totalImp * 0.4;
            detalhe = `Estimativa proxy de totalImpostos da Ficha — confira no encerramento`;
        } else if (tributo === 'PIS') {
            valor = receitaTotal * ALIQ_PIS_NAO_CUMULATIVO;
            const ret = regs.reduce((s, r) => s + (r.retencaoPis || 0), 0);
            const cred = regs.reduce((s, r) => s + (r.saldoCredorPis || 0), 0);
            valor = Math.max(0, valor - ret - cred);
            detalhe = `Receita × 1,65% − créditos − retenções (não-cumulativo)`;
        } else if (tributo === 'COFINS') {
            valor = receitaTotal * ALIQ_COFINS_NAO_CUMULATIVO;
            const ret = regs.reduce((s, r) => s + (r.retencaoCofins || 0), 0);
            const cred = regs.reduce((s, r) => s + (r.saldoCredorCofins || 0), 0);
            valor = Math.max(0, valor - ret - cred);
            detalhe = `Receita × 7,6% − créditos − retenções (não-cumulativo)`;
        }
    }

    return {
        valor: +valor.toFixed(2),
        fonte: regime === 'Real' && (tributo === 'IRPJ' || tributo === 'CSLL')
            ? 'heuristica'
            : 'ficha-financeira',
        baseCalculo: receitaTotal,
        periodicidadeAplicada: periodicidade,
        detalhe,
    };
}

// ── Helpers de display (compartilhados pela UI) ────────────────────────────

export function formatBRL(v: number): string {
    return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function statusBadgeClass(status: string): string {
    const map: Record<string, string> = {
        pago:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
        pendente: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
        vencido:  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    };
    return map[status] || 'bg-slate-100 text-slate-700';
}

export function statusLabel(status: string): string {
    return ({ pago: 'Pago', pendente: 'Pendente', vencido: 'Vencido' } as any)[status] || status;
}
