/**
 * Cod.Cliente — o código da empresa no E-Fiscal.
 *
 * Paulo, 04/08: "os códigos devem permanecer OS MESMOS ... toda amarração será
 * pelo CNPJ, esse será o ponto de confronto ... 4 dígitos respeitando o zero à
 * esquerda, 0001 até 9999".
 *
 * O erro que estes testes impedem é o silencioso: "0001" virar 1 (número) em
 * algum ponto do caminho e o confronto com o schema e0001 do PG12 falhar só
 * na extração — quando ninguém mais lembra de onde veio o campo.
 */
import {
    normalizarCodCliente, codClienteValido, schemaDoCodCliente,
} from '../sefaz-backend/cod-cliente.js';
import { sanitizarDadosFiscais } from '../services/empresaDadosFiscaisSanitize';

describe('normalizarCodCliente — a régua do E-Fiscal', () => {
    it('preserva o zero à esquerda (a razão de o campo ser TEXTO)', () => {
        expect(normalizarCodCliente('0001')).toEqual({ ok: true, valor: '0001' });
        expect(normalizarCodCliente('0587')).toEqual({ ok: true, valor: '0587' });
    });

    it('dígito curto ganha os zeros — "1" digitado é o cliente 0001', () => {
        expect(normalizarCodCliente('1')).toEqual({ ok: true, valor: '0001' });
        expect(normalizarCodCliente('42')).toEqual({ ok: true, valor: '0042' });
        expect(normalizarCodCliente('1154')).toEqual({ ok: true, valor: '1154' });
    });

    it('a faixa termina em 9999 — 5 dígitos é recusado, não truncado', () => {
        const r = normalizarCodCliente('10001');
        expect(r.ok).toBe(false);
        expect((r as any).erro).toMatch(/4 dígitos/);
    });

    it('0000 não existe no E-Fiscal', () => {
        const r = normalizarCodCliente('0000');
        expect(r.ok).toBe(false);
        expect((r as any).erro).toMatch(/começa em 0001/);
    });

    it('letra não vira código em silêncio', () => {
        const r = normalizarCodCliente('12a4');
        expect(r.ok).toBe(false);
        expect((r as any).erro).toMatch(/só números/);
    });

    it('vazio é ordem de APAGAR, não erro (mesma regra do CCM)', () => {
        expect(normalizarCodCliente('')).toEqual({ ok: true, valor: '' });
        expect(normalizarCodCliente('   ')).toEqual({ ok: true, valor: '' });
        expect(normalizarCodCliente(null)).toEqual({ ok: true, valor: '' });
    });
});

describe('codClienteValido / schemaDoCodCliente — o confronto do PG12', () => {
    it('só 4 dígitos exatos casam schema', () => {
        expect(codClienteValido('0001')).toBe(true);
        expect(schemaDoCodCliente('0001')).toBe('e0001');
        expect(schemaDoCodCliente('1154')).toBe('e1154');
    });

    it('valor fora da régua NÃO casa schema em silêncio', () => {
        expect(codClienteValido('1')).toBe(false);      // sem o pad = legado suspeito
        expect(codClienteValido('0000')).toBe(false);
        expect(codClienteValido(1 as any)).toBe(false); // número perdeu o zero — o bug clássico
        expect(schemaDoCodCliente('12345')).toBeNull();
    });
});

describe('sanitize do modal aplica a régua antes de viajar', () => {
    it('pad na tela: "1" digitado sai "0001"', () => {
        expect(sanitizarDadosFiscais({ codCliente: '1' }).codCliente).toBe('0001');
    });

    it('limpar e salvar apaga ("" viaja; undefined não mexe)', () => {
        expect(sanitizarDadosFiscais({ codCliente: '' }).codCliente).toBe('');
        expect(sanitizarDadosFiscais({}).codCliente).toBeUndefined();
    });

    it('valor inválido segue como digitado — o backend recusa com a mensagem, não silencia', () => {
        expect(sanitizarDadosFiscais({ codCliente: '12a4' }).codCliente).toBe('12a4');
    });
});
