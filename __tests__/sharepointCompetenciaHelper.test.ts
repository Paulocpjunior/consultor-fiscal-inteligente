/**
 * Trava a janela de competências do auto-sync SharePoint. Caso real:
 * J.N. VINATEX, 07/07/2026 — o auto-sync só varria a pasta do mês atual
 * (07-2026), então os XMLs de junho depositados no SharePoint depois da
 * virada do mês nunca eram capturados e a Central mostrava 06/2026 vazio.
 */
import { competenciasAutoSync } from '../sefaz-backend/sharepoint-competencia-helper';

const JUL_07_2026 = Date.UTC(2026, 6, 7, 12, 0, 0);

describe('competenciasAutoSync', () => {
    it('default: varre competência anterior + atual, mais antiga primeiro', () => {
        expect(competenciasAutoSync(JUL_07_2026)).toEqual(['2026-06', '2026-07']);
    });

    it('vira o ano: janeiro varre dezembro do ano anterior', () => {
        const jan = Date.UTC(2026, 0, 5, 12, 0, 0);
        expect(competenciasAutoSync(jan)).toEqual(['2025-12', '2026-01']);
    });

    it('competência explícita válida vale sozinha (disparo manual)', () => {
        expect(competenciasAutoSync(JUL_07_2026, { explicita: '2026-04' }))
            .toEqual(['2026-04']);
    });

    it('competência explícita inválida é ignorada — cai na janela default', () => {
        expect(competenciasAutoSync(JUL_07_2026, { explicita: 'junho/2026' }))
            .toEqual(['2026-06', '2026-07']);
        expect(competenciasAutoSync(JUL_07_2026, { explicita: '' }))
            .toEqual(['2026-06', '2026-07']);
    });

    it('janelas configurável, com clamp 1..6', () => {
        expect(competenciasAutoSync(JUL_07_2026, { janelas: 3 }))
            .toEqual(['2026-05', '2026-06', '2026-07']);
        expect(competenciasAutoSync(JUL_07_2026, { janelas: 1 }))
            .toEqual(['2026-07']);
        expect(competenciasAutoSync(JUL_07_2026, { janelas: 0 }))
            .toEqual(['2026-06', '2026-07']); // 0/NaN → default 2
        expect(competenciasAutoSync(JUL_07_2026, { janelas: 99 }))
            .toHaveLength(6);
    });

    it('timestamp inválido não explode — usa data corrente', () => {
        const out = competenciasAutoSync(NaN);
        expect(out).toHaveLength(2);
        expect(out[0] < out[1]).toBe(true);
        out.forEach(c => expect(c).toMatch(/^\d{4}-\d{2}$/));
    });
});
