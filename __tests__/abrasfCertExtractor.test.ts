// @ts-nocheck
/**
 * Testa extracao de chave + cert de um PFX. Para nao depender de cert real,
 * geramos um PFX de teste in-memory via node-forge a cada execucao.
 */
import * as forge from 'node-forge';
import { extrairCertPEM, certificadoBase64 } from '../sefaz-backend/abrasf/cert-extractor.js';

/**
 * Gera um PFX de teste (key RSA 2048 + cert self-signed) protegido por senha.
 * Retorna Buffer pronto pra usar como entrada do extractor.
 */
function gerarPfxDemo(senha: string, cn: string = 'TESTE SP CONTABIL:11222333000181'): Buffer {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
    const attrs = [{ name: 'commonName', value: cn }, { name: 'organizationName', value: 'SP Assessoria' }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: '3des' });
    const der = forge.asn1.toDer(p12Asn1).getBytes();
    return Buffer.from(der, 'binary');
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
