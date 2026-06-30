import {
    certA1MetadataValido,
    cnpjBase,
    selecionarCertA1PorBase,
} from '../sefaz-backend/cert-base-helper.js';

const future = '2027-01-01T00:00:00.000Z';
const past = '2025-01-01T00:00:00.000Z';
const now = Date.parse('2026-06-30T12:00:00.000Z');

describe('cert-base-helper', () => {
    it('extrai raiz CNPJ', () => {
        expect(cnpjBase('32.602.701/0001-97')).toBe('32602701');
        expect(cnpjBase('123')).toBe('');
    });

    it('valida apenas A1 com storage, senha, CNPJ e validade futura', () => {
        expect(certA1MetadataValido({
            tipoCert: 'A1',
            cnpj: '32602701000197',
            storagePath: 'certs/e1.pfx.enc',
            passwordEnc: 'secret',
            notAfter: future,
        }, now)).toBe(true);

        expect(certA1MetadataValido({
            tipoCert: 'A3',
            cnpj: '32602701000197',
            notAfter: future,
        }, now)).toBe(false);

        expect(certA1MetadataValido({
            tipoCert: 'A1',
            cnpj: '32602701000197',
            storagePath: 'certs/e1.pfx.enc',
            passwordEnc: 'secret',
            notAfter: past,
        }, now)).toBe(false);
    });

    it('seleciona A1 valido de outra empresa da mesma raiz CNPJ', () => {
        const cert = selecionarCertA1PorBase([
            {
                empresaId: 'matriz',
                tipoCert: 'A1',
                cnpj: '32602701000197',
                storagePath: 'certs/matriz.pfx.enc',
                passwordEnc: 'secret',
                notAfter: future,
            },
            {
                empresaId: 'outra-raiz',
                tipoCert: 'A1',
                cnpj: '99999999000199',
                storagePath: 'certs/outra.pfx.enc',
                passwordEnc: 'secret',
                notAfter: future,
            },
        ], '32.602.701/0003-59', now, 'filial');

        expect(cert?.empresaId).toBe('matriz');
    });

    it('nao retorna o proprio registro quando excludeEmpresaId bate', () => {
        const cert = selecionarCertA1PorBase([
            {
                empresaId: 'filial',
                tipoCert: 'A1',
                cnpj: '32602701000359',
                storagePath: 'certs/filial.pfx.enc',
                passwordEnc: 'secret',
                notAfter: future,
            },
        ], '32602701000359', now, 'filial');

        expect(cert).toBeNull();
    });
});
