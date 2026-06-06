/**
 * Testes do helper de competências — regra crítica: mês atual NÃO entra.
 */
// @ts-expect-error — módulo .js puro
import { ultimasCompetencias, ultimasCompetenciasComAnoMes } from '../sefaz-backend/competencias-helper.js';

describe('ultimasCompetencias — regra "mês atual não entra"', () => {
    it('em 06/jun/2026, últimas 3 = [maio, abril, março] (mês atual excluído)', () => {
        const r = ultimasCompetencias(3, '2026-06-06T12:00:00Z');
        expect(r).toEqual(['2026-05', '2026-04', '2026-03']);
    });

    it('em 01/jun/2026 às 00:01 BRT (primeiro dia) — ainda exclui junho', () => {
        const r = ultimasCompetencias(1, '2026-06-01T03:01:00Z'); // 00:01 BRT
        expect(r).toEqual(['2026-05']);
    });

    it('em 30/jun/2026 às 23:59 — ainda exclui junho', () => {
        const r = ultimasCompetencias(1, '2026-06-30T23:59:00Z');
        expect(r).toEqual(['2026-05']);
    });

    it('vira ano corretamente — em 15/jan/2026 últimas 3 = [dez, nov, out de 2025]', () => {
        const r = ultimasCompetencias(3, '2026-01-15T12:00:00Z');
        expect(r).toEqual(['2025-12', '2025-11', '2025-10']);
    });

    it('vira ano múltiplas vezes — em 15/mar/2026 últimas 15 atravessa para 2024', () => {
        const r = ultimasCompetencias(15, '2026-03-15T12:00:00Z');
        expect(r[0]).toBe('2026-02');
        expect(r[r.length - 1]).toBe('2024-12');
    });

    it('n=12 em jun/2026 cobre todo um ciclo (mai/26 até jun/25)', () => {
        const r = ultimasCompetencias(12, '2026-06-06T12:00:00Z');
        expect(r).toHaveLength(12);
        expect(r[0]).toBe('2026-05');
        expect(r[11]).toBe('2025-06');
    });

    it('n inválido → []', () => {
        expect(ultimasCompetencias(0)).toEqual([]);
        expect(ultimasCompetencias(-1)).toEqual([]);
        expect(ultimasCompetencias(NaN)).toEqual([]);
    });
});

describe('ultimasCompetenciasComAnoMes — formato DCTFWeb', () => {
    it('expõe anoPA + mesPA separados (queries Firestore por anoPA)', () => {
        const r = ultimasCompetenciasComAnoMes(3, '2026-06-06T12:00:00Z');
        expect(r).toEqual([
            { anoPA: 2026, mesPA: 5, label: '2026-05' },
            { anoPA: 2026, mesPA: 4, label: '2026-04' },
            { anoPA: 2026, mesPA: 3, label: '2026-03' },
        ]);
    });

    it('vira ano corretamente — em 15/jan/2026', () => {
        const r = ultimasCompetenciasComAnoMes(2, '2026-01-15T12:00:00Z');
        expect(r[0]).toEqual({ anoPA: 2025, mesPA: 12, label: '2025-12' });
        expect(r[1]).toEqual({ anoPA: 2025, mesPA: 11, label: '2025-11' });
    });
});
