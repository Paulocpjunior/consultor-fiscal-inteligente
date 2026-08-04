/**
 * Selo "novo" do 📣 Novidades.
 *
 * O que precisa ficar travado: versão nova REACENDE o aviso sozinha (senão o
 * comunicado atualizado passa batido, que é o caso oposto do relato de 04/08).
 */
import {
    NOVIDADES_VERSAO, temNovidadeNaoLida,
} from '../services/novidadesService';

describe('temNovidadeNaoLida', () => {
    it('quem nunca abriu vê o selo', () => {
        expect(temNovidadeNaoLida('2026-08-04', null)).toBe(true);
        expect(temNovidadeNaoLida('2026-08-04', undefined)).toBe(true);
        expect(temNovidadeNaoLida('2026-08-04', '')).toBe(true);
    });

    it('quem abriu a versão atual não vê', () => {
        expect(temNovidadeNaoLida('2026-08-04', '2026-08-04')).toBe(false);
        expect(temNovidadeNaoLida('2026-08-04', ' 2026-08-04 ')).toBe(false);
    });

    it('versão NOVA reacende o selo mesmo pra quem já tinha lido a anterior', () => {
        expect(temNovidadeNaoLida('2026-08-04', '2026-08-03')).toBe(true);
    });

    it('sem versão configurada não inventa aviso', () => {
        expect(temNovidadeNaoLida('', '2026-08-03')).toBe(false);
    });

    it('a constante segue o formato AAAA-MM-DD (é o "atualizado em" da página)', () => {
        expect(NOVIDADES_VERSAO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});
