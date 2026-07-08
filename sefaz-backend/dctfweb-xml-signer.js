// ============================================================================
// sefaz-backend/dctfweb-xml-signer.js
//
// Assina o XML da declaração DCTFWeb para transmissão via Integra Contador
// (TRANSDECLARACAO310 exige `xmlAssinadoBase64` — erro TRANS21_Xml_Assinado_
// Base64_Ausente sem ele, caso real 07/07/2026).
//
// Perfil de assinatura exigido pelo SERPRO (erro EntradaIncorreta-DCTFWEB-
// TRANS02, caso real 08/07/2026: "O conteúdo assinado deve ser o elemento
// 'ConteudoDeclaracao' (atributo URI do elemento 'Reference' com valor #
// seguido do valor atributo id do elemento 'ConteudoDeclaracao')"):
//   - XMLDSig com EXATAMENTE 1 Reference apontando para o elemento
//     <ConteudoDeclaracao> via URI="#<id>" — assinar o documento inteiro
//     (Reference URI="") é rejeitado com TRANS02
//   - Transforms: enveloped-signature + C14N inclusiva
//   - CanonicalizationMethod: C14N inclusiva (REC-xml-c14n-20010315)
//   - SignatureMethod: RSA-SHA256 / DigestMethod: SHA-256
//   - KeyInfo: X509Data/X509Certificate (e-CNPJ do escritório — procuração
//     e-CAC cobre a transmissão em nome do cliente)
//   - <Signature> appendada como último filho do elemento raiz (irmã de
//     ConteudoDeclaracao), como no assinador modelo do SERPRO
// ============================================================================

import { SignedXml } from 'xml-crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const ALG = {
    signature: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    digest: 'http://www.w3.org/2001/04/xmlenc#sha256',
    c14n: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    enveloped: 'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
};

// Só o primeiro ConteudoDeclaracao: o SERPRO rejeita quando a quantidade de
// tags Reference é diferente de 1 (TRANS02).
const XPATH_CONTEUDO = "(//*[local-name(.)='ConteudoDeclaracao'])[1]";

// id determinístico usado quando o XML da consulta vem sem atributo id no
// ConteudoDeclaracao. Minúsculo ("id") — é o nome que o validador do SERPRO
// procura; o xml-crypto criaria "Id".
const ID_PADRAO = 'ID_CONTEUDO_DECLARACAO';

/**
 * Garante que o <ConteudoDeclaracao> tenha atributo id (o Reference vai
 * apontar pra ele). Usa o id existente quando houver; injeta um quando não.
 *
 * @returns {string} XML (possivelmente reescrito com o id injetado)
 */
function garantirIdConteudoDeclaracao(xml) {
    let doc;
    try {
        doc = new DOMParser({ errorHandler: () => {} }).parseFromString(xml, 'text/xml');
    } catch {
        doc = null;
    }
    const el = doc?.getElementsByTagName?.('ConteudoDeclaracao')?.[0]
        || doc?.getElementsByTagNameNS?.('*', 'ConteudoDeclaracao')?.[0];
    if (!el) {
        throw new Error(
            'assinarXmlDctfweb: o XML da declaração não contém o elemento <ConteudoDeclaracao> '
            + '— o SERPRO exige que a assinatura referencie esse elemento (TRANS02). '
            + `Raiz recebida: <${doc?.documentElement?.nodeName || '?'}>.`
        );
    }
    const temId = ['id', 'Id', 'ID'].some((a) => el.hasAttribute(a));
    if (temId) return xml;
    el.setAttribute('id', ID_PADRAO);
    return new XMLSerializer().serializeToString(doc);
}

/**
 * Assina o XML da declaração DCTFWeb.
 *
 * @param {object} opts
 * @param {string} opts.xml             XML da declaração (CONSXMLDECLARACAO38)
 * @param {string} opts.privateKeyPem   chave privada PEM (e-CNPJ A1)
 * @param {string} opts.certificatePem  certificado PEM (vai no KeyInfo)
 * @returns {string} XML com <Signature> no elemento raiz referenciando
 *                   ConteudoDeclaracao por id
 */
export function assinarXmlDctfweb({ xml, privateKeyPem, certificatePem }) {
    if (!xml || typeof xml !== 'string' || !xml.trim()) {
        throw new Error('assinarXmlDctfweb: xml da declaração é obrigatório');
    }
    if (!privateKeyPem || !certificatePem) {
        throw new Error('assinarXmlDctfweb: chave privada e certificado PEM são obrigatórios');
    }

    // Remove BOM — o SERPRO valida o digest sobre o documento canônico.
    const limpo = garantirIdConteudoDeclaracao(xml.replace(/^﻿/, '').trim());

    const sig = new SignedXml({
        privateKey: privateKeyPem,
        publicCert: certificatePem,
        signatureAlgorithm: ALG.signature,
        canonicalizationAlgorithm: ALG.c14n,
    });

    // Reference URI="#<id do ConteudoDeclaracao>" — o xml-crypto lê o id
    // existente do elemento (idAttributes cobre id/Id/ID).
    sig.addReference({
        xpath: XPATH_CONTEUDO,
        transforms: [ALG.enveloped, ALG.c14n],
        digestAlgorithm: ALG.digest,
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
