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
const NS_NFE = 'http://www.prefeitura.sp.gov.br/nfe';

const stripFormat = (xml) => xml.replace(/\r?\n|\r|\t/g, '').replace(/>\s+</g, '><').trim();

function montarPedidoXml({ cnpjRemetente, inscricaoMunicipalTomador, dtInicio, dtFim }) {
    const inicio = `${dtInicio.ano}-${String(dtInicio.mes).padStart(2, '0')}-01`;
    const ultimoDia = new Date(Date.UTC(dtFim.ano, dtFim.mes, 0)).getUTCDate();
    const fim = `${dtFim.ano}-${String(dtFim.mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

    return stripFormat(`
<PedidoConsultaNFeRecebidas xmlns="${NS_NFE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Cabecalho xmlns="" Versao="1">
    <CPFCNPJRemetente><CNPJ>${cnpjRemetente}</CNPJ></CPFCNPJRemetente>
    <InscricaoMunicipalTomador>${inscricaoMunicipalTomador}</InscricaoMunicipalTomador>
    <dtInicio>${inicio}</dtInicio>
    <dtFim>${fim}</dtFim>
  </Cabecalho>
</PedidoConsultaNFeRecebidas>
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

function envelopeSoap(xmlAssinado) {
    const escaped = xmlAssinado
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <ConsultaNFeRecebidas xmlns="${NS_NFE}">
      <VersaoSchema>1</VersaoSchema>
      <MensagemXML>${escaped}</MensagemXML>
    </ConsultaNFeRecebidas>
  </soap12:Body>
</soap12:Envelope>`;
}

function postSoap(body, pfxBuffer, password) {
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
                    'Content-Type': 'application/soap+xml; charset=utf-8',
                    'Content-Length': Buffer.byteLength(body, 'utf8'),
                    SOAPAction: SOAP_ACTION_RECEBIDAS,
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

function extrairRetornoXml(soapResposta) {
    const cdataMatch = soapResposta.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    if (cdataMatch) return cdataMatch[1];

    const resultMatch = soapResposta.match(
        /<ConsultaNFeRecebidasResult>([\s\S]*?)<\/ConsultaNFeRecebidasResult>/
    );
    if (!resultMatch) {
        throw new Error('NFS-e SP: ConsultaNFeRecebidasResult não localizado no SOAP de resposta.');
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

    const sucessoNode = doc.getElementsByTagName('Sucesso')[0];
    const sucesso = sucessoNode?.textContent?.trim().toLowerCase() === 'true';

    const erros = Array.from(doc.getElementsByTagName('Erro')).map((e) => ({
        codigo: e.getElementsByTagName('Codigo')[0]?.textContent?.trim() || '',
        descricao: e.getElementsByTagName('Descricao')[0]?.textContent?.trim() || '',
    }));

    const alertas = Array.from(doc.getElementsByTagName('Alerta')).map((a) => ({
        codigo: a.getElementsByTagName('Codigo')[0]?.textContent?.trim() || '',
        descricao: a.getElementsByTagName('Descricao')[0]?.textContent?.trim() || '',
    }));

    const xmlSerializer = new XMLSerializer();
    const nfes = Array.from(doc.getElementsByTagName('NFe')).map((n) => xmlSerializer.serializeToString(n));

    return { sucesso, erros, alertas, totalNFes: nfes.length, nfes };
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
