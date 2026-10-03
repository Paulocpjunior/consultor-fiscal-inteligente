// sefaz-backend/abrasf/cert-extractor.js
// Extrai chave privada (PEM) e certificado (PEM) de um buffer PFX/PKCS#12.
//
// xml-crypto exige PEM separados; cert-storage devolve PFX cru.

import { abrirPfx, campoDoNome } from '../pkcs12.js';

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
    let aberto;
    try {
        aberto = abrirPfx(pfxBuffer, password);
    } catch (e) {
        if (e?.codigo === 'SEM_CHAVE') throw new Error('PFX sem chave privada');
        if (e?.codigo === 'SEM_CERTIFICADO') throw new Error('PFX sem certificado');
        throw new Error(`PFX invalido ou senha incorreta: ${e.message}`);
    }
    const { pemKey: privateKeyPem, pemCert: certificatePem, certificado } = aberto;

    // Metadados uteis pra logging/diagnostico
    // CN em e-CNPJ ICP-Brasil eh "Razao Social:CNPJ" - extrai os 14 digitos
    const cn = campoDoNome(certificado.subject, 'CN');
    const cnpj = cn ? (cn.match(/\d{14}/)?.[0] || null) : null;
    const notAfter = certificado.notAfter.toISOString();

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
