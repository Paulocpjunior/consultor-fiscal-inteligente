/**
 * Testes do secretsMatch compartilhado (comparação de segredo em tempo constante).
 */
// @ts-expect-error — módulo .js puro
import { secretsMatch } from '../sefaz-backend/cron-secret.js';

describe('secretsMatch', () => {
    it('iguais → true', () => {
        expect(secretsMatch('abc123', 'abc123')).toBe(true);
    });

    it('diferentes de mesmo tamanho → false', () => {
        expect(secretsMatch('abc123', 'abc124')).toBe(false);
    });

    it('tamanhos diferentes → false (sem lançar)', () => {
        expect(secretsMatch('abc', 'abcdef')).toBe(false);
        expect(secretsMatch('abcdef', 'abc')).toBe(false);
    });

    it('vazio/null/undefined → false', () => {
        expect(secretsMatch('', 'x')).toBe(false);
        expect(secretsMatch('x', '')).toBe(false);
        expect(secretsMatch(null, 'x')).toBe(false);
        expect(secretsMatch('x', undefined)).toBe(false);
        expect(secretsMatch(undefined, undefined)).toBe(false);
    });

    it('coage para string (número igual)', () => {
        expect(secretsMatch(12345, '12345')).toBe(true);
    });
});
