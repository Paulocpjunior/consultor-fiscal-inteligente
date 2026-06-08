// sefaz-backend/abrasf/cliente.js
// Cliente HTTP/SOAP para webservices ABRASF municipais.
//
// Resolve:
//   - mTLS com cert A1 da empresa (PFX + senha)
//   - SOAP envelope formatado por municipio (formato + soapAction)
//   - Assinatura XML-DSig do payload quando exigida (TODO: integrar xml-crypto)
//   - Retry com exponential backoff em 5xx
//
// Limites desta 1a iteracao:
//   - XML-DSig signing AINDA NAO IMPLEMENTADO (rota marcada como BETA).
//     A maioria dos municipios exige assinatura. Pra producao, integrar
//     com xml-crypto (ja temos em deps) - issue separada.
//   - Parsing de WSDL nao automatico - usamos URL direta do .svc/.asmx.
//   - Sem cache de session - cada chamada eh stateless.

import https from 'https';
import { configMunicipio } from './config-municipios.js';
import { envelopeSoap, soapActionHeader, montarConsultarServicoTomado, montarConsultarServicoPrestado } from './envelope-builder.js';
import { assinarXmlAbrasf } from './xml-signer.js';

const HTTP_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;

/**
 * @param opts.codIBGE codigo IBGE do municipio (chave da config)
 * @param opts.tipo 'tomado' | 'prestado'
 * @param opts.cnpj CNPJ do consulente (tomador ou prestador)
 * @param opts.inscricaoMunicipal IM do consulente (obrigatoria em alguns)
 * @param opts.dataInicial Date|string
 * @param opts.dataFinal Date|string
 * @param opts.pagina number (default 1)
 * @param opts.pfxBuffer Buffer do .pfx da empresa (obrigatorio se mTLS)
 * @param opts.pfxPassword senha do PFX
 * @param opts.formato 'soap11-padrao' | 'soap12-padrao' | 'soap11-cdata'
 *                    (auto-derivado da config se omitido)
 *
 * @returns { statusCode, body, request: { envelope, url, soapAction } }
 */
export async function consultarNfse(opts) {
    const config = configMunicipio(opts.codIBGE);
    if (!config) throw new Error(`Municipio ${opts.codIBGE} nao suportado pelo adapter ABRASF`);

    const operacao = opts.tipo === 'prestado'
        ? 'ConsultarNfseServicoPrestado'
        : 'ConsultarNfseServicoTomado';

    let payload = opts.tipo === 'prestado'
        ? montarConsultarServicoPrestado({
            cnpjPrestador: opts.cnpj,
            inscricaoMunicipal: opts.inscricaoMunicipal,
            dataInicial: opts.dataInicial,
            dataFinal: opts.dataFinal,
            pagina: opts.pagina,
        })
        : montarConsultarServicoTomado({
            cnpjTomador: opts.cnpj,
            inscricaoMunicipal: opts.inscricaoMunicipal,
            dataInicial: opts.dataInicial,
            dataFinal: opts.dataFinal,
            pagina: opts.pagina,
        });

    // Assinatura XML-DSig quando o municipio exige
    // Algoritmo + xpath vem da config (default: assina root do envio com SHA-1)
    if ((config.exigeAuth || '').includes('wsdsig')) {
        if (!opts.pfxBuffer || !opts.pfxPassword) {
            throw new Error(`${config.nome}/${config.uf} exige assinatura XML-DSig mas pfxBuffer/pfxPassword nao foram fornecidos`);
        }
        payload = assinarXmlAbrasf({
            xml: payload,
            pfxBuffer: opts.pfxBuffer,
            pfxPassword: opts.pfxPassword,
            referenciaXPath: opts.referenciaXPath || "/*",
            algoritmo: config.algoritmoAssinatura || 'sha1',
        });
    }

    // Formato do envelope SOAP - tenta da config, depois heuristica por versao
    const formato = opts.formato
        || config.soapFormato
        || (config.versao === 'abrasf-2.04' ? 'soap12-padrao' : 'soap11-padrao');

    const envelope = envelopeSoap({ formato, payloadAbrasf: payload, operacao });
    const action = soapActionHeader(config, operacao);

    return postSoap({
        url: config.wsdl,
        envelope,
        soapAction: action,
        pfxBuffer: opts.pfxBuffer,
        pfxPassword: opts.pfxPassword,
        formato,
    });
}

/**
 * POST SOAP com mTLS e retry. Implementacao com https nativo pra controle
 * fino do agent (PFX). axios/undici nao expoem isso bem.
 */
async function postSoap({ url, envelope, soapAction, pfxBuffer, pfxPassword, formato }) {
    const contentType = formato === 'soap12-padrao'
        ? 'application/soap+xml; charset=utf-8'
        : 'text/xml; charset=utf-8';

    const headers = {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(envelope, 'utf-8'),
        'SOAPAction': `"${soapAction}"`,
    };

    let ultimaErro;
    for (let tentativa = 0; tentativa < MAX_RETRIES; tentativa++) {
        try {
            const resp = await sendRequest(url, headers, envelope, pfxBuffer, pfxPassword);
            // Retry apenas em 5xx (server-side); 4xx eh erro de negocio
            if (resp.statusCode >= 500 && tentativa < MAX_RETRIES - 1) {
                const espera = Math.pow(2, tentativa) * 1000 + Math.random() * 500;
                await new Promise(r => setTimeout(r, espera));
                continue;
            }
            return { ...resp, request: { envelope, url, soapAction } };
        } catch (e) {
            ultimaErro = e;
            if (tentativa < MAX_RETRIES - 1) {
                const espera = Math.pow(2, tentativa) * 1000;
                await new Promise(r => setTimeout(r, espera));
                continue;
            }
            throw e;
        }
    }
    throw ultimaErro || new Error('Falha apos retries');
}

function sendRequest(urlString, headers, body, pfxBuffer, pfxPassword) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const agent = (pfxBuffer && pfxPassword)
            ? new https.Agent({ pfx: pfxBuffer, passphrase: pfxPassword, rejectUnauthorized: true, keepAlive: false })
            : new https.Agent({ rejectUnauthorized: true, keepAlive: false });

        const req = https.request({
            host: url.hostname,
            port: url.port || 443,
            path: url.pathname + (url.search || ''),
            method: 'POST',
            agent,
            timeout: HTTP_TIMEOUT_MS,
            headers,
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({
                statusCode: res.statusCode,
                body: Buffer.concat(chunks).toString('utf-8'),
            }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error(`Timeout ${HTTP_TIMEOUT_MS}ms`)));
        req.write(body);
        req.end();
    });
}
