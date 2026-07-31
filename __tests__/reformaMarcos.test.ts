/**
 * Cronograma escalonado dos campos IBS/CBS (Ato Conjunto RFB/CGIBS nº 4/2026,
 * 31/07/2026): NF-e e cia seguem 03/08/2026; NFS-e 01/10; NFAg/ABI 01/12;
 * Simples Nacional 01/01/2027.
 */
import { estadoMarcosReforma, cronogramaCompacto, MARCOS_REFORMA, fmtDataBr } from '../services/reformaMarcos';

describe('estadoMarcosReforma', () => {
    it('antes de 03/08: próximo marco é NF-e/NFC-e/CT-e/MDF-e com contagem certa', () => {
        const e = estadoMarcosReforma(new Date(2026, 6, 31)); // 31/07/2026
        expect(e.proximo?.dataIso).toBe('2026-08-03');
        expect(e.diasAteProximo).toBe(3);
        expect(e.vigentes).toHaveLength(0);
    });

    it('no dia 03/08 o marco é "hoje" (0 dias) — banner grita É HOJE', () => {
        const e = estadoMarcosReforma(new Date(2026, 7, 3));
        expect(e.proximo?.dataIso).toBe('2026-08-03');
        expect(e.diasAteProximo).toBe(0);
        expect(e.vigentes).toHaveLength(0);
    });

    it('entre 03/08 e 01/10: NF-e vigente, próximo = NFS-e', () => {
        const e = estadoMarcosReforma(new Date(2026, 8, 15)); // 15/09/2026
        expect(e.vigentes).toHaveLength(1);
        expect(e.proximo?.docs).toBe('NFS-e');
        expect(e.diasAteProximo).toBe(16);
    });

    it('dezembro/2026: falta só o Simples (01/01/2027)', () => {
        const e = estadoMarcosReforma(new Date(2026, 11, 15));
        expect(e.vigentes).toHaveLength(3);
        expect(e.proximo?.publico).toContain('Simples Nacional');
    });

    it('depois de 01/01/2027: tudo vigente, banner aposenta', () => {
        const e = estadoMarcosReforma(new Date(2027, 0, 2));
        expect(e.proximo).toBeNull();
        expect(e.vigentes).toHaveLength(MARCOS_REFORMA.length);
    });

    it('cronograma compacto lista os 4 lotes', () => {
        const c = cronogramaCompacto();
        expect(c).toContain('03/08 NF-e, NFC-e, CT-e e MDF-e');
        expect(c).toContain('01/10 NFS-e');
        expect(c).toContain('01/12 NFAg e NF-e ABI');
        expect(c).toContain('01/01/27 todos os documentos + Duimp');
    });

    it('fmtDataBr', () => {
        expect(fmtDataBr('2026-08-03')).toBe('03/08/2026');
    });
});
