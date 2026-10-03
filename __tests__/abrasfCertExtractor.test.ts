// @ts-nocheck
/**
 * Testa extracao de chave + cert de um PFX. Para nao depender de cert real,
 * usa os PFX de teste de __tests__/fixtures/pfx (gerados com o OpenSSL).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { extrairCertPEM, certificadoBase64 } from '../sefaz-backend/abrasf/cert-extractor.js';

/** PFX de teste (senha123). Com CNPJ no CN, ou o de CN sem CNPJ. */
function gerarPfxDemo(_senha: string, cn: string = 'EMPRESA TESTE CFI, LTDA:11222333000181'): Buffer {
    const arquivo = /\d{14}/.test(cn) ? '3des.pfx' : 'sem-cnpj.pfx';
    return readFileSync(join(__dirname, 'fixtures', 'pfx', arquivo));
}

describe('extrairCertPEM', () => {
    it('extrai privateKey e certificate de PFX valido', () => {
        const pfx = gerarPfxDemo('senha123');
        const r = extrairCertPEM(pfx, 'senha123');
        expect(r.privateKeyPem).toMatch(/^-----BEGIN (RSA )?PRIVATE KEY-----/);
        expect(r.privateKeyPem).toMatch(/-----END (RSA )?PRIVATE KEY-----/);
        expect(r.certificatePem).toMatch(/^-----BEGIN CERTIFICATE-----/);
        expect(r.certificatePem).toMatch(/-----END CERTIFICATE-----/);
    });

    it('extrai CNPJ do CN no padrao ICP-Brasil', () => {
        const pfx = gerarPfxDemo('senha123', 'EMPRESA DEMO:11222333000181');
        const r = extrairCertPEM(pfx, 'senha123');
        expect(r.cnpj).toBe('11222333000181');
    });

    it('CN sem CNPJ retorna cnpj=null', () => {
        const pfx = gerarPfxDemo('senha123', 'SO_NOME_SEM_CNPJ');
        const r = extrairCertPEM(pfx, 'senha123');
        expect(r.cnpj).toBeNull();
    });

    it('lanca com senha errada', () => {
        const pfx = gerarPfxDemo('senha123');
        expect(() => extrairCertPEM(pfx, 'senha-errada')).toThrow(/senha incorreta|PFX invalido/);
    });

    it('lanca se nao for Buffer', () => {
        expect(() => extrairCertPEM('not a buffer' as any, 'x')).toThrow('pfxBuffer deve ser Buffer');
    });

    it('inclui notAfter (validade do cert) em formato ISO', () => {
        const pfx = gerarPfxDemo('senha123');
        const r = extrairCertPEM(pfx, 'senha123');
        expect(r.notAfter).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});

describe('certificadoBase64', () => {
    it('retira cabecalhos PEM e whitespace', () => {
        const pem = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKfM
+iaCEbAKBgEFBQADgYEAP4f6
-----END CERTIFICATE-----`;
        const b64 = certificadoBase64(pem);
        expect(b64).toBe('MIIDXTCCAkWgAwIBAgIJAKfM+iaCEbAKBgEFBQADgYEAP4f6');
        expect(b64).not.toContain('-');
        expect(b64).not.toMatch(/\s/);
    });
});
