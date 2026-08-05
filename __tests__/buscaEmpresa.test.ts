/**
 * Régua única da busca de empresa (código, nome, CNPJ).
 *
 * Paulo, 05/08: procurou a S&P "pelo número" na lista do Simples e não achou
 * — a busca por código tinha entrado só no seletor das telas de XML. Regra
 * única aqui, pra lista nova nenhuma nascer sem o código de novo.
 */
import { empresaBateBusca, prefixoCodCliente } from '../services/buscaEmpresa';

const SEP = {
    nome: 'S&P ASSESSORIA CONTABIL S/S',
    cnpj: '44.388.152/0001-89',
    dadosFiscais: { codCliente: '1200' },
};

describe('empresaBateBusca', () => {
    it('nome (parcial, sem caixa) e CNPJ (com ou sem máscara) seguem valendo', () => {
        expect(empresaBateBusca('assessoria', SEP)).toBe(true);
        expect(empresaBateBusca('44388152', SEP)).toBe(true);
        expect(empresaBateBusca('44.388.152/0001-89', SEP)).toBe(true);
    });

    it('acha pelo código — com pad, sem pad e por prefixo', () => {
        expect(empresaBateBusca('1200', SEP)).toBe(true);
        expect(empresaBateBusca('12', SEP)).toBe(true);      // prefixo
        const cod17 = { ...SEP, dadosFiscais: { codCliente: '0017' } };
        expect(empresaBateBusca('17', cod17)).toBe(true);    // sem os zeros
        expect(empresaBateBusca('0017', cod17)).toBe(true);
    });

    it('código é identidade, não substring — "200" não acha a 1200 pelo código', () => {
        // CNPJ sem "200" no meio pra isolar a régua do código (a busca por
        // trecho de CNPJ continua valendo e é outro caminho).
        const semDigitos = { nome: 'ALFA LTDA', cnpj: '11.111.111/1111-11', dadosFiscais: { codCliente: '1200' } };
        expect(empresaBateBusca('200', semDigitos)).toBe(false);
        expect(empresaBateBusca('1200', semDigitos)).toBe(true);
    });

    it('empresa sem código não quebra e busca vazia mostra todas', () => {
        expect(empresaBateBusca('12', { nome: 'X', cnpj: '1', dadosFiscais: {} })).toBe(false);
        expect(empresaBateBusca('', SEP)).toBe(true);
    });
});

describe('prefixoCodCliente — o código antes do nome, como no E-Fiscal', () => {
    it('com código, prefixa; sem código, string vazia (nada renderiza)', () => {
        expect(prefixoCodCliente(SEP)).toBe('1200 · ');
        expect(prefixoCodCliente({ nome: 'X' })).toBe('');
    });
});
