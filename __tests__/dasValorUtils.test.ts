// @ts-ignore modulo .js puro
import { assertValorMinimoDas, normalizarValorDas, parseValorDas, dinheiroDeEntrada } from '../sefaz-backend/das-valor-utils.js';
import { parseValorMoeda } from '../services/valorDigitado';

// ═══ UMA RÉGUA PARA TEXTO DE DINHEIRO (03/09) ═══════════════════════════════
// `parseValorDas('10.500')` lia 10,50 e o `numeroDeTexto` do SPED lia
// 10.500,00 — dois leitores, dois valores para a MESMA guia. A régua adotada
// é a do frontend (`parseValorMoeda`): "10.500" é MILHAR em pt-BR.
describe('dinheiroDeEntrada — o dono, espelho de parseValorMoeda', () => {
    it.each([
        ['10.500', 10500],
        ['1.234,56', 1234.56],
        ['1234.56', 1234.56],
        ['10,5', 10.5],
        ['R$ 3.241.688,71', 3241688.71],
        ['1.234', 1234],
        [4652.41, 4652.41],
    ])('lê %s como %s', (entrada, esperado) => {
        expect(dinheiroDeEntrada(entrada)).toBe(esperado);
    });

    it('responde EXATAMENTE o que o frontend responde, texto a texto', () => {
        for (const t of ['10.500', '1.234,56', '1234.56', '10,5', '1.234', '3241688,71', 'abc', '', '-5']) {
            expect({ t, n: dinheiroDeEntrada(t) }).toEqual({ t, n: parseValorMoeda(t) });
        }
    });

    it('ilegível, negativo e não finito devolvem null — nunca zero de conveniência', () => {
        for (const lixo of ['abc', '', null, undefined, '-5', -1, NaN, Infinity, '1,2,3']) {
            expect({ lixo, n: dinheiroDeEntrada(lixo as any) }).toEqual({ lixo, n: null });
        }
    });
});

describe('das-valor-utils', () => {
    it.each([
        ['4.652,41', 4652.41],
        ['R$ 4.652,41', 4652.41],
        ['4652,41', 4652.41],
        ['4652.41', 4652.41],
        [4652.41, 4652.41],
        // A divergência que existia: ponto seguido de 3 dígitos é MILHAR.
        ['10.500', 10500],
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
