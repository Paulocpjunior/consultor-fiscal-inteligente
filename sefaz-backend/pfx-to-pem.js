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

// 03/10: a leitura do PKCS#12 mora em `pkcs12.js` (crypto nativo; o
// node-forge saiu do projeto). Este módulo mantém a assinatura de sempre.
import { abrirPfx } from './pkcs12.js';

/**
 * @param {Buffer} pfxBuffer
 * @param {string} password
 * @returns {{ pemKey: string, pemCert: string }}
 */
export function pfxToPem(pfxBuffer, password) {
    // Cert folha = o que casa com a chave (a cadeia ICP-Brasil fica de fora).
    const { pemKey, pemCert } = abrirPfx(pfxBuffer, password);
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
