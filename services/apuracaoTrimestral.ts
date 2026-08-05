/**
 * apuracaoTrimestral — monta a "Tabela de apuração — Lucro Presumido
 * (trimestre)" a partir das fichas do módulo Lucro.
 *
 * Pedido do Paulo (05/08): o resumo existia em PLANILHA EXCEL, fora do app —
 * faturamento dos 3 meses, presunção, receita financeira, IRPJ, adicional e
 * CSLL do trimestre. O CFI já tem esses números; faltava o relatório.
 *
 * REGRA DO MENU (01/08): relatório NÃO tem conta própria. Este módulo só
 * SELECIONA e SOMA o que já está lançado — os tributos vêm de `calcularLucro`,
 * o mesmo motor da ficha e do DARF. Se algum número divergir da tela do Lucro,
 * é bug de um lugar só.
 */
import type { FichaFinanceiraRegistro } from '../types';

export const MESES_DO_TRIMESTRE: Record<number, number[]> = {
    1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12],
};

export const trimestreDoMes = (mes: number): number => Math.floor((mes - 1) / 3) + 1;

export interface MesTrimestre {
    competencia: string;
    /** Receita que forma a base de presunção (SEM a receita financeira). */
    faturamento: number;
    receitaFinanceira: number;
    retencaoIrpj: number;
    retencaoCsll: number;
    /** Sem ficha lançada — o trimestre NÃO fecha com mês faltando. */
    ausente: boolean;
    /** Ficha lançada como Mensal num regime que apura IRPJ/CSLL por trimestre. */
    lancadoComoMensal: boolean;
}

export interface ApuracaoTrimestre {
    ano: number;
    trimestre: number;
    rotulo: string;
    meses: MesTrimestre[];
    totalFaturamento: number;
    totalReceitaFinanceira: number;
    totalRetencaoIrpj: number;
    totalRetencaoCsll: number;
    /** Ficha do mês que ENCERRA o trimestre (3/6/9/12) — a que apura. */
    fichaFechamento: FichaFinanceiraRegistro | null;
    /** Pode emitir o relatório? Falta de mês ou de fechamento impede. */
    fechado: boolean;
    pendencias: string[];
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Receita que forma a BASE de presunção — a soma do faturamento por tipo
 * (matriz + filiais).
 *
 * NÃO usar `faturamentoMesTotal`: naquele campo a receita FINANCEIRA já está
 * somada (caso PEC 06/2026 — 216.016,16 = 211.713,62 de faturamento +
 * 4.302,54 de receita financeira). Como a receita financeira aparece em linha
 * PRÓPRIA no quadro e entra na base depois da presunção, usar o total faria o
 * relatório contá-la duas vezes e divergir do demonstrativo — foi exatamente
 * o que apareceu no 1º PDF: total 643.081,82 em vez de 638.779,28.
 */
function faturamentoTributavel(f: FichaFinanceiraRegistro): number {
    const campos: Array<number | undefined> = [
        f.faturamentoMesComercio, f.faturamentoMesIndustria, f.faturamentoMesServico,
        f.faturamentoMesServicoRetido, f.faturamentoMesLocacao, f.faturamentoMesServicoHospitalar,
        f.faturamentoFiliaisComercio, f.faturamentoFiliaisIndustria, f.faturamentoFiliaisServico,
        f.faturamentoFiliaisServicoRetido, f.faturamentoFiliaisLocacao, f.faturamentoFiliaisServicoHospitalar,
    ];
    return r2(campos.reduce<number>((t, v) => t + (Number(v) || 0), 0));
}

/**
 * Monta o trimestre a partir das fichas da empresa.
 *
 * Farol honesto: mês sem ficha NÃO vira zero silencioso — vira pendência com
 * a ação, e o trimestre fica marcado como não fechado. IRPJ/CSLL apurados
 * sobre 2 meses seriam menores que o devido, e o erro só apareceria na
 * malha — exatamente o cenário que a regra do Presumido (03/08) evita.
 */
export function montarApuracaoTrimestre(
    fichas: FichaFinanceiraRegistro[],
    ano: number,
    trimestre: number,
): ApuracaoTrimestre {
    const mesesDoTri = MESES_DO_TRIMESTRE[trimestre] || [];
    const pendencias: string[] = [];

    const porMes = new Map<string, FichaFinanceiraRegistro>();
    for (const f of fichas || []) {
        const [a, m] = String(f?.mesReferencia || '').split('-');
        if (Number(a) !== ano) continue;
        if (!mesesDoTri.includes(Number(m))) continue;
        // Ficha mais recente do mês vence (o módulo permite relançar).
        const chave = `${a}-${m}`;
        const atual = porMes.get(chave);
        if (!atual || (f.dataRegistro || 0) >= (atual.dataRegistro || 0)) porMes.set(chave, f);
    }

    const meses: MesTrimestre[] = mesesDoTri.map((m) => {
        const competencia = `${ano}-${String(m).padStart(2, '0')}`;
        const f = porMes.get(competencia);
        if (!f) {
            return {
                competencia, faturamento: 0, receitaFinanceira: 0,
                retencaoIrpj: 0, retencaoCsll: 0, ausente: true, lancadoComoMensal: false,
            };
        }
        return {
            competencia,
            faturamento: faturamentoTributavel(f),
            receitaFinanceira: r2(f.receitaFinanceira || 0),
            retencaoIrpj: r2(f.retencaoIrpj || 0),
            retencaoCsll: r2(f.retencaoCsll || 0),
            ausente: false,
            lancadoComoMensal: f.periodoApuracao === 'Mensal',
        };
    });

    const ausentes = meses.filter((m) => m.ausente);
    if (ausentes.length) {
        pendencias.push(
            `Sem ficha lançada em ${ausentes.map((m) => m.competencia).join(', ')} — `
            + 'o trimestre não fecha com mês faltando (IRPJ/CSLL sairiam a menor). Lance a ficha no módulo Lucro.',
        );
    }

    const mesFechamento = mesesDoTri[2];
    const fichaFechamentoMensal = porMes.get(`${ano}-${String(mesFechamento).padStart(2, '0')}`);
    const fichaFechamento = fichaFechamentoMensal && fichaFechamentoMensal.periodoApuracao === 'Trimestral'
        ? fichaFechamentoMensal
        : null;

    if (fichaFechamentoMensal && !fichaFechamento) {
        pendencias.push(
            `A ficha de ${ano}-${String(mesFechamento).padStart(2, '0')} está lançada como MENSAL. `
            + 'IRPJ/CSLL do Presumido são trimestrais (Lei 9.430/96 art. 1º): relance o mês de fechamento '
            + 'como Trimestral para o trimestre apurar.',
        );
    }

    const soma = (fn: (m: MesTrimestre) => number) => r2(meses.reduce((t, m) => t + fn(m), 0));

    return {
        ano,
        trimestre,
        rotulo: `${trimestre}º trimestre de ${ano}`,
        meses,
        totalFaturamento: soma((m) => m.faturamento),
        totalReceitaFinanceira: soma((m) => m.receitaFinanceira),
        totalRetencaoIrpj: soma((m) => m.retencaoIrpj),
        totalRetencaoCsll: soma((m) => m.retencaoCsll),
        fichaFechamento,
        fechado: ausentes.length === 0 && !!fichaFechamento,
        pendencias,
    };
}

/** Trimestres que a empresa tem ficha lançada, do mais recente pro mais antigo. */
export function trimestresDisponiveis(
    fichas: FichaFinanceiraRegistro[],
): Array<{ ano: number; trimestre: number; rotulo: string }> {
    const set = new Map<string, { ano: number; trimestre: number; rotulo: string }>();
    for (const f of fichas || []) {
        const [a, m] = String(f?.mesReferencia || '').split('-');
        const ano = Number(a);
        const mes = Number(m);
        if (!ano || !mes) continue;
        const tri = trimestreDoMes(mes);
        set.set(`${ano}-${tri}`, { ano, trimestre: tri, rotulo: `${tri}º trimestre de ${ano}` });
    }
    return Array.from(set.values()).sort((x, y) => (y.ano - x.ano) || (y.trimestre - x.trimestre));
}
