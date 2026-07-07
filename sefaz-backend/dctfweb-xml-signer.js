// ============================================================================
// sefaz-backend/dctfweb-xml-signer.js
//
// Assina o XML da declaração DCTFWeb para transmissão via Integra Contador
// (TRANSDECLARACAO310 exige `xmlAssinadoBase64` — erro TRANS21_Xml_Assinado_
// Base64_Ausente sem ele, caso real 07/07/2026).
//
// Perfil de assinatura (padrão Receita Federal — mesmo dos XMLs eSocial/
// família DCTFWeb):
//   - XMLDSig ENVELOPED sobre o documento (Reference URI="")
//   - CanonicalizationMethod: C14N inclusiva (REC-xml-c14n-20010315)
//   - SignatureMethod: RSA-SHA256
//   - DigestMethod: SHA-256
//   - KeyInfo: X509Data/X509Certificate (e-CNPJ do escritório — procuração
//     e-CAC cobre a transmissão em nome do cliente)
//   - <Signature> appendada como último filho do elemento raiz
// ============================================================================

import { SignedXml } from 'xml-crypto';

const ALG = {
    signature: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    digest: 'http://www.w3.org/2001/04/xmlenc#sha256',
    c14n: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    enveloped: 'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
};

/**
 * Assina o XML da declaração DCTFWeb.
 *
 * @param {object} opts
 * @param {string} opts.xml             XML da declaração (CONSXMLDECLARACAO38)
 * @param {string} opts.privateKeyPem   chave privada PEM (e-CNPJ A1)
 * @param {string} opts.certificatePem  certificado PEM (vai no KeyInfo)
 * @returns {string} XML com <Signature> no elemento raiz
 */
export function assinarXmlDctfweb({ xml, privateKeyPem, certificatePem }) {
    if (!xml || typeof xml !== 'string' || !xml.trim()) {
        throw new Error('assinarXmlDctfweb: xml da declaração é obrigatório');
    }
    if (!privateKeyPem || !certificatePem) {
        throw new Error('assinarXmlDctfweb: chave privada e certificado PEM são obrigatórios');
    }

    // Remove declaração <?xml?> duplicável e BOM — o SERPRO valida o digest
    // sobre o documento canônico.
    const limpo = xml.replace(/^﻿/, '').trim();

    const sig = new SignedXml({
        privateKey: privateKeyPem,
        publicCert: certificatePem,
        signatureAlgorithm: ALG.signature,
        canonicalizationAlgorithm: ALG.c14n,
    });

    sig.addReference({
        xpath: '/*',
        transforms: [ALG.enveloped, ALG.c14n],
        digestAlgorithm: ALG.digest,
        // URI="" = documento inteiro (menos a própria Signature, via transform
        // enveloped) — perfil clássico Receita quando o elemento não tem Id.
        isEmptyUri: true,
    });

    sig.computeSignature(limpo, {
        prefix: '',
        location: { reference: '/*', action: 'append' },
    });

    return sig.getSignedXml();
}

/** Base64 do XML assinado — formato que o TRANSDECLARACAO310 espera. */
export function assinarXmlDctfwebBase64(opts) {
    return Buffer.from(assinarXmlDctfweb(opts), 'utf8').toString('base64');
}
