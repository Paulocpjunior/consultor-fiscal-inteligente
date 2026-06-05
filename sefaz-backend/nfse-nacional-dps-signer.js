// ============================================================================
// nfse-nacional-dps-signer.js
//
// Assinatura XMLDSig do XML DPS gerado por nfse-nacional-dps-builder.js.
//
// Especificacao (Manual NFS-e Nacional v1.2, e padrao geral SPED):
//   - Algoritmo: RSA-SHA256 (NFS-e Nacional eh post-2018, usa SHA256, NAO SHA1
//     como NFSe SP capital)
//   - Canonicalizacao: C14N exclusivo (xml-exc-c14n)
//   - Reference URI: "#DPS<idDps>" (refer ao infDPS pelo Id)
//   - Transforms: enveloped-signature + exc-c14n
//   - KeyInfo: X509Data com X509Certificate (cert folha do prestador, base64)
//
// Reusa pattern de nfse-sp-client.js (mesmo xml-crypto), mas:
//   - SHA256 (nao SHA1)
//   - URI=#DPS<id> (nao URI vazia)
//   - Reference ao elemento infDPS (nao ao root /*)
//
// Pattern compativel com xml-crypto v6.
// ============================================================================

import { SignedXml } from 'xml-crypto';
import { pemCertToBase64 } from './pfx-to-pem.js';

/**
 * Assina o XML DPS in-place. Retorna o XML com a tag <Signature> dentro de
 * <DPS> (enveloped).
 *
 * @param {string} xmlDps    XML gerado por buildDpsXml
 * @param {string} idDps     ID DPS sem prefixo (42 digitos). Sera referenciado como "#DPS<idDps>".
 * @param {string} pemCert   Cert do prestador em PEM (de pfx-to-pem)
 * @param {string} pemKey    Chave privada do prestador em PEM
 * @returns {string} XML assinado
 */
export function assinarDpsXml(xmlDps, idDps, pemCert, pemKey) {
    if (!xmlDps) throw new Error('xmlDps obrigatorio');
    if (!idDps) throw new Error('idDps obrigatorio');
    if (!pemKey) throw new Error('pemKey obrigatorio');
    if (!pemCert) throw new Error('pemCert obrigatorio');

    const sig = new SignedXml({
        privateKey: pemKey,
        signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
        canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });

    sig.addReference({
        // Refer ao elemento <infDPS Id="DPS<idDps>">
        xpath: `//*[@Id='DPS${idDps}']`,
        transforms: [
            'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
            'http://www.w3.org/2001/10/xml-exc-c14n#',
        ],
        digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
        uri: `#DPS${idDps}`,
    });

    const certBase64 = pemCertToBase64(pemCert);
    sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`;

    sig.computeSignature(xmlDps, {
        // Coloca <Signature> DENTRO de <DPS>, depois de <infDPS> (padrao SPED).
        location: { reference: "//*[local-name()='DPS']", action: 'append' },
    });
    return sig.getSignedXml();
}
