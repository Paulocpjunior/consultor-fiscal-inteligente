import { aliquotasReformaPorAno, aliquotasReformaPorCompetencia, statusReforma } from '../services/reformaTributariaConfig';

describe('reformaTributariaConfig', () => {
    describe('aliquotasReformaPorAno', () => {
        it('antes de 2026: pre-reforma, PIS/COFINS vigente', () => {
            const a = aliquotasReformaPorAno(2025);
            expect(a.fase).toBe('pre-reforma');
            expect(a.pisCofinsVigente).toBe(true);
            expect(a.cbs).toBe(0);
            expect(a.ibs).toBe(0);
            expect(a.fatorIcmsIss).toBe(1);
        });

        it('2026: fase de teste — CBS 0,9% + IBS 0,1% compensaveis', () => {
            const a = aliquotasReformaPorAno(2026);
            expect(a.fase).toBe('teste-2026');
            expect(a.cbs).toBeCloseTo(0.009, 4);
            expect(a.ibs).toBeCloseTo(0.001, 4);
            expect(a.compensavelComPisCofins).toBe(true);
            expect(a.pisCofinsVigente).toBe(true);
        });

        it('2027: CBS plena, PIS/COFINS extintos', () => {
            const a = aliquotasReformaPorAno(2027);
            expect(a.fase).toBe('cbs-2027');
            expect(a.pisCofinsVigente).toBe(false);
            expect(a.cbs).toBeGreaterThan(0.08);
            expect(a.fatorIcmsIss).toBe(1);
        });

        it('2029: ICMS/ISS reduzidos para 90%', () => {
            const a = aliquotasReformaPorAno(2029);
            expect(a.fase).toBe('transicao-ibs');
            expect(a.fatorIcmsIss).toBeCloseTo(0.90, 2);
        });

        it('2030, 2031, 2032: reducao progressiva', () => {
            expect(aliquotasReformaPorAno(2030).fatorIcmsIss).toBeCloseTo(0.80, 2);
            expect(aliquotasReformaPorAno(2031).fatorIcmsIss).toBeCloseTo(0.70, 2);
            expect(aliquotasReformaPorAno(2032).fatorIcmsIss).toBeCloseTo(0.60, 2);
        });

        it('2033+: reforma completa, ICMS/ISS extintos', () => {
            const a = aliquotasReformaPorAno(2033);
            expect(a.fase).toBe('reforma-completa');
            expect(a.fatorIcmsIss).toBe(0);
            expect(a.cbs).toBeGreaterThan(0);
            expect(a.ibs).toBeGreaterThan(0);
        });
    });

    describe('aliquotasReformaPorCompetencia', () => {
        it('parseia MM/YYYY corretamente', () => {
            expect(aliquotasReformaPorCompetencia('06/2026').fase).toBe('teste-2026');
            expect(aliquotasReformaPorCompetencia('01/2030').fase).toBe('transicao-ibs');
        });
        it('competencia invalida cai no ano corrente sem quebrar', () => {
            const a = aliquotasReformaPorCompetencia('xx/yyyy');
            expect(a.ano).toBe(new Date().getFullYear());
        });
    });

    describe('statusReforma', () => {
        it('devolve string curta por ano', () => {
            expect(statusReforma(2025)).toMatch(/Pre-reforma/);
            expect(statusReforma(2026)).toMatch(/Teste/);
            expect(statusReforma(2027)).toMatch(/CBS plena/);
            expect(statusReforma(2033)).toMatch(/completa/);
        });
    });
});
