import { montarApuracaoTrimestre, trimestresDisponiveis, trimestreDoMes } from '../services/apuracaoTrimestral';
import type { FichaFinanceiraRegistro } from '../types';

const ficha = (mes: string, over: Partial<FichaFinanceiraRegistro> = {}): FichaFinanceiraRegistro => ({
    id: `f-${mes}`,
    dataRegistro: 1,
    mesReferencia: mes,
    regime: 'Presumido',
    periodoApuracao: 'Trimestral',
    acumuladoAno: 0,
    faturamentoMesComercio: 0,
    faturamentoMesIndustria: 0,
    faturamentoMesServico: 0,
    faturamentoMesServicoRetido: 0,
    faturamentoMesLocacao: 0,
    faturamentoMesServicoHospitalar: 0,
    faturamentoMonofasico: 0,
    valorIpi: 0,
    valorDevolucoes: 0,
    icmsVendas: 0,
    receitaFinanceira: 0,
    faturamentoMesTotal: 0,
    totalGeral: 0,
    despesas: 0,
    despesasDedutiveis: 0,
    folha: 0,
    cmv: 0,
    retencaoPis: 0,
    retencaoCofins: 0,
    retencaoIrpj: 0,
    retencaoCsll: 0,
    totalImpostos: 0,
    cargaTributaria: 0,
    ...over,
} as FichaFinanceiraRegistro);

describe('trimestreDoMes', () => {
    it('mapeia mês → trimestre', () => {
        expect([1, 3, 4, 6, 7, 9, 10, 12].map(trimestreDoMes)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    });
});

describe('montarApuracaoTrimestre — o caso real do 2º trimestre', () => {
    // Números da planilha que o Paulo mandou (abril/maio/junho de 2026).
    const fichas = [
        ficha('2026-04', { faturamentoMesTotal: 204867.73 }),
        ficha('2026-05', { faturamentoMesTotal: 222197.93 }),
        ficha('2026-06', { faturamentoMesTotal: 211713.62, receitaFinanceira: 4302.54, retencaoIrpj: 967.73 }),
    ];

    it('soma os 3 meses do trimestre', () => {
        const t = montarApuracaoTrimestre(fichas, 2026, 2);
        expect(t.meses.map(m => m.competencia)).toEqual(['2026-04', '2026-05', '2026-06']);
        expect(t.totalFaturamento).toBe(638779.28);
        expect(t.totalReceitaFinanceira).toBe(4302.54);
        expect(t.totalRetencaoIrpj).toBe(967.73);
        expect(t.fechado).toBe(true);
        expect(t.pendencias).toEqual([]);
    });

    it('a ficha de fechamento é a do 3º mês do trimestre', () => {
        const t = montarApuracaoTrimestre(fichas, 2026, 2);
        expect(t.fichaFechamento?.mesReferencia).toBe('2026-06');
    });

    it('ignora meses de outro trimestre e de outro ano', () => {
        const t = montarApuracaoTrimestre(
            [...fichas, ficha('2026-07', { faturamentoMesTotal: 999 }), ficha('2025-06', { faturamentoMesTotal: 888 })],
            2026, 2,
        );
        expect(t.totalFaturamento).toBe(638779.28);
    });
});

describe('farol honesto do trimestre', () => {
    it('mês sem ficha NÃO vira zero silencioso — vira pendência e não fecha', () => {
        const t = montarApuracaoTrimestre([
            ficha('2026-04', { faturamentoMesTotal: 100 }),
            ficha('2026-06', { faturamentoMesTotal: 300 }),
        ], 2026, 2);
        expect(t.meses[1].ausente).toBe(true);
        expect(t.fechado).toBe(false);
        expect(t.pendencias[0]).toMatch(/2026-05/);
        expect(t.pendencias[0]).toMatch(/IRPJ\/CSLL sairiam a menor/);
    });

    it('fechamento lançado como MENSAL não apura o trimestre e diz o porquê', () => {
        const t = montarApuracaoTrimestre([
            ficha('2026-04', { faturamentoMesTotal: 100 }),
            ficha('2026-05', { faturamentoMesTotal: 200 }),
            ficha('2026-06', { faturamentoMesTotal: 300, periodoApuracao: 'Mensal' }),
        ], 2026, 2);
        expect(t.fichaFechamento).toBeNull();
        expect(t.fechado).toBe(false);
        expect(t.pendencias.join(' ')).toMatch(/lançada como MENSAL/);
        expect(t.pendencias.join(' ')).toMatch(/Lei 9\.430\/96/);
    });

    it('trimestre sem ficha nenhuma não fecha (não é "faturou zero")', () => {
        const t = montarApuracaoTrimestre([], 2026, 3);
        expect(t.fechado).toBe(false);
        expect(t.meses.every(m => m.ausente)).toBe(true);
    });

    it('relançamento do mesmo mês: vence a ficha mais recente', () => {
        const t = montarApuracaoTrimestre([
            ficha('2026-04', { faturamentoMesTotal: 100, dataRegistro: 1 }),
            ficha('2026-04', { faturamentoMesTotal: 150, dataRegistro: 9 }),
            ficha('2026-05', { faturamentoMesTotal: 0 }),
            ficha('2026-06', { faturamentoMesTotal: 0 }),
        ], 2026, 2);
        expect(t.meses[0].faturamento).toBe(150);
    });
});

describe('trimestresDisponiveis', () => {
    it('lista os trimestres com ficha, do mais recente pro mais antigo', () => {
        const t = trimestresDisponiveis([ficha('2026-02'), ficha('2026-06'), ficha('2025-11')]);
        expect(t.map(x => x.rotulo)).toEqual([
            '2º trimestre de 2026', '1º trimestre de 2026', '4º trimestre de 2025',
        ]);
    });

    it('não duplica trimestre com vários meses lançados', () => {
        expect(trimestresDisponiveis([ficha('2026-04'), ficha('2026-05'), ficha('2026-06')])).toHaveLength(1);
    });
});
