/**
 * Janela do cron do portal NFS-e SP — dois bugs em sequência travados aqui:
 *  1) default "mês anterior" → julho nunca era capturado (última nota 30/06).
 *  2) janela única de 40d cruzando meses → portal devolve HTML em vez de CSV
 *     (313/313 falhas em 23/07). A exportação só aceita período INTRA-MÊS.
 */
jest.mock('../sefaz-backend/secret-loader.js', () => ({ loadCertificate: jest.fn() }));
jest.mock('../sefaz-backend/nfse-sp-headless-login.js', () => ({ loginHeadlessPortalSp: jest.fn() }));
jest.mock('../sefaz-backend/nfse-sp-csv-importer.js', () => ({ importarCsvNfseSp: jest.fn() }));
jest.mock('firebase-admin', () => ({ __esModule: true, default: { apps: [{}], firestore: () => ({}) } }));

// @ts-expect-error — módulo .js
import { periodosJanelaPorMes, periodoMesAnterior } from '../sefaz-backend/nfse-sp-portal-orchestrator';

describe('periodosJanelaPorMes (default do cron)', () => {
    it('23/07: fatia em junho FECHADO + julho até ONTEM (nunca cruza mês)', () => {
        const p = periodosJanelaPorMes(new Date(2026, 6, 23)); // 23/07/2026
        expect(p).toEqual([
            { dataInicio: '01/06/2026', dataFim: '30/06/2026', anoMes: '2026-06' },
            { dataInicio: '01/07/2026', dataFim: '22/07/2026', anoMes: '2026-07' },
        ]);
    });

    it('dia 1º do mês: mês corrente ainda não tem ontem → só meses anteriores', () => {
        const p = periodosJanelaPorMes(new Date(2026, 7, 1)); // 01/08/2026
        // ontem = 31/07 → último período é julho fechado; agosto não entra.
        expect(p[p.length - 1]).toEqual({ dataInicio: '01/07/2026', dataFim: '31/07/2026', anoMes: '2026-07' });
        expect(p.every((x: { anoMes: string }) => x.anoMes !== '2026-08')).toBe(true);
    });

    it('virada de ano: 10/01 cobre dezembro fechado + janeiro até ontem', () => {
        const p = periodosJanelaPorMes(new Date(2026, 0, 10)); // 10/01/2026
        expect(p[0]).toEqual({ dataInicio: '01/12/2025', dataFim: '31/12/2025', anoMes: '2025-12' });
        expect(p[1]).toEqual({ dataInicio: '01/01/2026', dataFim: '09/01/2026', anoMes: '2026-01' });
    });

    it('nenhum período cruza fronteira de mês (dataInicio e dataFim no mesmo mês)', () => {
        for (const dia of [1, 5, 15, 28]) {
            for (const per of periodosJanelaPorMes(new Date(2026, 6, dia))) {
                const [, mi, ai] = per.dataInicio.split('/');
                const [, mf, af] = per.dataFim.split('/');
                expect(`${mi}/${ai}`).toBe(`${mf}/${af}`);
            }
        }
    });
});

describe('periodoMesAnterior (mantida p/ backfill explícito)', () => {
    it('em julho devolve junho fechado', () => {
        const p = periodoMesAnterior(new Date(2026, 6, 22));
        expect(p.dataInicio).toBe('01/06/2026');
        expect(p.dataFim).toBe('30/06/2026');
        expect(p.anoMes).toBe('2026-06');
    });
    it('em janeiro devolve dezembro do ano anterior', () => {
        const p = periodoMesAnterior(new Date(2026, 0, 5));
        expect(p.dataInicio).toBe('01/12/2025');
        expect(p.dataFim).toBe('31/12/2025');
        expect(p.anoMes).toBe('2025-12');
    });
});
