// ============================================================================
// sefaz-backend/nfse-nacional-provider.js
// Provider abstrato pra emissao de NFS-e Padrao Nacional.
//
// Base regulatoria:
//   Resolucao CGSN 189/2026 — Vigencia 1° setembro 2026
//   Toda ME/EPP do Simples prestadora de servicos OBRIGADA a usar.
//
// Modos:
//   - 'mock'   (dev): emite NFSe ficticia com numero + chave + DPS
//   - 'serpro' (default): Emissor Publico Nacional NFS-e via API SEFIN
//                         https://www.gov.br/nfse (gratuito)
//
// Em modo SERPRO, este provider monta uma DPS fiscal basica a partir do
// formulario, assina com o certificado A1 do escritorio, compacta e envia ao
// endpoint oficial POST /nfse. Tambem aceita DPS XML manual como override.
// ============================================================================

import { gzipSync, gunzipSync } from 'node:zlib';
import { Agent } from 'undici';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { loadCertificate } from './secret-loader.js';

// Default 'serpro' (REAL). 'mock' só com NFSE_NAC_MODE=mock explícito (dev local).
// Sem config, falha no SERPRO em vez de devolver dado fake pro cliente.
const MODE = normalizeMode(process.env.NFSE_NAC_MODE || 'serpro');
const AMBIENTE = normalizeAmbiente(process.env.NFSE_NAC_ENV || process.env.NFSE_NAC_AMB || 'producao');
const BASE_URL = (
    process.env.NFSE_NAC_BASE_URL
    || (AMBIENTE === 'restrita'
        ? 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional'
        : 'https://sefin.nfse.gov.br/SefinNacional')
).replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = Number(process.env.NFSE_NAC_TIMEOUT_MS || 60000);
const NFSE_VERSAO = process.env.NFSE_NAC_LAYOUT_VERSION || '1.01';
const NFSE_XML_NS = 'http://www.sped.fazenda.gov.br/nfse';
const VER_APLIC = String(process.env.NFSE_NAC_VER_APLIC || 'CFI-1.2.1').slice(0, 20);
const DEFAULT_SERIE_DPS = process.env.NFSE_NAC_SERIE_DPS || '1';
const DEFAULT_CTRIBNAC = process.env.NFSE_NAC_DEFAULT_CTRIBNAC || '';

// ─── Helpers ──────────────────────────────────────────────────────────────

function normalizeMode(value) {
    return String(value || '').toLowerCase() === 'mock' ? 'mock' : 'serpro';
}

function normalizeAmbiente(value) {
    const v = String(value || '').toLowerCase();
    return ['restrita', 'homologacao', 'homologação', 'teste', 'testes'].includes(v) ? 'restrita' : 'producao';
}

function gerarChaveNfse(cnpjPrestador, ano, sequencial) {
    // Chave simplificada: 50 chars (versao mock; padrao real tem layout especifico)
    // [2 ano] + [14 cnpj] + [6 mun ibge default 3550308] + [10 sequencial] + [18 hash]
    const cnpj = (cnpjPrestador || '').replace(/\D/g, '').padStart(14, '0').slice(0, 14);
    const seq = String(sequencial).padStart(10, '0').slice(-10);
    const ts = Date.now().toString().padStart(13, '0').slice(-13);
    const tail = Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');
    return `${ano}${cnpj}3550308${seq}${ts}${tail}`.slice(0, 50);
}

function calcularIssRetido(valorServico, aliquotaIss, deveRetido) {
    if (!deveRetido) return 0;
    return +(valorServico * (aliquotaIss / 100)).toFixed(2);
}

function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function requiredText(path, value) {
    const text = String(value ?? '').trim();
    if (!text) throw new Error(`${path} obrigatorio para montar DPS Nacional.`);
    return text;
}

function truncateText(value, max) {
    return String(value ?? '').trim().slice(0, max);
}

function normalizeCnpj(value, path = 'CNPJ') {
    const digits = onlyDigits(value);
    if (digits.length !== 14) throw new Error(`${path} deve conter 14 digitos.`);
    return digits;
}

function normalizeCpf(value, path = 'CPF') {
    const digits = onlyDigits(value);
    if (digits.length !== 11) throw new Error(`${path} deve conter 11 digitos.`);
    return digits;
}

function normalizePrestadorFederal(prestador = {}) {
    if (prestador.cpf) {
        const cpf = normalizeCpf(prestador.cpf, 'Prestador.cpf');
        return { tag: 'CPF', value: cpf, tipoInscricaoFederal: '1', idFederal: cpf.padStart(14, '0') };
    }
    const cnpj = normalizeCnpj(prestador.cnpj, 'Prestador.cnpj');
    return { tag: 'CNPJ', value: cnpj, tipoInscricaoFederal: '2', idFederal: cnpj };
}

function normalizeTomadorFederal(tomador = {}) {
    if (tomador.cpf) return { tag: 'CPF', value: normalizeCpf(tomador.cpf, 'Tomador.cpf') };
    return { tag: 'CNPJ', value: normalizeCnpj(tomador.cnpj, 'Tomador.cnpj') };
}

function normalizeCodMun(value, path) {
    const digits = onlyDigits(value);
    if (digits.length !== 7) throw new Error(`${path} deve conter codigo IBGE com 7 digitos.`);
    return digits;
}

function normalizeFixedDigits(value, length, path, { required = true } = {}) {
    const digits = onlyDigits(value);
    if (!digits && !required) return '';
    if (digits.length !== length) throw new Error(`${path} deve conter ${length} digitos.`);
    return digits;
}

function normalizeSerieDps(value) {
    const digits = onlyDigits(value || DEFAULT_SERIE_DPS);
    if (!digits || digits.length > 5) throw new Error('serieDps deve conter de 1 a 5 digitos.');
    return digits;
}

function normalizeNumeroDps(value) {
    const digits = onlyDigits(value);
    if (!digits) throw new Error('numeroDps obrigatorio para montar DPS Nacional.');
    if (!/^[1-9][0-9]{0,14}$/.test(digits)) {
        throw new Error('numeroDps deve conter de 1 a 15 digitos e nao pode iniciar com zero.');
    }
    return digits;
}

function formatDateForNfse(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) throw new Error('dataCompetencia/dataEmissao invalida para DPS Nacional.');
    return date.toISOString().slice(0, 10);
}

function formatDateTimeForNfse(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) throw new Error('dataEmissao invalida para DPS Nacional.');
    const iso = date.toISOString();
    return `${iso.slice(0, 19)}+00:00`;
}

function parseFiniteNumber(value, path) {
    const num = Number(String(value ?? '').replace(',', '.'));
    if (!Number.isFinite(num)) throw new Error(`${path} invalido.`);
    return num;
}

function formatDecimal2(value, path) {
    const num = parseFiniteNumber(value, path);
    if (num < 0) throw new Error(`${path} nao pode ser negativo.`);
    return num.toFixed(2);
}

function formatAliquotaIss(value) {
    const num = parseFiniteNumber(value ?? 0, 'servico.aliquotaIss');
    if (num < 0) throw new Error('servico.aliquotaIss nao pode ser negativa.');
    if (num > 5) throw new Error(`Aliquota ISS ${num}% excede maximo legal de 5% (LC 116/2003 art. 8º II).`);
    if (num > 9) throw new Error('servico.aliquotaIss excede limite do layout nacional.');
    return num.toFixed(2);
}

function normalizeEnum(value, allowed, fallback, path) {
    const text = String(value ?? fallback).trim();
    if (!allowed.includes(text)) throw new Error(`${path} invalido: ${text}.`);
    return text;
}

function optionalXmlElement(name, value, maxLength) {
    const text = truncateText(value, maxLength);
    return text ? `<${name}>${escapeXml(text)}</${name}>` : '';
}

function buildPessoaXml(pessoa, path) {
    const federal = normalizeTomadorFederal(pessoa);
    const nome = truncateText(requiredText(`${path}.nome`, pessoa.nome), 300);
    const im = optionalXmlElement('IM', pessoa.im, 15);
    return [
        `<${federal.tag}>${federal.value}</${federal.tag}>`,
        im,
        `<xNome>${escapeXml(nome)}</xNome>`,
    ].filter(Boolean).join('');
}

function montarDpsXmlBasica(req = {}) {
    const prestador = req.prestador || {};
    const tomador = req.tomador || {};
    const servico = req.servico || {};
    const prestFederal = normalizePrestadorFederal(prestador);

    const cLocEmi = normalizeCodMun(
        req.cLocEmi || prestador.municipioIbge || prestador.codMunIBGE || servico.municipioEmissor,
        'prestador.municipioIbge'
    );
    const municipioPrestacao = normalizeCodMun(servico.municipioPrestacao || cLocEmi, 'servico.municipioPrestacao');
    const serie = normalizeSerieDps(req.serieDps || req.serie || req.dpsSerie);
    const numeroDps = normalizeNumeroDps(req.numeroDps || req.nDPS || req.sequencial);
    const cTribNac = normalizeFixedDigits(servico.cTribNac || DEFAULT_CTRIBNAC, 6, 'servico.cTribNac');
    const cTribMun = normalizeFixedDigits(servico.cTribMun, 3, 'servico.cTribMun', { required: false });
    const cNBS = normalizeFixedDigits(servico.codigoNbs, 9, 'servico.codigoNbs', { required: false });
    const descricao = truncateText(requiredText('servico.descricao', servico.descricao), 2000);
    const valorServicoNum = parseFiniteNumber(requiredText('servico.valor', servico.valor), 'servico.valor');
    if (valorServicoNum <= 0) throw new Error('servico.valor deve ser maior que zero.');
    const valorServico = formatDecimal2(valorServicoNum, 'servico.valor');
    const aliquota = formatAliquotaIss(servico.aliquotaIss ?? 0);
    const tpRetISSQN = servico.issRetido ? '2' : '1';
    const dhEmi = formatDateTimeForNfse(req.dataEmissao || new Date());
    const dCompet = formatDateForNfse(req.dCompet || req.dataCompetencia || req.dataEmissao || new Date());
    const tpAmb = AMBIENTE === 'producao' ? '1' : '2';
    const opSimpNac = normalizeEnum(prestador.opSimpNac, ['1', '2', '3'], '3', 'prestador.opSimpNac');
    const regApTribSN = opSimpNac === '3'
        ? normalizeEnum(prestador.regApTribSN, ['1', '2', '3'], '1', 'prestador.regApTribSN')
        : '';
    const regEspTrib = normalizeEnum(prestador.regEspTrib, ['0', '1', '2', '3', '4', '5', '6', '9'], '0', 'prestador.regEspTrib');
    const idDps = [
        'DPS',
        cLocEmi,
        prestFederal.tipoInscricaoFederal,
        prestFederal.idFederal,
        serie.padStart(5, '0'),
        numeroDps.padStart(15, '0'),
    ].join('');

    return [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<DPS xmlns="${NFSE_XML_NS}" versao="${NFSE_VERSAO}">`,
        `<infDPS Id="${idDps}">`,
        `<tpAmb>${tpAmb}</tpAmb>`,
        `<dhEmi>${dhEmi}</dhEmi>`,
        `<verAplic>${escapeXml(VER_APLIC)}</verAplic>`,
        `<serie>${serie}</serie>`,
        `<nDPS>${numeroDps}</nDPS>`,
        `<dCompet>${dCompet}</dCompet>`,
        `<tpEmit>1</tpEmit>`,
        `<cLocEmi>${cLocEmi}</cLocEmi>`,
        `<prest>`,
        `<${prestFederal.tag}>${prestFederal.value}</${prestFederal.tag}>`,
        optionalXmlElement('IM', prestador.im, 15),
        optionalXmlElement('xNome', prestador.nome, 300),
        `<regTrib><opSimpNac>${opSimpNac}</opSimpNac>${regApTribSN ? `<regApTribSN>${regApTribSN}</regApTribSN>` : ''}<regEspTrib>${regEspTrib}</regEspTrib></regTrib>`,
        `</prest>`,
        `<toma>${buildPessoaXml(tomador, 'tomador')}</toma>`,
        `<serv><locPrest><cLocPrestacao>${municipioPrestacao}</cLocPrestacao></locPrest><cServ>`,
        `<cTribNac>${cTribNac}</cTribNac>`,
        cTribMun ? `<cTribMun>${cTribMun}</cTribMun>` : '',
        `<xDescServ>${escapeXml(descricao)}</xDescServ>`,
        cNBS ? `<cNBS>${cNBS}</cNBS>` : '',
        `</cServ></serv>`,
        `<valores><vServPrest><vServ>${valorServico}</vServ></vServPrest><trib><tribMun>`,
        `<tribISSQN>1</tribISSQN><tpRetISSQN>${tpRetISSQN}</tpRetISSQN><pAliq>${aliquota}</pAliq>`,
        `</tribMun><totTrib><indTotTrib>0</indTotTrib></totTrib></trib></valores>`,
        `</infDPS></DPS>`,
    ].filter(Boolean).join('');
}

function parseJsonOrText(text) {
    if (!text) return null;
    try { return JSON.parse(text); }
    catch { return text; }
}

function xmlHasSignature(xml) {
    return /<(?:\w+:)?Signature[\s>]/.test(String(xml || ''));
}

function getElementsByLocalName(doc, name) {
    const all = doc.getElementsByTagName('*');
    const nodes = [];
    for (let i = 0; i < all.length; i++) {
        const node = all[i];
        if ((node.localName || node.nodeName.split(':').pop()) === name) nodes.push(node);
    }
    return nodes;
}

function xmlGetFirstText(xml, names) {
    if (!xml) return '';
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    for (const name of names) {
        const nodes = getElementsByLocalName(doc, name);
        if (nodes.length && nodes[0]?.textContent) return nodes[0].textContent.trim();
    }
    return '';
}

function xmlGetInfDpsId(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const nodes = getElementsByLocalName(doc, 'infDPS');
    const node = nodes[0];
    return node?.getAttribute('Id') || '';
}

function gzipXmlToBase64(xml) {
    return gzipSync(Buffer.from(String(xml || ''), 'utf8'), { level: 9 }).toString('base64');
}

function gunzipBase64ToText(value) {
    return gunzipSync(Buffer.from(String(value || ''), 'base64')).toString('utf8');
}

function pickMensagemErro(body) {
    if (!body) return '';
    if (typeof body === 'string') return body.slice(0, 1000);
    const erros = body.erros || body.mensagens || body.errors;
    if (Array.isArray(erros) && erros.length) {
        return erros.map(e => {
            if (typeof e === 'string') return e;
            return [e.codigo, e.descricao || e.mensagem || e.message].filter(Boolean).join(' - ');
        }).filter(Boolean).join('; ');
    }
    return body.error || body.message || JSON.stringify(body).slice(0, 1000);
}

function normalizarNfseSerpro(req, response, dpsXmlGZipB64) {
    const nfseXmlGZipB64 = response?.nfseXmlGZipB64 || '';
    const nfseXml = nfseXmlGZipB64 ? gunzipBase64ToText(nfseXmlGZipB64) : '';

    const numero = xmlGetFirstText(nfseXml, ['nNFSe', 'nDFSe'])
        || String(response?.chaveAcesso || '').slice(-13)
        || '';
    const chave = response?.chaveAcesso || xmlGetFirstText(nfseXml, ['chNFSe']);
    if (!chave) throw new Error('SEFIN Nacional retornou sucesso sem chaveAcesso.');

    const valorServico = Number(req.servico?.valor || xmlGetFirstText(nfseXml, ['vServ']) || 0);
    const aliquota = Number(req.servico?.aliquotaIss || xmlGetFirstText(nfseXml, ['pAliq']) || 0);
    const issValor = +(valorServico * (aliquota / 100)).toFixed(2);
    const issRetido = calcularIssRetido(valorServico, aliquota, !!req.servico?.issRetido);

    return {
        numero,
        chave,
        dpsRecibo: response.idDps || response.idDPS || null,
        dataEmissao: response.dataHoraProcessamento || xmlGetFirstText(nfseXml, ['dhProc', 'dhEmi']) || new Date().toISOString(),
        status: 'autorizada',
        prestador: {
            cnpj: onlyDigits(req.prestador?.cnpj),
            im: req.prestador?.im || '',
            nome: req.prestador?.nome || '',
        },
        tomador: {
            cnpj: req.tomador?.cnpj ? onlyDigits(req.tomador.cnpj) : null,
            cpf: req.tomador?.cpf ? onlyDigits(req.tomador.cpf) : null,
            nome: req.tomador?.nome || '',
            endereco: req.tomador?.endereco || null,
        },
        servico: {
            codigoNbs: req.servico?.codigoNbs || xmlGetFirstText(nfseXml, ['cNBS']) || '',
            descricao: req.servico?.descricao || xmlGetFirstText(nfseXml, ['xDescServ']) || '',
            valor: valorServico,
            aliquotaIss: aliquota,
            issValor,
            issRetido,
            municipioPrestacao: req.servico?.municipioPrestacao || xmlGetFirstText(nfseXml, ['cLocPrestacao']) || '',
            cIndOp: req.servico?.cIndOp || '',
            cClassTrib: req.servico?.cClassTrib || '',
            cTribNac: req.servico?.cTribNac || xmlGetFirstText(nfseXml, ['cTribNac']) || '',
        },
        valores: {
            bruto: valorServico,
            deducoes: Number(req.servico?.deducoes || 0),
            issRetido,
            liquido: +(valorServico - issRetido).toFixed(2),
        },
        fonte: 'serpro',
        mensagem: 'NFSe Nacional autorizada pela SEFIN Nacional.',
        serpro: {
            ambiente: AMBIENTE,
            tipoAmbiente: response.tipoAmbiente || null,
            versaoAplicativo: response.versaoAplicativo || null,
            dataHoraProcessamento: response.dataHoraProcessamento || null,
            alertas: response.alertas || [],
        },
        nfseXmlGZipB64,
        dpsXmlGZipB64,
    };
}

async function assinarDpsXml(xml) {
    if (xmlHasSignature(xml)) return xml;
    const infDpsId = xmlGetInfDpsId(xml);
    if (!infDpsId) {
        throw new Error('XML da DPS sem infDPS@Id. Informe uma DPS no layout oficial antes de emitir.');
    }

    const cert = await loadCertificate();
    if (!cert.pemKey || !cert.pemCert) {
        throw new Error('Certificado A1 sem PEM extraido. NFS-e Nacional precisa assinar XMLDSIG da DPS.');
    }

    const sig = new SignedXml({
        privateKey: cert.pemKey,
        publicCert: cert.pemCert,
        signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
        canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    });
    sig.addReference({
        xpath: `//*[@Id="${infDpsId}"]`,
        transforms: [
            'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
            'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
        ],
        digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
        uri: `#${infDpsId}`,
    });

    const certBody = cert.pemCert
        .replace(/-----BEGIN CERTIFICATE-----/, '')
        .replace(/-----END CERTIFICATE-----/, '')
        .replace(/\s+/g, '');
    sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${certBody}</X509Certificate></X509Data>`;
    sig.computeSignature(xml, {
        location: {
            reference: `//*[@Id="${infDpsId}"]`,
            action: 'after',
        },
    });
    return sig.getSignedXml();
}

async function prepararDpsXmlGZipB64(req = {}) {
    if (req.dpsXmlGZipB64) return String(req.dpsXmlGZipB64).trim();
    const xml = String(req.dpsXmlAssinado || req.dpsXml || '').trim();
    const dpsXml = xml || montarDpsXmlBasica(req);
    const xmlAssinado = await assinarDpsXml(dpsXml);
    return gzipXmlToBase64(xmlAssinado);
}

let mtlsDispatcherCache = { dispatcher: null, certVersion: null };
async function getNfseMtlsDispatcher() {
    const cert = await loadCertificate();
    if (mtlsDispatcherCache.dispatcher && mtlsDispatcherCache.certVersion === cert.version) {
        return mtlsDispatcherCache.dispatcher;
    }
    if (!cert.pemKey || !cert.pemCert) {
        throw new Error('Certificado A1 ICP-Brasil obrigatório para emissão NFS-e Nacional via SEFIN.');
    }
    const dispatcher = new Agent({
        connect: {
            key: cert.pemKey,
            cert: cert.pemCert,
            rejectUnauthorized: true,
        },
    });
    mtlsDispatcherCache = { dispatcher, certVersion: cert.version };
    return dispatcher;
}

export class NfseNacionalApiError extends Error {
    constructor(status, body) {
        super(`SEFIN Nacional ${status}: ${pickMensagemErro(body)}`);
        this.name = 'NfseNacionalApiError';
        this.statusCode = status;
        this.body = body;
    }
}

// ─── MockProvider ─────────────────────────────────────────────────────────

class MockProvider {
    /**
     * Emite NFSe Nacional (mock).
     *
     * @param {object} req {
     *   prestador: { cnpj, im, nome },
     *   tomador: { cnpj?, cpf?, nome, endereco? },
     *   servico: {
     *     codigoNbs,            // codigo NBS da Nomenclatura Brasileira de Servicos
     *     descricao,
     *     valor,
     *     aliquotaIss,
     *     issRetido?,
     *     municipioPrestacao?,  // codigo IBGE
     *   },
     *   dataEmissao?,
     *   sequencial?
     * }
     * @returns NFSe persistivel
     */
    async emitirNfse(req) {
        const { prestador, tomador, servico } = req;
        if (!prestador?.cnpj) throw new Error('Prestador.cnpj obrigatorio');
        if (!servico?.valor || servico.valor <= 0) throw new Error('Valor do servico obrigatorio (>0)');
        if (!servico?.descricao) throw new Error('Descricao do servico obrigatoria');
        if (!tomador?.nome) throw new Error('Tomador.nome obrigatorio');

        // Validacao fiscal — LC 116/2003 art. 8º II: aliquota maxima ISS = 5%.
        // EC 37/2002 art. 88: aliquota minima ISS = 2% (exceto servicos com
        // beneficio formal do municipio listados no art. 88 §1º).
        const aliq = servico.aliquotaIss ?? 5;
        if (aliq > 5) {
            throw new Error(`Aliquota ISS ${aliq}% excede maximo legal de 5% (LC 116/2003 art. 8º II).`);
        }
        if (aliq < 0) {
            throw new Error('Aliquota ISS nao pode ser negativa.');
        }

        const ano = new Date().getFullYear().toString().slice(-2);
        const seq = req.sequencial || Math.floor(Math.random() * 999999);
        const numero = `2026${String(seq).padStart(8, '0')}`;
        const chave = gerarChaveNfse(prestador.cnpj, ano, seq);

        const aliquota = servico.aliquotaIss || 5;
        const issValor = +(servico.valor * (aliquota / 100)).toFixed(2);
        const issRetido = calcularIssRetido(servico.valor, aliquota, !!servico.issRetido);
        const valorLiquido = +(servico.valor - issRetido).toFixed(2);

        return {
            numero,
            chave,
            dpsRecibo: `DPS-MOCK-${Date.now().toString(36)}`,
            dataEmissao: req.dataEmissao || new Date().toISOString(),
            status: 'autorizada',
            prestador: {
                cnpj: prestador.cnpj,
                im: prestador.im || '',
                nome: prestador.nome || '',
            },
            tomador: {
                cnpj: tomador.cnpj || null,
                cpf: tomador.cpf || null,
                nome: tomador.nome,
                endereco: tomador.endereco || null,
            },
            servico: {
                codigoNbs: servico.codigoNbs || '101010100',
                descricao: servico.descricao,
                valor: servico.valor,
                aliquotaIss: aliquota,
                issValor,
                issRetido,
                municipioPrestacao: servico.municipioPrestacao || '3550308',
                cIndOp: servico.cIndOp || '',
                cClassTrib: servico.cClassTrib || '',
            },
            valores: {
                bruto: servico.valor,
                deducoes: 0,
                issRetido,
                liquido: valorLiquido,
            },
            fonte: 'mock',
            mensagem: 'NFSe emitida em modo mock. URL/PDF de DANFSe nao disponiveis em mock.',
        };
    }

    async cancelarNfse(req) {
        const { numero, chave, motivo } = req;
        return {
            ok: true,
            numero,
            chave,
            motivo: motivo || 'erro de digitacao',
            canceladaEm: new Date().toISOString(),
            fonte: 'mock',
        };
    }
}

// ─── SerproProvider (skeleton) ────────────────────────────────────────────

class SerproProvider {
    async emitirNfse(req) {
        const dpsXmlGZipB64 = await prepararDpsXmlGZipB64(req);
        const dispatcher = await getNfseMtlsDispatcher();
        const res = await fetch(`${BASE_URL}/nfse`, {
            method: 'POST',
            dispatcher,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dpsXmlGZipB64 }),
        });
        const text = await res.text().catch(() => '');
        const body = parseJsonOrText(text);
        if (!res.ok) throw new NfseNacionalApiError(res.status, body);
        return normalizarNfseSerpro(req, body, dpsXmlGZipB64);
    }

    async cancelarNfse(req) {
        if (!req?.pedidoRegistroEventoXmlGZipB64) {
            throw new Error(
                'Cancelamento SERPRO exige pedidoRegistroEventoXmlGZipB64 no layout oficial de evento. ' +
                'A emissao esta liberada; cancelamento real fica condicionado ao XML do evento.'
            );
        }
        const chave = onlyDigits(req.chave);
        if (chave.length !== 50) throw new Error('chave obrigatoria com 50 digitos');
        const dispatcher = await getNfseMtlsDispatcher();
        const res = await fetch(`${BASE_URL}/nfse/${chave}/eventos`, {
            method: 'POST',
            dispatcher,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pedidoRegistroEventoXmlGZipB64: req.pedidoRegistroEventoXmlGZipB64 }),
        });
        const text = await res.text().catch(() => '');
        const body = parseJsonOrText(text);
        if (!res.ok) throw new NfseNacionalApiError(res.status, body);
        return {
            ok: true,
            chave,
            motivo: req.motivo || 'cancelamento via evento SEFIN Nacional',
            canceladaEm: body?.dataHoraProcessamento || new Date().toISOString(),
            fonte: 'serpro',
            serpro: body,
        };
    }
}

// ─── Factory ──────────────────────────────────────────────────────────────

let providerInstance = null;
export function getNfseNacionalProvider() {
    if (providerInstance) return providerInstance;
    providerInstance = MODE === 'serpro' ? new SerproProvider() : new MockProvider();
    return providerInstance;
}
export function getNfseNacionalMode() { return MODE; }

export function getNfseNacionalCapabilities() {
    return {
        mode: MODE,
        ok: true,
        ambiente: AMBIENTE,
        layoutVersion: NFSE_VERSAO,
        baseUrl: MODE === 'serpro' ? BASE_URL : null,
        emitir: {
            available: true,
            provider: MODE === 'serpro' ? 'sefin-nacional' : 'mock',
            requiresDpsXml: false,
            generatesDpsXml: MODE === 'serpro',
            accepts: MODE === 'serpro' ? ['formulario', 'dpsXmlGZipB64', 'dpsXmlAssinado', 'dpsXml'] : ['formulario'],
        },
        cancelar: {
            available: MODE === 'mock',
            provider: MODE === 'serpro' ? 'sefin-nacional-eventos' : 'mock',
            requiresPedidoRegistroEventoXmlGZipB64: MODE === 'serpro',
        },
    };
}

export const __testables = {
    gzipXmlToBase64,
    gunzipBase64ToText,
    montarDpsXmlBasica,
    normalizarNfseSerpro,
    prepararDpsXmlGZipB64,
    xmlGetInfDpsId,
};

// ─── NBS — Nomenclatura Brasileira de Servicos (subset inicial) ───────────
//
// A tabela completa tem ~600 codigos. Carregar progressivamente conforme
// necessidade dos clientes da SP Contabil. Os codigos abaixo cobrem ~80%
// das prestacoes dos clientes tipicos do escritorio.

export const NBS_CODIGOS_COMUNS = [
    // ─── 1. Servicos contabeis e fiscais (LC 116 item 17) ───────────────
    { codigo: '101010100', descricao: 'Contabilidade — Escrituracao contabil regular', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010200', descricao: 'Contabilidade — Auditoria independente', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010300', descricao: 'Contabilidade — Consultoria contabil', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010400', descricao: 'Contabilidade — Pericia contabil', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010500', descricao: 'Contabilidade — Departamento pessoal e folha', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010600', descricao: 'Assessoria fiscal e tributaria', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010700', descricao: 'Planejamento tributario', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010800', descricao: 'Recuperacao de creditos tributarios', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101010900', descricao: 'Atualizacao cadastral fiscal', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 2. Servicos juridicos (LC 116 item 17.13) ──────────────────────
    { codigo: '101020100', descricao: 'Servicos juridicos — Consultoria', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020200', descricao: 'Advocacia — Defesa em juizo civel', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020300', descricao: 'Advocacia — Defesa criminal', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020400', descricao: 'Advocacia tributaria', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020500', descricao: 'Advocacia trabalhista', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020600', descricao: 'Advocacia empresarial e societaria', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020700', descricao: 'Mediacao e arbitragem', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101020800', descricao: 'Servicos de cartorio', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 3. Engenharia e arquitetura (LC 116 item 7) ────────────────────
    { codigo: '101030100', descricao: 'Engenharia consultiva', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101030200', descricao: 'Engenharia civil — Projetos', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101030300', descricao: 'Engenharia civil — Execucao de obra', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101030400', descricao: 'Arquitetura', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101030500', descricao: 'Engenharia de seguranca do trabalho', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101030600', descricao: 'Agrimensura e topografia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101030700', descricao: 'Geologia e geotecnia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 4. Tecnologia da Informacao (LC 116 item 1) ────────────────────
    { codigo: '101040100', descricao: 'TI — Desenvolvimento de software sob encomenda', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040200', descricao: 'TI — Manutencao e suporte de software', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040300', descricao: 'TI — Hospedagem em nuvem (cloud)', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040400', descricao: 'TI — Provedor de internet', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040500', descricao: 'TI — Suporte tecnico em hardware', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101040600', descricao: 'TI — Licenciamento de software pronto (SaaS)', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040700', descricao: 'TI — Consultoria em TI', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040800', descricao: 'TI — Treinamento em TI', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101040900', descricao: 'TI — Backup e recuperacao de dados', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101041000', descricao: 'TI — Seguranca da informacao (cibersec)', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101041100', descricao: 'TI — Streaming de audio/video', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 5. Marketing e Publicidade (LC 116 item 17.06, 17.10) ──────────
    { codigo: '101050100', descricao: 'Marketing e publicidade — Criacao', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101050200', descricao: 'Marketing e publicidade — Veiculacao', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101050300', descricao: 'Marketing digital e SEO', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101050400', descricao: 'Producao de conteudo audiovisual', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101050500', descricao: 'Producao grafica e design', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101050600', descricao: 'Pesquisa de mercado', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101050700', descricao: 'Assessoria de imprensa e relacoes publicas', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 6. Saude (LC 116 item 4) ────────────────────────────────────────
    { codigo: '101060100', descricao: 'Saude — Clinica medica', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060200', descricao: 'Saude — Odontologia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060300', descricao: 'Saude — Psicologia e psicanalise', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060400', descricao: 'Saude — Fisioterapia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060500', descricao: 'Saude — Fonoaudiologia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060600', descricao: 'Saude — Nutricao', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060700', descricao: 'Saude — Laboratorio de analises clinicas', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060800', descricao: 'Saude — Diagnostico por imagem', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101060900', descricao: 'Saude — Internacao hospitalar', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101061000', descricao: 'Saude — Medicina veterinaria', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 7. Educacao (LC 116 item 8) ────────────────────────────────────
    { codigo: '101070100', descricao: 'Educacao — Cursos livres', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070200', descricao: 'Educacao — Ensino fundamental', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070300', descricao: 'Educacao — Ensino medio', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070400', descricao: 'Educacao — Ensino superior e pos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070500', descricao: 'Educacao — Cursos de idiomas', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070600', descricao: 'Educacao — Cursos profissionalizantes', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070700', descricao: 'Educacao — Treinamento corporativo', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101070800', descricao: 'Educacao — Coaching e mentoria', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 8. Transporte (LC 116 item 16) ─────────────────────────────────
    { codigo: '101080100', descricao: 'Transporte de cargas — Rodoviario', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },
    { codigo: '101080200', descricao: 'Transporte de passageiros — Rodoviario', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },
    { codigo: '101080300', descricao: 'Transporte de cargas — Aereo', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },
    { codigo: '101080400', descricao: 'Transporte de cargas — Aquaviario', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },
    { codigo: '101080500', descricao: 'Transporte de bagagem e mudancas', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },
    { codigo: '101080600', descricao: 'Servicos de moto-frete', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },
    { codigo: '101080700', descricao: 'Transporte por aplicativo', cIndOpSugerido: '050102', cClassTribSugerido: '00000000' },

    // ─── 9. Limpeza, Seguranca, Vigilancia (LC 116 item 7.10, 11) ───────
    { codigo: '101090100', descricao: 'Limpeza e conservacao predial', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101090200', descricao: 'Vigilancia armada e desarmada', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101090300', descricao: 'Portaria e recepcao', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101090400', descricao: 'Dedetizacao e controle de pragas', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101090500', descricao: 'Lavanderia industrial e domestica', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101090600', descricao: 'Coleta de residuos e lixo', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101090700', descricao: 'Jardinagem e paisagismo', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 10. Manutencao mecanica e eletrica (LC 116 item 14) ────────────
    { codigo: '101100100', descricao: 'Manutencao mecanica de veiculos', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100200', descricao: 'Manutencao eletrica de veiculos', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100300', descricao: 'Lanternagem e funilaria', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100400', descricao: 'Pintura automotiva', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100500', descricao: 'Manutencao de eletrodomesticos', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100600', descricao: 'Manutencao de computadores e perifericos', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100700', descricao: 'Manutencao de elevadores', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101100800', descricao: 'Manutencao de ar-condicionado e refrigeracao', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 11. Comissaria e representacao (LC 116 item 10) ────────────────
    { codigo: '101110100', descricao: 'Representacao comercial', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101110200', descricao: 'Comissaria e despachos aduaneiros', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101110300', descricao: 'Agenciamento e corretagem em geral', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101110400', descricao: 'Corretagem de imoveis', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101110500', descricao: 'Corretagem de seguros', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 12. Beleza e estetica (LC 116 item 6) ──────────────────────────
    { codigo: '101120100', descricao: 'Cabeleireiro e barbearia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101120200', descricao: 'Manicure e pedicure', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101120300', descricao: 'Estetica facial e corporal', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101120400', descricao: 'Massoterapia', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101120500', descricao: 'Tatuagem e body piercing', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 13. Hotelaria, alimentacao, turismo (LC 116 item 9) ────────────
    { codigo: '101130100', descricao: 'Hotelaria — Hospedagem', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101130200', descricao: 'Pousada e hostel', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101130300', descricao: 'Bar e restaurante (servico de mesa)', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101130400', descricao: 'Bufe e eventos', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101130500', descricao: 'Agencia de viagens e turismo', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101130600', descricao: 'Servicos de guia turistico', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 14. Construcao civil (LC 116 item 7) ───────────────────────────
    { codigo: '101140100', descricao: 'Construcao civil — Reforma', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101140200', descricao: 'Construcao civil — Empreitada total', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101140300', descricao: 'Pintura predial', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101140400', descricao: 'Hidraulica e instalacoes', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101140500', descricao: 'Eletrica e instalacoes', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101140600', descricao: 'Marcenaria e serralheria sob encomenda', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },

    // ─── 15. Eventos e producao (LC 116 item 12) ────────────────────────
    { codigo: '101150100', descricao: 'Organizacao de eventos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101150200', descricao: 'Locacao de equipamentos para eventos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101150300', descricao: 'Servicos de fotografia e filmagem', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101150400', descricao: 'Producao de espetaculos artisticos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101150500', descricao: 'Servicos de DJ e som', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 16. Locacao de bens moveis (LC 116 item 3) ─────────────────────
    { codigo: '101160100', descricao: 'Locacao de veiculos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101160200', descricao: 'Locacao de maquinas e equipamentos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101160300', descricao: 'Locacao de roupas e fantasias', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101160400', descricao: 'Locacao de espacos para eventos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 17. Servicos financeiros e administrativos ─────────────────────
    { codigo: '101170100', descricao: 'Cobranca em geral', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101170200', descricao: 'Servicos de factoring (fomento mercantil)', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101170300', descricao: 'Administracao de imoveis e condominios', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101170400', descricao: 'Despachante administrativo', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101170500', descricao: 'Servicos de RH — Recrutamento e selecao', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 18. Imprensa e editorial (LC 116 item 13) ──────────────────────
    { codigo: '101180100', descricao: 'Edicao e producao editorial', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101180200', descricao: 'Servicos de impressao grafica', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101180300', descricao: 'Encadernacao e acabamento grafico', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 19. Esporte e lazer ────────────────────────────────────────────
    { codigo: '101190100', descricao: 'Academias e personal trainer', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101190200', descricao: 'Escolinhas esportivas', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101190300', descricao: 'Locacao de quadras e campos', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },

    // ─── 20. Outros servicos ────────────────────────────────────────────
    { codigo: '101900100', descricao: 'Outros servicos profissionais', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
    { codigo: '101900200', descricao: 'Outros servicos pessoais', cIndOpSugerido: '050101', cClassTribSugerido: '00000000' },
    { codigo: '101900300', descricao: 'Servicos diversos nao classificados', cIndOpSugerido: '050201', cClassTribSugerido: '00000000' },
];
