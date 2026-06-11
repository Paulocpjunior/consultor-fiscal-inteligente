jest.mock('firebase/auth', () => ({
    getAuth: () => ({ currentUser: null }),
}));

import { parseValorMoedaBr } from '../services/dasService';

describe('dasService parseValorMoedaBr', () => {
    it.each([
        ['4.652,41', 4652.41],
        ['R$ 4.652,41', 4652.41],
        ['4652,41', 4652.41],
        ['4652.41', 4652.41],
        ['4,65', 4.65],
    ])('converte %s para %d', (input, expected) => {
        expect(parseValorMoedaBr(input)).toBe(expected);
    });

    it('retorna zero para valor vazio ou invalido', () => {
        expect(parseValorMoedaBr('')).toBe(0);
        expect(parseValorMoedaBr('abc')).toBe(0);
    });
});
