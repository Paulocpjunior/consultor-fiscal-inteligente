/**
 * Cliente SOAP NFS-e prefeitura de São Paulo capital ("Nota do Milhão").
 *
 * - Endpoint produtivo recomendado: https://nfews.prefeitura.sp.gov.br/lotenfe.asmx
 *   (suporta layout v1 e futuro v2 RT2026; substitui o legado nfe.prefeitura.sp.gov.br)
 * - SOAP 1.2 Document/Literal wrapped
 * - Assinatura XMLDSIG Enveloped, RSA-SHA1, C14N (Exclusive)
 * - Cert A1 ICP-Brasil (mesmo da SEFAZ/manifesto), CNPJ do contador autorizado
 *   ou do próprio contribuinte
 * - Layout v1 ainda obrigatório (manual 3.3.4: WS produtivo de v2 ainda não habilitado)
 *
 * Implementa apenas o método de captura: ConsultaNFeRecebidas.
 * Outros métodos (ConsultaNFeEmitidas, CancelamentoNFe, EnvioRPS) podem
 * reusar a infraestrutura de assinatura/transporte conforme demanda.
 */

import https from 'node:https';
import { SignedXml } from 'xml-crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { loadCertificate } from './secret-loader.js';

const ENDPOINT_HOST = 'nfews.prefeitura.sp.gov.br';
const ENDPOINT_PATH = '/lotenfe.asmx';
const SOAP_ACTION_RECEBIDAS = 'http://www.prefeitura.sp.gov.br/nfe/ws/consultaNFeRecebidas';
const SOAP_ACTION_EMITIDAS = 'http://www.prefeitura.sp.gov.br/nfe/ws/consultaNFeEmitidas';
const NS_NFE = 'http://www.prefeitura.sp.gov.br/nfe';

const stripFormat = (xml) => xml.replace(/\r?\n|\r|\t/g, '').replace(/>\s+</g, '><').trim();

function montarPedidoXml({ cnpjRemetente, inscricaoMunicipalTomador, dtInicio, dtFim }) {
    const inicio = `${dtInicio.ano}-${String(dtInicio.mes).padStart(2, '0')}-01`;
    const ultimoDia = new Date(Date.UTC(dtFim.ano, dtFim.mes, 0)).getUTCDate();
    const fim = `${dtFim.ano}-${String(dtFim.mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

    // Layout confirmado contra PyTrustNFe (biblioteca testada): o elemento raiz
    // do metodo ConsultaNFeRecebidas e <PedidoConsultaNFePeriodo>; a inscricao
    // municipal e <Inscricao>; NumeroPagina vai DENTRO do Cabecalho, apos dtFim.
    return stripFormat(`
<PedidoConsultaNFePeriodo xmlns="${NS_NFE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Cabecalho Versao="1" xmlns="">
    <CPFCNPJRemetente><CNPJ>${cnpjRemetente}</CNPJ></CPFCNPJRemetente>
    <Inscricao>${inscricaoMunicipalTomador}</Inscricao>
    <dtInicio>${inicio}</dtInicio>
    <dtFim>${fim}</dtFim>
    <NumeroPagina>1</NumeroPagina>
  </Cabecalho>
</PedidoConsultaNFePeriodo>
    `);
}

function assinarXmlSp(xmlString, certPem, keyPem) {
    const sig = new SignedXml({
        privateKey: keyPem,
        signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
        canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    });

    sig.addReference({
        xpath: '/*',
        transforms: [
            'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
            'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
        ],
        digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    });

    const certBody = certPem
        .replace(/-----BEGIN CERTIFICATE-----/, '')
        .replace(/-----END CERTIFICATE-----/, '')
        .replace(/\s+/g, '');
    sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${certBody}</X509Certificate></X509Data>`;

    sig.computeSignature(xmlString);
    return sig.getSignedXml();
}

function envelopeSoap(xmlAssinado, metodo = 'ConsultaNFeRecebidas') {
    // O webservice de SP espera o XML do pedido dentro de CDATA — nao escapado
    // com entidades. Conteudo escapado dispara erro 1102 ("MensagemXML sem
    // conteudo"). extrairRetornoXml tambem le a resposta a partir de CDATA.
    return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <${metodo} xmlns="${NS_NFE}">
      <VersaoSchema>1</VersaoSchema>
      <MensagemXML><![CDATA[${xmlAssinado}]]></MensagemXML>
    </${metodo}>
  </soap12:Body>
</soap12:Envelope>`;
}

function postSoap(body, pfxBuffer, password, soapAction = SOAP_ACTION_RECEBIDAS) {
    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                host: ENDPOINT_HOST,
                path: ENDPOINT_PATH,
                method: 'POST',
                pfx: pfxBuffer,
                passphrase: password,
                minVersion: 'TLSv1.2',
                rejectUnauthorized: true,
                headers: {
                    // SOAP 1.2: o action vai DENTRO do Content-Type, nao como header separado
                    'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"`,
                    'Content-Length': Buffer.byteLength(body, 'utf8'),
                },
                timeout: 60000,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () =>
                    resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') })
                );
            }
        );
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('NFS-e SP: timeout')));
        req.write(body, 'utf8');
        req.end();
    });
}

function extrairRetornoXml(soapResposta, metodo = 'ConsultaNFeRecebidas') {
    const cdataMatch = soapResposta.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    if (cdataMatch) return cdataMatch[1];

    // Detecta SOAP Fault explícito (erro retornado pelo serviço SP)
    const faultMatch = soapResposta.match(/<(?:\w+:)?Fault[^>]*>([\s\S]*?)<\/(?:\w+:)?Fault>/i);
    if (faultMatch) {
        const faultStr = (() => {
            const fs = faultMatch[1].match(/<(?:\w+:)?faultstring[^>]*>([\s\S]*?)<\/(?:\w+:)?faultstring>/i);
            return fs ? fs[1].trim() : faultMatch[1].slice(0, 500);
        })();
        throw new Error(`NFS-e SP retornou SOAP Fault: ${faultStr}`);
    }

    const resultTag = `${metodo}Result`;
    // Tolerante a prefixos de namespace (ex: <ns2:ConsultaNFeRecebidasResult>)
    const resultMatch = soapResposta.match(
        new RegExp(`<(?:\\w+:)?${resultTag}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${resultTag}>`)
    );
    if (!resultMatch) {
        // Fallback: às vezes o portal SP devolve <RetornoXML> direto
        const retornoMatch = soapResposta.match(/<(?:\w+:)?RetornoXML[^>]*>([\s\S]*?)<\/(?:\w+:)?RetornoXML>/);
        if (retornoMatch) return retornoMatch[1];

        console.error(`[nfse-sp-client] resposta sem ${resultTag} — corpo (primeiros 3000 chars):`, (soapResposta || '').slice(0, 3000));
        const corpoCurto = (soapResposta || '').slice(0, 200).replace(/\s+/g, ' ').trim();
        throw new Error(`NFS-e SP: ${resultTag} não localizado. Resposta recebida (início): ${corpoCurto}`);
    }
    return resultMatch[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function parseRetorno(retornoXml) {
    const doc = new DOMParser({
        errorHandler: { warning: () => {}, error: () => {}, fatalError: (e) => { throw e; } },
    }).parseFromString(retornoXml, 'text/xml');

    // Tolerante a namespace prefix: pega qualquer elemento cujo localName bata.
    const all = Array.from(doc.getElementsByTagName('*'));
    const byLocal = (name) => all.filter(el => el.localName === name);
    const firstByLocal = (name) => byLocal(name)[0];

    const sucessoNode = firstByLocal('Sucesso');
    const sucesso = sucessoNode?.textContent?.trim().toLowerCase() === 'true';

    const erros = byLocal('Erro').map((e) => ({
        codigo: firstByLocal('Codigo', e)?.textContent?.trim()
            || Array.from(e.getElementsByTagName('*')).find(x => x.localName === 'Codigo')?.textContent?.trim()
            || '',
        descricao: Array.from(e.getElementsByTagName('*')).find(x => x.localName === 'Descricao')?.textContent?.trim() || '',
    }));

    const alertas = byLocal('Alerta').map((a) => ({
        codigo: Array.from(a.getElementsByTagName('*')).find(x => x.localName === 'Codigo')?.textContent?.trim() || '',
        descricao: Array.from(a.getElementsByTagName('*')).find(x => x.localName === 'Descricao')?.textContent?.trim() || '',
    }));

    const xmlSerializer = new XMLSerializer();
    const nfes = byLocal('NFe').map((n) => xmlSerializer.serializeToString(n));

    // Diagnóstico: se sucesso=false sem erros nem alertas, devolve uma amostra
    // do XML interno pra debug. Mostra também todas as tags presentes (úteis
    // pra identificar respostas inesperadas tipo <MensagemRetorno>, <Status>).
    let rawSample = null;
    let tagsEncontradas = null;
    if (!sucesso && erros.length === 0 && alertas.length === 0) {
        rawSample = (retornoXml || '').slice(0, 1500);
        const uniqueTags = Array.from(new Set(all.map(el => el.localName).filter(Boolean)));
        tagsEncontradas = uniqueTags.join(', ');
    }

    return { sucesso, erros, alertas, totalNFes: nfes.length, nfes, rawSample, tagsEncontradas };
}

export async function consultarNfseRecebidas({
    cnpjRemetente,
    inscricaoMunicipalTomador,
    dtInicio,
    dtFim,
}) {
    if (!cnpjRemetente || !/^\d{14}$/.test(cnpjRemetente)) {
        throw new Error('NFS-e SP: cnpjRemetente inválido (precisa 14 dígitos numéricos)');
    }
    if (!inscricaoMunicipalTomador) {
        throw new Error('NFS-e SP: inscricaoMunicipalTomador (CCM) é obrigatória');
    }

    const certs = await loadCertificate();
    if (!certs.pemCert || !certs.pemKey) {
        throw new Error(
            'NFS-e SP: certificado sem PEM extraído. Verifique secret-loader.js (extrairPem falhou no pfx).'
        );
    }

    const xmlInterno = montarPedidoXml({
        cnpjRemetente,
        inscricaoMunicipalTomador,
        dtInicio,
        dtFim,
    });
    const xmlAssinado = assinarXmlSp(xmlInterno, certs.pemCert, certs.pemKey);
    const soap = envelopeSoap(xmlAssinado);

    if (process.env.SEFAZ_DEBUG === '1') {
        const _flat = (x) => (x || '').replace(/[\r\n]+/g, ' ');
        console.error('[nfse-sp-DIAG2] SOAP-COMPLETO len=' + (soap||'').length + ' :: ' + _flat(soap));
    }

    const { statusCode, body } = await postSoap(soap, certs.pfxBuffer, certs.password);

    if (statusCode >= 500) {
        console.error(`[nfse-sp-client] HTTP ${statusCode} — corpo da resposta:`, (body || '').slice(0, 2000));
        throw new Error(`NFS-e SP: HTTP ${statusCode} — ${(body || '').replace(/\s+/g, ' ').slice(0, 300) || 'sem corpo'}`);
    }
    if (statusCode === 401 || statusCode === 403) {
        return {
            sucesso: false,
            erros: [
                {
                    codigo: `HTTP_${statusCode}`,
                    descricao:
                        'Não autorizado. Verifique se o contribuinte autorizou o CNPJ remetente como contador no portal nfe.prefeitura.sp.gov.br > Configurações do Perfil do Contribuinte.',
                },
            ],
            alertas: [],
            totalNFes: 0,
            nfes: [],
            statusCode,
        };
    }

    const retornoXml = extrairRetornoXml(body);
    const parsed = parseRetorno(retornoXml);
    return { ...parsed, statusCode };
}

/**
 * Consulta NFS-e emitidas (Serviços Prestados) no webservice de SP.
 * Layout idêntico ao de recebidas, muda apenas o método SOAP e a inscricao
 * no pedido refere-se ao prestador (não tomador).
 */
export async function consultarNfseEmitidas({
    cnpjRemetente,
    inscricaoMunicipalPrestador,
    dtInicio,
    dtFim,
}) {
    if (!cnpjRemetente || !/^\d{14}$/.test(cnpjRemetente)) {
        throw new Error('NFS-e SP: cnpjRemetente inválido (precisa 14 dígitos numéricos)');
    }
    if (!inscricaoMunicipalPrestador) {
        throw new Error('NFS-e SP: inscricaoMunicipalPrestador (CCM) é obrigatória');
    }

    const certs = await loadCertificate();
    if (!certs.pemCert || !certs.pemKey) {
        throw new Error(
            'NFS-e SP: certificado sem PEM extraído. Verifique secret-loader.js (extrairPem falhou no pfx).'
        );
    }

    const xmlInterno = montarPedidoXml({
        cnpjRemetente,
        inscricaoMunicipalTomador: inscricaoMunicipalPrestador,
        dtInicio,
        dtFim,
    });
    const xmlAssinado = assinarXmlSp(xmlInterno, certs.pemCert, certs.pemKey);
    const metodo = 'ConsultaNFeEmitidas';
    const soap = envelopeSoap(xmlAssinado, metodo);

    if (process.env.SEFAZ_DEBUG === '1') {
        const _flat = (x) => (x || '').replace(/[\r\n]+/g, ' ');
        console.error('[nfse-sp-DIAG2] SOAP-EMITIDAS len=' + (soap||'').length + ' :: ' + _flat(soap));
    }

    const { statusCode, body } = await postSoap(soap, certs.pfxBuffer, certs.password, SOAP_ACTION_EMITIDAS);

    if (statusCode >= 500) {
        console.error(`[nfse-sp-client] HTTP ${statusCode} — corpo da resposta:`, (body || '').slice(0, 2000));
        throw new Error(`NFS-e SP: HTTP ${statusCode} — ${(body || '').replace(/\s+/g, ' ').slice(0, 300) || 'sem corpo'}`);
    }
    if (statusCode === 401 || statusCode === 403) {
        return {
            sucesso: false,
            erros: [
                {
                    codigo: `HTTP_${statusCode}`,
                    descricao:
                        'Não autorizado. Verifique se o contribuinte autorizou o CNPJ remetente como contador no portal nfe.prefeitura.sp.gov.br > Configurações do Perfil do Contribuinte.',
                },
            ],
            alertas: [],
            totalNFes: 0,
            nfes: [],
            statusCode,
        };
    }

    const retornoXml = extrairRetornoXml(body, metodo);
    const parsed = parseRetorno(retornoXml);
    return { ...parsed, statusCode };
}
