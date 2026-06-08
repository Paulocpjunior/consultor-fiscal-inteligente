import {
    validarCnpj,
    validarCpf,
    limparCnpj,
    limparCpf,
    formatarCnpj,
    formatarCpf,
} from '../services/validadorDocumento';

describe('validarCnpj — numérico', () => {
    it('aceita CNPJ válido formatado', () => {
        expect(validarCnpj('11.222.333/0001-81')).toBe(true);
    });
    it('aceita CNPJ válido sem formatação', () => {
        expect(validarCnpj('11222333000181')).toBe(true);
    });
    it('rejeita DV errado', () => {
        expect(validarCnpj('11.222.333/0001-82')).toBe(false);
    });
    it('rejeita string vazia', () => {
        expect(validarCnpj('')).toBe(false);
    });
    it('rejeita tamanho diferente de 14', () => {
        expect(validarCnpj('1122233300018')).toBe(false);   // 13
        expect(validarCnpj('112223330001811')).toBe(false); // 15
    });
    it('rejeita sequência única (todos zeros)', () => {
        expect(validarCnpj('00000000000000')).toBe(false);
    });
    it('rejeita sequências repetidas', () => {
        expect(validarCnpj('11111111111111')).toBe(false);
    });
});

describe('validarCnpj — alfanumérico (IN RFB 2.229/2024)', () => {
    it('rejeita se os 2 últimos não forem numéricos', () => {
        expect(validarCnpj('12ABC34501DE5X')).toBe(false);
    });
    it('aceita CNPJ alfanumérico real (exemplo da RFB: 12.ABC.345/01DE-35)', () => {
        // exemplo oficial publicado pela RFB no manual de cálculo do CNPJ alfanumérico
        expect(validarCnpj('12ABC34501DE35')).toBe(true);
    });
    it('rejeita alfanumérico com DV errado', () => {
        expect(validarCnpj('12ABC34501DE34')).toBe(false);
    });
});

describe('validarCpf', () => {
    it('aceita CPF válido', () => {
        expect(validarCpf('529.982.247-25')).toBe(true);
    });
    it('rejeita sequência repetida', () => {
        expect(validarCpf('111.111.111-11')).toBe(false);
    });
    it('rejeita CPF inválido', () => {
        expect(validarCpf('529.982.247-26')).toBe(false);
    });
    it('rejeita string vazia', () => {
        expect(validarCpf('')).toBe(false);
    });
    it('rejeita tamanho ≠ 11', () => {
        expect(validarCpf('1234567890')).toBe(false);
    });
});

describe('formatação', () => {
    it('formata CNPJ numérico', () => {
        expect(formatarCnpj('11222333000181')).toBe('11.222.333/0001-81');
    });
    it('formata CNPJ alfanumérico', () => {
        expect(formatarCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
    });
    it('formata CPF', () => {
        expect(formatarCpf('52998224725')).toBe('529.982.247-25');
    });
    it('limpa caracteres em CNPJ alfanumérico preservando letras', () => {
        expect(limparCnpj('12.ABC.345/01DE-35')).toBe('12ABC34501DE35');
    });
    it('limpa CPF', () => {
        expect(limparCpf('529.982.247-25')).toBe('52998224725');
    });
});
