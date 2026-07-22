/**
 * Janela do cron do portal NFS-e SP — regressão do bug 22/07/2026: o default
 * era "mês anterior completo", então em julho o cron re-baixava junho toda
 * noite ("0 novas") e NUNCA capturava o mês corrente (última nota presa em
 * 30/06 por 3 semanas).
 */
jest.mock('../sefaz-backend/secret-loader.js', () => ({ loadCertificate: jest.fn() }));
jest.mock('../sefaz-backend/nfse-sp-headless-login.js', () => ({ loginHeadlessPortalSp: jest.fn() }));
jest.mock('../sefaz-backend/nfse-sp-csv-importer.js', () => ({ importarCsvNfseSp: jest.fn() }));
jest.mock('firebase-admin', () => ({ __esModule: true, default: { apps: [{}], firestore: () => ({}) } }));

// @ts-expect-error — módulo .js
import { periodoJanelaCorrente, periodoMesAnterior } from '../sefaz-backend/nfse-sp-portal-orchestrator';

describe('periodoJanelaCorrente (default do cron)', () => {
    it('cobre o MÊS CORRENTE: em 22/07 a janela termina HOJE, não em 30/06', () => {
        const hoje = new Date(2026, 6, 22); // 22/07/2026
        const p = periodoJanelaCorrente(hoje);
        expect(p.dataFim).toBe('22/07/2026');
        expect(p.dataInicio).toBe('12/06/2026'); // 40 dias atrás
        expect(p.anoMes).toBe('2026-07');
    });

    it('atravessa virada de ano', () => {
        const p = periodoJanelaCorrente(new Date(2026, 0, 10)); // 10/01/2026
        expect(p.dataFim).toBe('10/01/2026');
        expect(p.dataInicio).toBe('01/12/2025');
    });

    it('dias customizável', () => {
        const p = periodoJanelaCorrente(new Date(2026, 6, 22), 10);
        expect(p.dataInicio).toBe('12/07/2026');
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
