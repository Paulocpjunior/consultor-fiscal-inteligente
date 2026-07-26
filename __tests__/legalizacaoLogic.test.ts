/**
 * legalizacaoLogic.test.ts — espelho frontend do farol de Legalização
 * (services/legalizacaoLogic.ts). Os limiares DEVEM bater com o backend
 * (sefaz-backend/legalizacao-helper.js) — pacto de sincronia manual.
 */
import {
    diasAteVencimento,
    classificarVencimento,
    fmtCnpj,
    fmtDataBr,
    TIPO_PROCESSO_LABEL,
    STATUS_PROCESSO_LABEL,
} from '../services/legalizacaoLogic';
import { classificarVencimento as classificarBackend } from '../sefaz-backend/legalizacao-helper.js';

describe('diasAteVencimento', () => {
    const hoje = new Date(2026, 6, 26); // 26/07/2026
    it('conta dias sem off-by-one de fuso', () => {
        expect(diasAteVencimento('2026-07-26', hoje)).toBe(0);
        expect(diasAteVencimento('2026-07-27', hoje)).toBe(1);
        expect(diasAteVencimento('2026-08-25', hoje)).toBe(30);
        expect(diasAteVencimento('2026-07-25', hoje)).toBe(-1);
    });
    it('data inválida → null', () => {
        expect(diasAteVencimento(null, hoje)).toBeNull();
        expect(diasAteVencimento('25/07/2026', hoje)).toBeNull();
    });
});

describe('classificarVencimento (espelho do backend)', () => {
    it('mesmos limiares do sefaz-backend/legalizacao-helper.js', () => {
        for (const dias of [-10, -1, 0, 1, 7, 8, 15, 30, 31, 100, null]) {
            expect(classificarVencimento(dias as number | null)).toBe(classificarBackend(dias));
        }
    });
});

describe('labels e formatação', () => {
    it('todo tipo/status de processo tem rótulo', () => {
        expect(Object.values(TIPO_PROCESSO_LABEL).every(l => l.length > 2)).toBe(true);
        expect(Object.values(STATUS_PROCESSO_LABEL).every(l => l.length > 2)).toBe(true);
    });
    it('fmtCnpj e fmtDataBr', () => {
        expect(fmtCnpj('44388152000189')).toBe('44.388.152/0001-89');
        expect(fmtDataBr('2026-12-28')).toBe('28/12/2026');
    });
});
