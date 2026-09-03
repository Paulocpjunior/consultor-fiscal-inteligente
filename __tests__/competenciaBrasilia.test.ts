// ═══════════════════════════════════════════════════════════════════════════
// DATA E HORA DE BRASÍLIA — o dono (competencia.js), 03/09.
//
// O Cloud Run é UTC: `toISOString()` das 21h à meia-noite BRT já marca o dia
// seguinte. Uma NFS-e emitida em 31/08 às 22h nascia com competência 01/09.
// ═══════════════════════════════════════════════════════════════════════════
import { dataBrasilia, dataHoraBrasilia } from '../sefaz-backend/competencia.js';
// @ts-expect-error — modulo .js puro (sem .d.ts)
import { hojeIso } from '../sefaz-backend/darf-payload-builder.js';

describe('dataHoraBrasilia', () => {
    it('01/09 01h UTC é 31/08 22h em Brasília, na forma do XSD', () => {
        expect(dataHoraBrasilia(new Date('2026-09-01T01:00:00.000Z'))).toBe('2026-08-31T22:00:00-03:00');
    });
    it('sem Z, sem milissegundos, com o deslocamento explícito', () => {
        expect(dataHoraBrasilia('2026-06-04T18:00:00.123Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/);
    });
    it('data inválida devolve null — nunca "agora"', () => {
        expect(dataHoraBrasilia('ontem')).toBeNull();
        expect(dataBrasilia('ontem')).toBeNull();
    });
});

describe('dataBrasilia', () => {
    it('vira o dia só à meia-noite de Brasília', () => {
        expect(dataBrasilia(new Date('2026-09-01T02:59:59Z'))).toBe('2026-08-31');
        expect(dataBrasilia(new Date('2026-09-01T03:00:00Z'))).toBe('2026-09-01');
    });
    it('hojeIso do DARF delega ao dono (uma régua de "hoje")', () => {
        expect(hojeIso()).toBe(dataBrasilia(new Date()));
    });
});
