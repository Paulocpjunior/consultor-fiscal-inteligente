// ============================================================================
// sefaz-backend/esocial-envio.js  (núcleo puro — conferência, lote e leitura)
// ----------------------------------------------------------------------------
// Transmissão de eventos do eSocial para o Consultor DP pelo cofre do CFI.
// Paulo, 05/10/2026: "pode seguir com a transmissão do esocial pelo cofre".
//
// Dois webservices do eSocial, SOAP 1.1 com mTLS:
//   1. WsEnviarLoteEventos — recebe o lote (até 50 eventos do MESMO grupo)
//      e devolve o protocolo. Só os EVENTOS vão assinados; o lote não.
//   2. WsConsultarLoteEventos — pelo protocolo, devolve o resultado de cada
//      evento: recibo (nrRecibo) ou as ocorrências que o recusaram.
//
// Fonte dos namespaces, SOAPActions, grupos e endereços: XSDs e WSDLs da
// comunicação v1_5_0 e o Tools.php de nfephp-org/sped-esocial (a mesma
// fonte do download de eventos): EnvioLoteEventos v1_1_1, WsEnviarLoteEventos
// v1_1_0, ConsultaLoteEventos v1_0_0, WsConsultarLoteEventos v1_1_0,
// RetornoEnvioLoteEventos v1_1_0 e RetornoProcessamentoLote v1_3_0.
//
// A assinatura do evento é a mesma do pedido de download: <Signature> dentro
// de <eSocial>, Reference URI="", enveloped + C14N, RSA-SHA256.
// Nada aqui guarda o conteúdo dos eventos: é dado trabalhista do cliente.
// ============================================================================

import { DOMParser } from '@xmldom/xmldom';
import { raizCnpj } from './esocial-download.js';

export const MAX_EVENTOS_LOTE = 50;
/** Limite de tamanho de um evento recebido do DP (o maior evento real fica bem abaixo). */
export const MAX_BYTES_EVENTO = 300 * 1024;

export const ENDPOINTS_ENVIO = {
    1: {
        envio: 'https://webservices.envio.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc',
        consulta: 'https://webservices.consulta.esocial.gov.br/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc',
    },
    2: {
        envio: 'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc',
        consulta: 'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc',
    },
};

const NS_WS_ENVIO = 'http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/v1_1_0';
const NS_WS_CONSULTA = 'http://www.esocial.gov.br/servicos/empregador/lote/eventos/envio/consulta/retornoProcessamento/v1_1_0';
const NS_LOTE = 'http://www.esocial.gov.br/schema/lote/eventos/envio/v1_1_1';
const NS_CONSULTA = 'http://www.esocial.gov.br/schema/lote/eventos/envio/consulta/retornoProcessamento/v1_0_0';
export const ACTION_ENVIO = `${NS_WS_ENVIO}/ServicoEnviarLoteEventos/EnviarLoteEventos`;
export const ACTION_CONSULTA = `${NS_WS_CONSULTA}/ServicoConsultarLoteEventos/ConsultarLoteEventos`;

/** Elemento do evento → código. Totalizadores (S-5xxx) são devolvidos pelo eSocial, nunca enviados. */
export const TIPO_POR_ELEMENTO = {
    evtInfoEmpregador: 'S-1000', evtTabEstab: 'S-1005', evtTabRubrica: 'S-1010', evtTabLotacao: 'S-1020', evtTabProcesso: 'S-1070',
    evtRemun: 'S-1200', evtRmnRPPS: 'S-1202', evtBenPrRP: 'S-1207', evtPgtos: 'S-1210', evtAqProd: 'S-1250', evtComProd: 'S-1260',
    evtContratAvNP: 'S-1270', evtInfoComplPer: 'S-1280', evtReabreEvPer: 'S-1298', evtFechaEvPer: 'S-1299',
    evtAdmPrelim: 'S-2190', evtAdmissao: 'S-2200', evtAltCadastral: 'S-2205', evtAltContratual: 'S-2206', evtCAT: 'S-2210',
    evtMonit: 'S-2220', evtToxic: 'S-2221', evtAfastTemp: 'S-2230', evtCessao: 'S-2231', evtExpRisco: 'S-2240', evtReintegr: 'S-2298',
    evtDeslig: 'S-2299', evtTSVInicio: 'S-2300', evtTSVAltContr: 'S-2306', evtTSVTermino: 'S-2399', evtCdBenefIn: 'S-2400',
    evtCdBenefAlt: 'S-2405', evtCdBenIn: 'S-2410', evtCdBenAlt: 'S-2416', evtReativBen: 'S-2418', evtCdBenTerm: 'S-2420',
    evtProcTrab: 'S-2500', evtContProc: 'S-2501', evtConsolidContProc: 'S-2555', evtExclusao: 'S-3000', evtExcProcTrab: 'S-3500',
};

/** Grupo do lote: 1 = tabelas (iniciais), 2 = não periódicos, 3 = periódicos. */
export function grupoDoTipo(tipo) {
    const n = Number(String(tipo).slice(2));
    if (n >= 1000 && n < 1200) return 1;
    if (n >= 1200 && n < 2000) return 3;
    if (n >= 2000 && n < 5000) return 2;
    return null;
}
export const ROTULO_GRUPO = { 1: 'tabelas', 2: 'não periódicos', 3: 'periódicos' };

const silencioso = { warning() {}, error() {}, fatalError() {} };
function parse(xml, oque) {
    const doc = new DOMParser({ errorHandler: silencioso }).parseFromString(String(xml || ''), 'text/xml');
    if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length) throw new Error(`${oque} não é XML válido`);
    return doc;
}
const todos = (no, nome) => Array.from(no?.getElementsByTagNameNS('*', nome) || []);
const primeiro = (no, nome) => todos(no, nome)[0];
const texto = (no, nome) => (no && primeiro(no, nome)?.textContent?.trim()) || '';
const filhos = (no) => Array.from(no?.childNodes || []).filter((n) => n.nodeType === 1);
const filho = (no, nome) => filhos(no).find((n) => n.localName === nome);

const semDeclaracao = (xml) => String(xml).replace(/^﻿/, '').replace(/^\s*<\?xml[^>]*\?>\s*/, '').trim();
/** Tira a assinatura que o evento já trouxer (ex.: gerado e assinado por outro sistema): o CFI assina de novo. */
export const semAssinatura = (xml) => String(xml).replace(/<(\w+:)?Signature\b[\s\S]*?<\/(\w+:)?Signature>/g, '');

/**
 * Confere um evento antes de assinar: raiz <eSocial>, elemento do evento
 * conhecido, Id no formato do eSocial, empregador = a empresa pedida e o
 * ambiente igual ao do envio. Devolve o XML pronto para assinar.
 */
export function analisarEvento(xml, { cnpj, tpAmb }) {
    if (typeof xml !== 'string' || !xml.trim()) throw new Error('evento vazio');
    if (Buffer.byteLength(xml) > MAX_BYTES_EVENTO) throw new Error(`evento maior que ${MAX_BYTES_EVENTO / 1024} KB`);
    const limpo = semAssinatura(semDeclaracao(xml));
    const doc = parse(limpo, 'o evento');
    const raiz = doc.documentElement;
    if (raiz.localName !== 'eSocial') throw new Error('a raiz do evento deve ser <eSocial>');
    const evt = filhos(raiz)[0];
    const tipo = evt && TIPO_POR_ELEMENTO[evt.localName];
    if (!tipo) throw new Error(`elemento <${evt?.localName || '?'}> não é um evento que se transmite`);
    const id = evt.getAttribute('Id') || '';
    if (!/^ID[12]\d{33}$/.test(id)) throw new Error(`${tipo}: Id "${id}" fora do formato ID + 34 dígitos`);
    const ide = filho(evt, 'ideEmpregador');
    const nrInsc = texto(ide, 'nrInsc');
    const r = raizCnpj(cnpj);
    if (texto(ide, 'tpInsc') !== '1' || (nrInsc !== r && nrInsc !== String(cnpj))) {
        throw new Error(`${tipo}: o empregador do evento (${nrInsc || 'sem nrInsc'}) não é a empresa ${cnpj}`);
    }
    const amb = texto(filho(evt, 'ideEvento'), 'tpAmb');
    if (amb !== String(tpAmb)) {
        throw new Error(`${tipo}: o evento é de ${amb === '1' ? 'produção' : amb === '2' ? 'produção restrita' : `tpAmb ${amb || 'ausente'}`}, e o envio é de ${tpAmb === 1 ? 'produção' : 'produção restrita'}`);
    }
    return { id, tipo, grupo: grupoDoTipo(tipo), elemento: evt.localName, perApur: texto(filho(evt, 'ideEvento'), 'perApur'), xml: limpo };
}

/** Confere a lista inteira: 1 a 50 eventos, todos do mesmo grupo e sem Id repetido. */
export function analisarLote(eventos, { cnpj, tpAmb }) {
    if (!Array.isArray(eventos) || !eventos.length) throw new Error('Informe ao menos um evento.');
    if (eventos.length > MAX_EVENTOS_LOTE) throw new Error(`No máximo ${MAX_EVENTOS_LOTE} eventos por lote.`);
    const lidos = eventos.map((x, i) => {
        try { return analisarEvento(x, { cnpj, tpAmb }); } catch (err) { throw new Error(`Evento ${i + 1}: ${err.message}`); }
    });
    const grupos = [...new Set(lidos.map((e) => e.grupo))];
    if (grupos.length > 1) throw new Error(`Um lote leva eventos de um grupo só; vieram ${grupos.map((g) => ROTULO_GRUPO[g]).join(' e ')}.`);
    const ids = lidos.map((e) => e.id);
    const repetido = ids.find((id, i) => ids.indexOf(id) !== i);
    if (repetido) throw new Error(`Id repetido no lote: ${repetido}`);
    return { grupo: grupos[0], eventos: lidos };
}

/** Lote de envio (não assinado), com os eventos já assinados. */
export function montarLoteEnvio({ cnpj, cnpjTransmissor, grupo, eventos }) {
    const transmissor = String(cnpjTransmissor || '').replace(/\D/g, '');
    if (transmissor.length !== 14) throw new Error('CNPJ do transmissor inválido.');
    if (![1, 2, 3].includes(grupo)) throw new Error('grupo deve ser 1, 2 ou 3.');
    return `<eSocial xmlns="${NS_LOTE}"><envioLoteEventos grupo="${grupo}">`
        + `<ideEmpregador><tpInsc>1</tpInsc><nrInsc>${raizCnpj(cnpj)}</nrInsc></ideEmpregador>`
        + `<ideTransmissor><tpInsc>1</tpInsc><nrInsc>${transmissor}</nrInsc></ideTransmissor>`
        + `<eventos>${eventos.map((e) => `<evento Id="${e.id}">${semDeclaracao(e.xml)}</evento>`).join('')}</eventos>`
        + '</envioLoteEventos></eSocial>';
}

export const envelopeEnvio = (lote) => '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
    + `xmlns:v1="${NS_WS_ENVIO}"><soapenv:Header/><soapenv:Body>`
    + `<v1:EnviarLoteEventos><v1:loteEventos>${lote}</v1:loteEventos></v1:EnviarLoteEventos></soapenv:Body></soapenv:Envelope>`;

export function validarProtocolo(protocolo) {
    const p = String(protocolo || '').trim();
    if (!/^\d[\d.]{8,48}\d$/.test(p)) throw new Error('Protocolo de envio inválido.');
    return p;
}

export const envelopeConsulta = (protocolo) => '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
    + `xmlns:v1="${NS_WS_CONSULTA}"><soapenv:Header/><soapenv:Body><v1:ConsultarLoteEventos><v1:consulta>`
    + `<eSocial xmlns="${NS_CONSULTA}"><consultaLoteEventos><protocoloEnvio>${validarProtocolo(protocolo)}</protocoloEnvio></consultaLoteEventos></eSocial>`
    + '</v1:consulta></v1:ConsultarLoteEventos></soapenv:Body></soapenv:Envelope>';

// ─── leitura das respostas ──────────────────────────────────────────────────

const ocorrencias = (no) => todos(no, 'ocorrencia').map((o) => ({
    tipo: Number(texto(o, 'tipo')) || null, codigo: texto(o, 'codigo'), descricao: texto(o, 'descricao'), localizacao: texto(o, 'localizacao'),
}));

function falhaSoap(doc) {
    const f = primeiro(doc, 'Fault');
    return f ? { cdResposta: null, descResposta: texto(f, 'faultstring') || texto(f, 'Text') || 'SOAP Fault', ocorrencias: [] } : null;
}

/** Status de um nó <status>: código, descrição e ocorrências SÓ dele. */
function lerStatus(st) {
    return { cdResposta: Number(texto(st, 'cdResposta')) || null, descResposta: texto(st, 'descResposta'), ocorrencias: ocorrencias(st) };
}

/** Retorno do envio: 201 = lote recebido, com o protocolo para a consulta. */
export function lerRetornoEnvio(xmlResposta) {
    const doc = parse(xmlResposta, 'a resposta do eSocial');
    const fault = falhaSoap(doc);
    if (fault) return { ...fault, protocolo: '', dhRecepcao: '' };
    const ret = primeiro(doc, 'retornoEnvioLoteEventos');
    if (!ret) throw new Error('resposta sem retornoEnvioLoteEventos');
    const rec = filho(ret, 'dadosRecepcaoLote');
    return { ...lerStatus(filho(ret, 'status')), protocolo: texto(rec, 'protocoloEnvio'), dhRecepcao: texto(rec, 'dhRecepcao') };
}

/**
 * Retorno da consulta do lote. Lote: 101 = aguardando processamento;
 * 201/202 = processado. Evento: 201/202 = aceito (recibo); outros = recusado.
 * Os totalizadores (S-5001, S-5011…) só são contados: o conteúdo traz dados
 * de trabalhadores e o DP baixa pelo download quando precisar.
 */
export function lerRetornoProcessamento(xmlResposta) {
    const doc = parse(xmlResposta, 'a resposta do eSocial');
    const fault = falhaSoap(doc);
    if (fault) return { ...fault, protocolo: '', tempoEstimadoConclusao: null, eventos: [] };
    const ret = primeiro(doc, 'retornoProcessamentoLoteEventos');
    if (!ret) throw new Error('resposta sem retornoProcessamentoLoteEventos');
    const st = filho(ret, 'status');
    const eventos = todos(filho(ret, 'retornoEventos'), 'evento').filter((e) => e.getAttribute('Id')).map((e) => {
        const proc = primeiro(e, 'processamento');
        return {
            id: e.getAttribute('Id'),
            ...lerStatus(proc),
            nrRecibo: texto(primeiro(e, 'recibo'), 'nrRecibo'),
            totalizadores: filhos(e).filter((n) => n.localName === 'tot').map((n) => n.getAttribute('tipo')).filter(Boolean),
        };
    });
    return {
        ...lerStatus(st),
        tempoEstimadoConclusao: Number(texto(st, 'tempoEstimadoConclusao')) || null,
        protocolo: texto(filho(ret, 'dadosRecepcaoLote'), 'protocoloEnvio'),
        eventos,
    };
}

/** Situação do lote para o DP. */
export function situacaoDoLote(cdResposta) {
    if (cdResposta === 101) return 'em-processamento';
    if (cdResposta === 201 || cdResposta === 202) return 'processado';
    return 'recusado';
}
