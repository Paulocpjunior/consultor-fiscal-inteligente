// @ts-ignore modulo .js puro
import { assertValorMinimoDas, normalizarValorDas, parseValorDas } from '../sefaz-backend/das-valor-utils.js';

describe('das-valor-utils', () => {
    it.each([
        ['4.652,41', 4652.41],
        ['R$ 4.652,41', 4652.41],
        ['4652,41', 4652.41],
        ['4652.41', 4652.41],
        [4652.41, 4652.41],
    ])('parseValorDas converte %s para %d', (input, expected) => {
        expect(parseValorDas(input)).toBe(expected);
        expect(normalizarValorDas(input)).toBe(expected);
    });

    it('assertValorMinimoDas devolve numero normalizado quando valor >= 10', () => {
        expect(assertValorMinimoDas('4.652,41')).toBe(4652.41);
    });

    it('assertValorMinimoDas rejeita valores abaixo do minimo', () => {
        expect(() => assertValorMinimoDas('4,65')).toThrow('Valor mínimo R$ 10,00');
        expect(() => assertValorMinimoDas('abc')).toThrow('Valor mínimo R$ 10,00');
    });
});
