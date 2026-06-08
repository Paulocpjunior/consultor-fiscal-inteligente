// sefaz-backend/abrasf/cert-extractor.js
// Extrai chave privada (PEM) e certificado (PEM) de um buffer PFX/PKCS#12.
//
// xml-crypto exige PEM separados; cert-storage devolve PFX cru.

import * as forge from 'node-forge';

/**
 * Le um buffer PFX e devolve { privateKeyPem, certificatePem, cnpj?, notAfter? }.
 *
 * @param pfxBuffer Buffer binario do .pfx (PKCS#12)
 * @param password string senha do PFX
 * @throws Error se a senha estiver errada ou o PFX corrompido
 */
export function extrairCertPEM(pfxBuffer, password) {
    if (!Buffer.isBuffer(pfxBuffer)) {
        throw new Error('pfxBuffer deve ser Buffer');
    }
    const p12Der = pfxBuffer.toString('binary');
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    let p12;
    try {
        p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
    } catch (e) {
        throw new Error(`PFX invalido ou senha incorreta: ${e.message}`);
    }

    // Procura keyBag e certBag
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]
        || p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
    if (!keyBag?.key) throw new Error('PFX sem chave privada');

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBag = certBags[forge.pki.oids.certBag]?.[0];
    if (!certBag?.cert) throw new Error('PFX sem certificado');

    const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);
    const certificatePem = forge.pki.certificateToPem(certBag.cert);

    // Metadados uteis pra logging/diagnostico
    const cert = certBag.cert;
    const cnpjAttr = cert.subject?.attributes?.find(a => a.shortName === 'CN');
    // CN em e-CNPJ ICP-Brasil eh "Razao Social:CNPJ" - extrai os 14 digitos
    const cnpj = cnpjAttr ? (String(cnpjAttr.value).match(/\d{14}/)?.[0] || null) : null;
    const notAfter = cert.validity?.notAfter?.toISOString?.() || null;

    return {
        privateKeyPem,
        certificatePem,
        cnpj,
        notAfter,
    };
}

/**
 * Devolve apenas o conteudo BASE64 do certificado X.509 (sem cabecalhos PEM).
 * Util pra colocar no <X509Certificate> da assinatura XML-DSig.
 */
export function certificadoBase64(certificatePem) {
    return certificatePem
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\s+/g, '');
}
