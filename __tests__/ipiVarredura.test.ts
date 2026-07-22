/**
 * Varredura de IPI (motivação: caso Experte 06/2026) — classifica cada empresa
 * de Lucro: "pronta" (há mês-modelo com IPI no MIT → transmite sozinha) vs
 * "precisa_lancamento" (1º IPI da empresa → lançar 1x no e-CAC).
 */
import {
    normalizarCompetencia, calcularIpiApuradoFicha, acharFichaCompetencia,
    classificarIpiEmpresa, resumirVarreduraIpi,
} from '../sefaz-backend/ipi-varredura';

describe('normalizarCompetencia', () => {
    it('aceita YYYY-MM, YYYY-MM-DD e MM/YYYY', () => {
        expect(normalizarCompetencia('2026-06')).toBe('2026-06');
        expect(normalizarCompetencia('2026-06-15')).toBe('2026-06');
        expect(normalizarCompetencia('06/2026')).toBe('2026-06');
    });
    it('null para lixo', () => {
        expect(normalizarCompetencia('junho')).toBeNull();
        expect(normalizarCompetencia('')).toBeNull();
        expect(normalizarCompetencia(null)).toBeNull();
    });
});

describe('calcularIpiApuradoFicha — mesma fórmula do lucroService', () => {
    it('max(0, ipiRecolher - saldoCredorIpi)', () => {
        expect(calcularIpiApuradoFicha({ ipiRecolher: 7352.9 })).toBe(7352.9);
        expect(calcularIpiApuradoFicha({ ipiRecolher: 1000, saldoCredorIpi: 300 })).toBe(700);
        expect(calcularIpiApuradoFicha({ ipiRecolher: 500, saldoCredorIpi: 900 })).toBe(0);
    });
    it('0 sem ficha ou sem IPI', () => {
        expect(calcularIpiApuradoFicha(null)).toBe(0);
        expect(calcularIpiApuradoFicha({})).toBe(0);
        expect(calcularIpiApuradoFicha({ ipiRecolher: 0 })).toBe(0);
    });
});

describe('acharFichaCompetencia', () => {
    const fichas = [
        { mesReferencia: '2026-05', ipiRecolher: 1 },
        { mesReferencia: '2026-06', ipiRecolher: 2 },
    ];
    it('acha pela competência normalizada', () => {
        expect(acharFichaCompetencia(fichas, '2026-06')?.ipiRecolher).toBe(2);
        expect(acharFichaCompetencia(fichas, '06/2026')?.ipiRecolher).toBe(2);
    });
    it('null quando não há', () => {
        expect(acharFichaCompetencia(fichas, '2026-07')).toBeNull();
        expect(acharFichaCompetencia(null, '2026-06')).toBeNull();
    });
});

describe('classificarIpiEmpresa', () => {
    it('sem IPI → sem_ipi', () => {
        expect(classificarIpiEmpresa({ ipiApurado: 0, temModeloIpi: false }).status).toBe('sem_ipi');
    });
    it('IPI + modelo → pronta', () => {
        const r = classificarIpiEmpresa({ ipiApurado: 7352.9, temModeloIpi: true });
        expect(r.status).toBe('pronta');
        expect(r.prioridade).toBe(1);
    });
    it('IPI sem modelo → precisa_lancamento (e-CAC 1x)', () => {
        const r = classificarIpiEmpresa({ ipiApurado: 100, temModeloIpi: false });
        expect(r.status).toBe('precisa_lancamento');
        expect(r.acao).toMatch(/e-CAC/);
        expect(r.prioridade).toBe(3);
    });
    it('erro de consulta prevalece sobre modelo desconhecido', () => {
        const r = classificarIpiEmpresa({ ipiApurado: 100, temModeloIpi: false, erroConsulta: 'cStat 656' });
        expect(r.status).toBe('erro_consulta');
        expect(r.acao).toMatch(/656/);
    });
});

describe('resumirVarreduraIpi', () => {
    it('conta por status e soma IPI em risco (precisa + erro)', () => {
        const resumo = resumirVarreduraIpi([
            { status: 'pronta', ipiApurado: 1000 },
            { status: 'precisa_lancamento', ipiApurado: 500 },
            { status: 'erro_consulta', ipiApurado: 200 },
            { status: 'sem_ipi', ipiApurado: 0 },
            { status: 'sem_ipi', ipiApurado: 0 },
        ]);
        expect(resumo).toEqual({
            total: 5, comIpi: 3, pronta: 1, precisaLancamento: 1,
            erroConsulta: 1, semIpi: 2,
            ipiTotalApurado: 1700, ipiTotalEmRisco: 700,
        });
    });
});
