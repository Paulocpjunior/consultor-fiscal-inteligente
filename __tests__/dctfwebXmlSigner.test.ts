// @ts-nocheck
/**
 * Trava o perfil de assinatura da transmissão DCTFWeb (TRANSDECLARACAO310):
 * XMLDSig com 1 Reference URI="#<id do ConteudoDeclaracao>", RSA-SHA256,
 * C14N inclusiva, transforms enveloped+C14N, X509Certificate no KeyInfo,
 * Signature como último filho do elemento raiz.
 * Casos reais: 07/07/2026 DCTFWEB-MG07 TRANS21_Xml_Assinado_Base64_Ausente;
 * 08/07/2026 EntradaIncorreta-DCTFWEB-TRANS02 ("o conteúdo assinado deve ser
 * o elemento 'ConteudoDeclaracao'", Reference URI="" rejeitado).
 */
import * as forge from 'node-forge';
// @ts-expect-error — modulo .js puro
import { assinarXmlDctfweb, assinarXmlDctfwebBase64 } from '../sefaz-backend/dctfweb-xml-signer.js';

function gerarCertAutoAssinado() {
    const keys = forge.pki.rsa.generateKeyPair(1024); // 1024 só p/ velocidade de teste
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 86400000);
    const attrs = [{ name: 'commonName', value: 'TESTE LTDA:00000000000191' }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    return {
        privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
        certificatePem: forge.pki.certificateToPem(cert),
    };
}

const XML = '<DeclaracaoDctfWeb><ConteudoDeclaracao><cnpj>09010732000137</cnpj><pa>2026-06</pa></ConteudoDeclaracao></DeclaracaoDctfWeb>';
const XML_COM_ID = '<ProcDctf xmlns="http://www.serpro.gov.br/dctf/v1"><ConteudoDeclaracao id="ID20260600001"><cnpj>09010732000137</cnpj></ConteudoDeclaracao></ProcDctf>';

describe('assinarXmlDctfweb', () => {
    const { privateKeyPem, certificatePem } = gerarCertAutoAssinado();

    it('produz Signature com Reference no ConteudoDeclaracao, RSA-SHA256, C14N inclusiva e X509', () => {
        const assinado = assinarXmlDctfweb({ xml: XML, privateKeyPem, certificatePem });

        expect(assinado).toContain('<Signature');
        expect(assinado).toContain('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256');
        expect(assinado).toContain('http://www.w3.org/2001/04/xmlenc#sha256');
        expect(assinado).toContain('http://www.w3.org/TR/2001/REC-xml-c14n-20010315');
        expect(assinado).toContain('http://www.w3.org/2000/09/xmldsig#enveloped-signature');
        // TRANS02: exatamente 1 Reference, URI="#" + id do ConteudoDeclaracao
        expect(assinado.match(/<Reference /g)).toHaveLength(1);
        expect(assinado).toContain('<Reference URI="#ID_CONTEUDO_DECLARACAO">');
        expect(assinado).toContain('<ConteudoDeclaracao id="ID_CONTEUDO_DECLARACAO">');
        expect(assinado).toMatch(/<SignatureValue>[A-Za-z0-9+/=\s]+<\/SignatureValue>/);
        expect(assinado).toMatch(/<X509Certificate>[A-Za-z0-9+/=\s]+<\/X509Certificate>/);
        // Signature dentro do raiz (irmã do ConteudoDeclaracao), conteúdo preservado
        expect(assinado).toMatch(/<\/ConteudoDeclaracao>[\s\S]*<Signature[\s\S]*<\/DeclaracaoDctfWeb>$/);
    });

    it('usa o id existente do ConteudoDeclaracao quando o XML já traz um', () => {
        const assinado = assinarXmlDctfweb({ xml: XML_COM_ID, privateKeyPem, certificatePem });
        expect(assinado).toContain('<Reference URI="#ID20260600001">');
        expect(assinado).toContain('id="ID20260600001"');
        expect(assinado).not.toContain('ID_CONTEUDO_DECLARACAO');
    });

    it('falha claro quando o XML não tem ConteudoDeclaracao', () => {
        expect(() => assinarXmlDctfweb({
            xml: '<Outro><Coisa/></Outro>', privateKeyPem, certificatePem,
        })).toThrow(/ConteudoDeclaracao/);
    });

    it('base64 decodifica de volta pro XML assinado', () => {
        const b64 = assinarXmlDctfwebBase64({ xml: XML, privateKeyPem, certificatePem });
        const decodificado = Buffer.from(b64, 'base64').toString('utf8');
        expect(decodificado).toContain('<Signature');
        expect(decodificado).toContain('<ConteudoDeclaracao');
    });

    it('falha claro sem xml ou sem chave', () => {
        expect(() => assinarXmlDctfweb({ xml: '', privateKeyPem, certificatePem })).toThrow(/xml/i);
        expect(() => assinarXmlDctfweb({ xml: XML, privateKeyPem: '', certificatePem })).toThrow(/chave|certificado/i);
    });
});
