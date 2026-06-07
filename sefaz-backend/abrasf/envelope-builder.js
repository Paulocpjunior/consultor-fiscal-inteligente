// sefaz-backend/abrasf/envelope-builder.js
// Constroi envelopes XML conforme schemas ABRASF v2.02/2.03/2.04.
//
// Foco do adapter: CAPTURA (servico tomado / prestado). Emissao usa rotas
// proprias (GerarNfse), nao implementadas aqui na 1a iteracao.

const NS = 'http://www.abrasf.org.br/nfse.xsd';

function escapeXml(s) {
    return String(s || '').replace(/[<>&'"]/g, c => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
    }[c]));
}

function fmtIsoDate(d) {
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    if (typeof d === 'string') {
        const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    }
    throw new Error(`fmtIsoDate: data invalida: ${d}`);
}

/**
 * Constroi o corpo do <ConsultarNfseServicoTomadoEnvio> conforme ABRASF v2.x.
 *
 * @param opts.cnpjTomador string CNPJ do tomador (apenas digitos)
 * @param opts.inscricaoMunicipal string IM do tomador (obrigatoria em alguns municipios)
 * @param opts.dataInicial Date|string ISO YYYY-MM-DD
 * @param opts.dataFinal Date|string ISO YYYY-MM-DD
 * @param opts.pagina number paginacao (default 1)
 * @returns string XML do nodo de envio (sem envelope SOAP)
 */
export function montarConsultarServicoTomado(opts) {
    const cnpj = String(opts.cnpjTomador || '').replace(/\D/g, '');
    if (cnpj.length !== 14) throw new Error('cnpjTomador deve ter 14 digitos');
    const im = opts.inscricaoMunicipal ? escapeXml(opts.inscricaoMunicipal) : '';
    const di = fmtIsoDate(opts.dataInicial);
    const df = fmtIsoDate(opts.dataFinal);
    const pag = Number(opts.pagina) > 0 ? Number(opts.pagina) : 1;

    return `<ConsultarNfseServicoTomadoEnvio xmlns="${NS}">`
        + `<Consulente>`
        + `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>`
        + (im ? `<InscricaoMunicipal>${im}</InscricaoMunicipal>` : '')
        + `</Consulente>`
        + `<PeriodoEmissao>`
        + `<DataInicial>${di}</DataInicial>`
        + `<DataFinal>${df}</DataFinal>`
        + `</PeriodoEmissao>`
        + `<Pagina>${pag}</Pagina>`
        + `</ConsultarNfseServicoTomadoEnvio>`;
}

/**
 * Equivalente para servico PRESTADO (empresa emitiu NFSe; consulta pra ver
 * o que ja foi emitido). Mesma estrutura, troca Consulente -> Prestador.
 */
export function montarConsultarServicoPrestado(opts) {
    const cnpj = String(opts.cnpjPrestador || '').replace(/\D/g, '');
    if (cnpj.length !== 14) throw new Error('cnpjPrestador deve ter 14 digitos');
    const im = opts.inscricaoMunicipal ? escapeXml(opts.inscricaoMunicipal) : '';
    const di = fmtIsoDate(opts.dataInicial);
    const df = fmtIsoDate(opts.dataFinal);
    const pag = Number(opts.pagina) > 0 ? Number(opts.pagina) : 1;

    return `<ConsultarNfseServicoPrestadoEnvio xmlns="${NS}">`
        + `<Prestador>`
        + `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>`
        + (im ? `<InscricaoMunicipal>${im}</InscricaoMunicipal>` : '')
        + `</Prestador>`
        + `<PeriodoEmissao>`
        + `<DataInicial>${di}</DataInicial>`
        + `<DataFinal>${df}</DataFinal>`
        + `</PeriodoEmissao>`
        + `<Pagina>${pag}</Pagina>`
        + `</ConsultarNfseServicoPrestadoEnvio>`;
}

/**
 * Wrap o corpo ABRASF em envelope SOAP. Cada municipio tem um leve ajuste
 * (namespace, sufixo do action, body wrapper). Os 3 templates abaixo cobrem
 * os formatos mais comuns:
 *
 *   - 'soap12-padrao'  - SOAP 1.2 simples (curitiba, salvador novos)
 *   - 'soap11-padrao'  - SOAP 1.1 (megasoft - barueri, santos, sao caetano)
 *   - 'soap11-cdata'   - SOAP 1.1 com payload em CDATA dentro de <nfseDadosMsg>
 *                        (formato Megasoft antigo - barueri >2020)
 */
export function envelopeSoap(opts) {
    const { formato, soapAction, payloadAbrasf, operacao } = opts;
    const op = operacao || 'ConsultarNfseServicoTomado';

    if (formato === 'soap12-padrao') {
        return `<?xml version="1.0" encoding="UTF-8"?>`
            + `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">`
            + `<soap12:Body>${payloadAbrasf}</soap12:Body>`
            + `</soap12:Envelope>`;
    }

    if (formato === 'soap11-cdata') {
        // Megasoft: corpo em <nfseDadosMsg> com CDATA
        return `<?xml version="1.0" encoding="UTF-8"?>`
            + `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:nfse="http://nfse.abrasf.org.br">`
            + `<soap:Body>`
            + `<nfse:${op}Request>`
            + `<nfseDadosMsg><![CDATA[${payloadAbrasf}]]></nfseDadosMsg>`
            + `</nfse:${op}Request>`
            + `</soap:Body>`
            + `</soap:Envelope>`;
    }

    // 'soap11-padrao' (default)
    return `<?xml version="1.0" encoding="UTF-8"?>`
        + `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">`
        + `<soap:Body>${payloadAbrasf}</soap:Body>`
        + `</soap:Envelope>`;
}

/**
 * Devolve o header SOAPAction adequado conforme o municipio.
 * Alguns servidores Megasoft sao estritos quanto a string exata.
 */
export function soapActionHeader(config, operacao) {
    if (config.soapAction) {
        // SOAPAction pode vir com '/' final ou nao - normalizamos
        if (config.soapAction.endsWith(operacao)) return config.soapAction;
        if (config.soapAction.endsWith('/')) return `${config.soapAction}${operacao}`;
        // Substitui ultimo segmento
        return `${config.soapAction.split('/').slice(0, -1).join('/')}/${operacao}`;
    }
    return `http://www.abrasf.org.br/nfse/${operacao}`;
}
