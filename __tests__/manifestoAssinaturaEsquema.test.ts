// @ts-nocheck
/**
 * 📨 A ASSINATURA DA CIÊNCIA CABE NO ESQUEMA DA NF-e — trava de 30/09.
 *
 * Paulo: *"ainda estamos com essa pendência na ciência das notas"* — toda
 * ciência voltava `lote 225: Rejeicao: Falha no Esquema XML do lote de NF-e`.
 * O evento era assinado com C14N EXCLUSIVA, e o xmldsig-core-schema_v1.01.xsd
 * da NF-e (PL_009_V4) FIXA a inclusiva, rsa-sha1, sha1 e exatamente dois
 * Transforms (enveloped + C14N inclusiva). Esta trava assina um evento de
 * verdade e confere o XML produzido — não a linha de configuração.
 */
import * as forge from 'node-forge';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

jest.mock('../sefaz-backend/secret-loader.js', () => ({ loadCertificate: jest.fn() }));

import { montarInfEvento, assinarEvento, PERFIL_ASSINATURA_NFE } from '../sefaz-backend/manifesto-client.js';

const DS = 'http://www.w3.org/2000/09/xmldsig#';
const NFE = 'http://www.portalfiscal.inf.br/nfe';
/** Os valores que o esquema da NF-e fixa (conferidos no xsd em 30/09). */
const ESQUEMA_NFE = {
    canonicalizacao: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    assinatura: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digest: 'http://www.w3.org/2000/09/xmldsig#sha1',
};

function certAutoAssinado() {
    const keys = forge.pki.rsa.generateKeyPair(1024); // 1024 só p/ velocidade de teste
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 86400000);
    const attrs = [{ name: 'commonName', value: 'TESTE LTDA:17660729000197' }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    return { pemKey: forge.pki.privateKeyToPem(keys.privateKey), pemCert: forge.pki.certificateToPem(cert) };
}

const CHAVE = '35260836353810001505500100003057136193057600';

describe('evento de ciência assinado', () => {
    const cert = certAutoAssinado();
    let doc: any;
    let xml: string;
    const idAttr = `ID210210${CHAVE}01`;

    beforeAll(async () => {
        const inf = montarInfEvento({ chNFe: CHAVE, cnpjDestinatario: '17660729000197', tipo: 'ciencia' });
        xml = await assinarEvento(inf, idAttr, cert);
        doc = new DOMParser().parseFromString(xml, 'text/xml');
    });

    const algoritmo = (nome: string) => Array.from(doc.getElementsByTagNameNS(DS, nome)).map((n: any) => n.getAttribute('Algorithm'));

    it('usa os algoritmos que o esquema da NF-e fixa', () => {
        expect(algoritmo('CanonicalizationMethod')).toEqual([ESQUEMA_NFE.canonicalizacao]);
        expect(algoritmo('SignatureMethod')).toEqual([ESQUEMA_NFE.assinatura]);
        expect(algoritmo('DigestMethod')).toEqual([ESQUEMA_NFE.digest]);
        expect(algoritmo('Transform')).toEqual(ESQUEMA_NFE.transforms);
        expect(xml).not.toMatch(/xml-exc-c14n/);
    });

    it('o perfil exportado é o do esquema (quem mexer nele cai aqui)', () => {
        expect({ ...PERFIL_ASSINATURA_NFE, transforms: [...PERFIL_ASSINATURA_NFE.transforms] }).toEqual(ESQUEMA_NFE);
    });

    it('a Signature vem depois do infEvento, dentro do evento, com o certificado no KeyInfo', () => {
        const evento = doc.documentElement;
        expect(evento.localName).toBe('evento');
        expect(evento.namespaceURI).toBe(NFE);
        const filhos = Array.from(evento.childNodes).filter((n: any) => n.nodeType === 1).map((n: any) => n.localName);
        expect(filhos).toEqual(['infEvento', 'Signature']);
        expect(doc.getElementsByTagNameNS(DS, 'X509Certificate').length).toBe(1);
        expect(Array.from(doc.getElementsByTagNameNS(DS, 'Reference')).map((r: any) => r.getAttribute('URI'))).toEqual([`#${idAttr}`]);
    });

    it('a assinatura confere com o certificado', () => {
        const sig = doc.getElementsByTagNameNS(DS, 'Signature')[0];
        const verificador = new SignedXml({ publicCert: cert.pemCert });
        verificador.loadSignature(sig);
        expect(verificador.checkSignature(xml)).toBe(true);
    });
});
