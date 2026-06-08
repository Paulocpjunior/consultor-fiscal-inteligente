// sefaz-backend/abrasf/xml-signer.js
// Assina payload XML ABRASF conforme XML-DSig W3C (canonicalization C14N
// exclusiva). Cobre o caso de uso ABRASF v2.x onde o elemento raiz do
// envio carrega Id e o <Signature> eh appendado como ultimo filho.
//
// Padroes:
//   - signatureMethod: rsa-sha1 (padrao Megasoft) ou rsa-sha256 (curitiba, novos)
//   - digestMethod: sha1 ou sha256 (em par com signatureMethod)
//   - canonicalization: exc-c14n (sem comentarios)
//   - transforms da reference: enveloped-signature + exc-c14n
//   - keyInfo: <X509Data><X509Certificate>{base64}</X509Certificate></X509Data>

import { SignedXml } from 'xml-crypto';
import { extrairCertPEM } from './cert-extractor.js';

const ALGOS = {
    'sha1': {
        digest: 'http://www.w3.org/2000/09/xmldsig#sha1',
        signature: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    },
    'sha256': {
        digest: 'http://www.w3.org/2001/04/xmlenc#sha256',
        signature: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    },
};

const C14N_EXC = 'http://www.w3.org/2001/10/xml-exc-c14n#';

/**
 * Assina um XML conforme XML-DSig.
 *
 * @param opts.xml string XML a ser assinado
 * @param opts.pfxBuffer Buffer PFX da empresa
 * @param opts.pfxPassword senha do PFX
 * @param opts.referenciaXPath xpath para o nó a ser assinado (ABRASF v2: root do envio)
 * @param opts.algoritmo 'sha1' | 'sha256' (default sha1 — compatibilidade)
 *
 * @returns string XML com <Signature> appendado dentro do nó-alvo
 */
export function assinarXmlAbrasf(opts) {
    const { xml, pfxBuffer, pfxPassword } = opts;
    const algoritmo = opts.algoritmo || 'sha1';
    const xpath = opts.referenciaXPath || "/*";

    if (!xml || typeof xml !== 'string') throw new Error('xml string obrigatorio');
    if (!pfxBuffer || !pfxPassword) throw new Error('pfxBuffer e pfxPassword obrigatorios');
    if (!ALGOS[algoritmo]) throw new Error(`algoritmo nao suportado: ${algoritmo}`);

    // Extrai key + cert do PFX
    const { privateKeyPem, certificatePem } = extrairCertPEM(pfxBuffer, pfxPassword);

    const sig = new SignedXml({
        privateKey: privateKeyPem,
        publicCert: certificatePem,
        signatureAlgorithm: ALGOS[algoritmo].signature,
        canonicalizationAlgorithm: C14N_EXC,
    });

    sig.addReference({
        xpath,
        transforms: [
            'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
            C14N_EXC,
        ],
        digestAlgorithm: ALGOS[algoritmo].digest,
    });

    sig.computeSignature(xml, {
        prefix: '',                  // ABRASF nao usa prefix nos elementos da Signature
        location: { reference: xpath, action: 'append' },
    });

    return sig.getSignedXml();
}

/**
 * Helper de teste: verifica se o XML contem uma assinatura valida (estrutural).
 * NAO valida cadeia de certificacao - so checa que existe <SignatureValue> e
 * <DigestValue> bem formatados.
 */
export function temAssinaturaXmlValida(xmlString) {
    if (typeof xmlString !== 'string') return false;
    // Checagem estrutural minima
    const temSignature = /<Signature\b[^>]*>/i.test(xmlString);
    const temSigValue = /<SignatureValue\b[^>]*>[A-Za-z0-9+/=\s]+<\/SignatureValue>/i.test(xmlString);
    const temDigestValue = /<DigestValue\b[^>]*>[A-Za-z0-9+/=\s]+<\/DigestValue>/i.test(xmlString);
    const temX509 = /<X509Certificate\b[^>]*>[A-Za-z0-9+/=\s]+<\/X509Certificate>/i.test(xmlString);
    return temSignature && temSigValue && temDigestValue && temX509;
}
