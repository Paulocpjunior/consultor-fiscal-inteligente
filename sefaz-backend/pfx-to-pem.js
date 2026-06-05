// ============================================================================
// pfx-to-pem.js
//
// Extrai chave privada + certificado em PEM a partir de um .pfx (PKCS#12).
// xml-crypto nao aceita .pfx direto — precisa de PEM.
//
// Movido pra modulo isolado (era inline em secret-loader.js) pra ser reusado
// por outros consumidores: cert-storage.js (cert da empresa) precisa do PEM
// pra emissao de NFSe Nacional (precisa assinar DPS com cert do prestador,
// nao do escritorio).
// ============================================================================

import forge from 'node-forge';

/**
 * @param {Buffer} pfxBuffer
 * @param {string} password
 * @returns {{ pemKey: string, pemCert: string }}
 */
export function pfxToPem(pfxBuffer, password) {
    const pkcs12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
    const pkcs12 = forge.pkcs12.pkcs12FromAsn1(pkcs12Asn1, password);

    let pemKey = null;
    let pemCert = null;

    for (const safeContents of pkcs12.safeContents) {
        for (const safeBag of safeContents.safeBags) {
            if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === forge.pki.oids.keyBag) {
                pemKey = forge.pki.privateKeyToPem(safeBag.key);
            } else if (safeBag.type === forge.pki.oids.certBag) {
                // Cert folha (do CNPJ) — ignora cadeia ICP-Brasil intermediaria
                if (!pemCert) pemCert = forge.pki.certificateToPem(safeBag.cert);
            }
        }
    }

    if (!pemKey) throw new Error('Chave privada nao encontrada no .pfx');
    if (!pemCert) throw new Error('Certificado nao encontrado no .pfx');
    return { pemKey, pemCert };
}

/**
 * Retorna apenas o conteudo Base64 do certificado (sem headers PEM nem
 * quebras de linha). Usado em <X509Certificate> dentro de KeyInfo XMLDSig.
 */
export function pemCertToBase64(pemCert) {
    return String(pemCert || '')
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\s+/g, '');
}
