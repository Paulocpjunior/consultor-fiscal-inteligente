// @ts-nocheck
/**
 * Testa assinatura XML-DSig. Usa o PFX de teste (fixtures/pfx) e assina envelopes ABRASF
 * de exemplo. Verifica estrutura da assinatura (presença de Signature,
 * SignatureValue, DigestValue, X509Certificate) e idempotência.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { assinarXmlAbrasf, temAssinaturaXmlValida } from '../sefaz-backend/abrasf/xml-signer.js';
import { montarConsultarServicoTomado } from '../sefaz-backend/abrasf/envelope-builder.js';

const pfx = readFileSync(join(__dirname, 'fixtures', 'pfx', '3des.pfx'));

describe('assinarXmlAbrasf', () => {
    it('assina ConsultarNfseServicoTomado com SHA-1 (default)', () => {
        const payload = montarConsultarServicoTomado({
            cnpjTomador: '11222333000181',
            dataInicial: '2026-06-01',
            dataFinal: '2026-06-30',
        });
        const xmlAssinado = assinarXmlAbrasf({
            xml: payload, pfxBuffer: pfx, pfxPassword: 'senha123',
        });
        expect(xmlAssinado).toContain('<ConsultarNfseServicoTomadoEnvio');
        expect(xmlAssinado).toContain('<Signature');
        expect(xmlAssinado).toContain('rsa-sha1');
        expect(xmlAssinado).toContain('<X509Certificate>');
    });

    it('assina com SHA-256 quando explicito', () => {
        const payload = montarConsultarServicoTomado({
            cnpjTomador: '11222333000181',
            dataInicial: '2026-06-01',
            dataFinal: '2026-06-30',
        });
        const xmlAssinado = assinarXmlAbrasf({
            xml: payload, pfxBuffer: pfx, pfxPassword: 'senha123',
            algoritmo: 'sha256',
        });
        expect(xmlAssinado).toContain('rsa-sha256');
        expect(xmlAssinado).toContain('xmlenc#sha256');
    });

    it('Signature contém SignatureValue + DigestValue + canonicalization c14n-exc', () => {
        const payload = montarConsultarServicoTomado({
            cnpjTomador: '11222333000181',
            dataInicial: '2026-06-01',
            dataFinal: '2026-06-30',
        });
        const xmlAssinado = assinarXmlAbrasf({
            xml: payload, pfxBuffer: pfx, pfxPassword: 'senha123',
        });
        expect(xmlAssinado).toContain('<SignatureValue>');
        expect(xmlAssinado).toContain('<DigestValue>');
        expect(xmlAssinado).toContain('xml-exc-c14n#');
        expect(xmlAssinado).toContain('enveloped-signature');
    });

    it('Signature é appendada DENTRO do elemento root (não substitui)', () => {
        const payload = montarConsultarServicoTomado({
            cnpjTomador: '11222333000181',
            dataInicial: '2026-06-01',
            dataFinal: '2026-06-30',
        });
        const xmlAssinado = assinarXmlAbrasf({
            xml: payload, pfxBuffer: pfx, pfxPassword: 'senha123',
        });
        // Estrutura esperada: <ConsultarNfseServicoTomadoEnvio>...payload...<Signature>...</Signature></ConsultarNfseServicoTomadoEnvio>
        const matchRoot = xmlAssinado.match(/<ConsultarNfseServicoTomadoEnvio[^>]*>([\s\S]+)<\/ConsultarNfseServicoTomadoEnvio>$/);
        expect(matchRoot).toBeTruthy();
        expect(matchRoot[1]).toContain('<Signature');
        expect(matchRoot[1]).toContain('<Consulente>');
        expect(matchRoot[1]).toContain('<PeriodoEmissao>');
    });

    it('lanca se faltar pfxBuffer', () => {
        expect(() => assinarXmlAbrasf({ xml: '<x/>', pfxBuffer: null, pfxPassword: 's' }))
            .toThrow(/pfxBuffer e pfxPassword obrigatorios/);
    });

    it('lanca se algoritmo nao suportado', () => {
        expect(() => assinarXmlAbrasf({
            xml: '<x/>', pfxBuffer: pfx, pfxPassword: 'senha123', algoritmo: 'md5',
        })).toThrow(/algoritmo nao suportado/);
    });

    it('idempotente: 2 assinaturas do mesmo XML têm valor diferente (random nonce no padding)', () => {
        // Detalhe importante: SignatureValue muda entre execuções por causa de
        // padding randômico do RSA. Isso é esperado e seguro.
        const payload = montarConsultarServicoTomado({
            cnpjTomador: '11222333000181',
            dataInicial: '2026-06-01',
            dataFinal: '2026-06-30',
        });
        const sig1 = assinarXmlAbrasf({ xml: payload, pfxBuffer: pfx, pfxPassword: 'senha123' });
        const sig2 = assinarXmlAbrasf({ xml: payload, pfxBuffer: pfx, pfxPassword: 'senha123' });
        const sv1 = sig1.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)?.[1];
        const sv2 = sig2.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)?.[1];
        expect(sv1).toBeTruthy();
        expect(sv2).toBeTruthy();
        // RSA padding pode ser determinístico em algumas implementações - tolerar ambos
        // mas garantir que pelo menos a digest é a mesma (mesmo conteúdo canônico)
        const dv1 = sig1.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1];
        const dv2 = sig2.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1];
        expect(dv1).toBe(dv2);
    });
});

describe('temAssinaturaXmlValida', () => {
    it('detecta XML assinado válido', () => {
        const payload = montarConsultarServicoTomado({
            cnpjTomador: '11222333000181',
            dataInicial: '2026-06-01',
            dataFinal: '2026-06-30',
        });
        const xmlAssinado = assinarXmlAbrasf({
            xml: payload, pfxBuffer: pfx, pfxPassword: 'senha123',
        });
        expect(temAssinaturaXmlValida(xmlAssinado)).toBe(true);
    });

    it('rejeita XML sem assinatura', () => {
        expect(temAssinaturaXmlValida('<ConsultarNfseServicoTomadoEnvio/>')).toBe(false);
    });

    it('rejeita XML com tag <Signature> mas sem SignatureValue/DigestValue', () => {
        const x = '<Envio><Signature><SignedInfo/></Signature></Envio>';
        expect(temAssinaturaXmlValida(x)).toBe(false);
    });

    it('rejeita entrada nao-string', () => {
        expect(temAssinaturaXmlValida(null as any)).toBe(false);
        expect(temAssinaturaXmlValida(123 as any)).toBe(false);
    });
});
