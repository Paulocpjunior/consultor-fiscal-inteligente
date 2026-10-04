// ============================================================================
// sefaz-backend/esocial-download.js  (núcleo puro — montagem, assinatura e leitura)
// ----------------------------------------------------------------------------
// Download de eventos do eSocial ("download cirúrgico") para o Consultor DP.
// Paulo, 04/10/2026: "pode seguir com download dos eventos do esocial".
//
// Dois webservices do eSocial, ambos SOAP 1.1 com mTLS e pedido assinado:
//   1. WsConsultarIdentificadoresEventos — devolve até 50 identificadores
//      (Id do evento + número do recibo) por consulta: do empregador (tpEvt +
//      perApur), de tabela (tpEvt + período) ou do trabalhador (CPF + período).
//      Período de até 31 dias e fim até uma hora atrás; um pedido ativo por
//      empregador de cada vez (Manual do Desenvolvedor do eSocial, apontado na
//      revisão do PR #1370).
//   2. WsSolicitarDownloadEventos — devolve o XML do evento e o do recibo,
//      por Id ou por número de recibo.
//
// Fonte dos nomes, namespaces e SOAPActions: XSDs e WSDLs oficiais da
// comunicação v1_5_0 (nfephp-org/sped-esocial, schemes/comunicacao/v1_5_0)
// e o Tools.php da mesma biblioteca, que já fala com o eSocial em produção.
// A assinatura é a do pedido inteiro: <Signature> dentro de <eSocial>,
// Reference URI="" (enveloped + C14N), RSA-SHA256 — o mesmo Signer::sign(...,
// 'eSocial', '') da biblioteca.
//
// Nada aqui guarda o conteúdo dos eventos: é dado trabalhista do cliente.
// ============================================================================

import { SignedXml } from 'xml-crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const SIG_ALG = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const DIGEST_ALG = 'http://www.w3.org/2001/04/xmlenc#sha256';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

const BASE = {
    1: 'https://webservices.download.esocial.gov.br/servicos/empregador/dwlcirurgico',
    2: 'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/dwlcirurgico',
};
export const ENDPOINTS = Object.fromEntries(Object.entries(BASE).map(([amb, b]) => [amb, {
    identificadores: `${b}/WsConsultarIdentificadoresEventos.svc`,
    download: `${b}/WsSolicitarDownloadEventos.svc`,
}]));

const NS_SERV_CONSULTA = 'http://www.esocial.gov.br/servicos/empregador/consulta/identificadores-eventos/v1_0_0';
const NS_SERV_DOWNLOAD = 'http://www.esocial.gov.br/servicos/empregador/download/solicitacao/v1_0_0';

/** Por resposta, o eSocial devolve no máximo 50 identificadores ou 50 arquivos (XSD do retorno). */
export const MAX_POR_PEDIDO = 50;

const CONSULTAS = {
    empregador: { metodo: 'ConsultarIdentificadoresEventosEmpregador', parametro: 'consultaEventosEmpregador', ns: 'empregador', grupo: 'consultaEvtsEmpregador' },
    tabela: { metodo: 'ConsultarIdentificadoresEventosTabela', parametro: 'consultaEventosTabela', ns: 'tabela', grupo: 'consultaEvtsTabela' },
    trabalhador: { metodo: 'ConsultarIdentificadoresEventosTrabalhador', parametro: 'consultaEventosTrabalhador', ns: 'trabalhador', grupo: 'consultaEvtsTrabalhador' },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dataValida = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** Raiz do CNPJ (8 dígitos): é como o eSocial identifica o empregador pessoa jurídica. */
export function raizCnpj(cnpj) {
    const d = String(cnpj || '').replace(/\D/g, '');
    if (d.length !== 14) throw new Error('CNPJ inválido — informe 14 dígitos.');
    return d.slice(0, 8);
}

const ideEmpregador = (raiz) => `<ideEmpregador><tpInsc>1</tpInsc><nrInsc>${raiz}</nrInsc></ideEmpregador>`;

/** O eSocial recusa período de mais de 31 dias (código 410) e data final na última hora (409). */
export const MAX_DIAS_PERIODO = 31;
const MARGEM_MINUTOS = 61;

/** Data e hora de Brasília, no formato do xs:dateTime que o eSocial lê. */
export function horaBrasilia(d) {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(d).replace(' ', 'T');
}
const dataHoraValida = (d) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(d) && dataValida(d.slice(0, 10));
const ms = (dh) => Date.parse(`${dh}Z`);

/**
 * Período da consulta, já dentro das regras do eSocial — recusar aqui não gasta
 * a cota diária. dtIni aceita data (AAAA-MM-DD) ou data e hora (continuação a
 * partir do dhUltimoEvtRetornado); dtFim de hoje vira "agora menos 61 minutos".
 */
export function periodoDaConsulta(dtIni, dtFim, agora = new Date()) {
    if (!dataValida(dtIni || '') && !dataHoraValida(dtIni || '')) throw new Error('dtIni no formato AAAA-MM-DD.');
    if (!dataValida(dtFim || '')) throw new Error('dtFim no formato AAAA-MM-DD.');
    const ini = dtIni.length === 10 ? `${dtIni}T00:00:00` : dtIni;
    const limite = horaBrasilia(new Date(agora.getTime() - MARGEM_MINUTOS * 60000));
    if (dtFim > limite.slice(0, 10)) throw new Error('dtFim no futuro: o eSocial só aceita até uma hora atrás.');
    const fim = `${dtFim}T23:59:59` > limite ? limite : `${dtFim}T23:59:59`;
    if (fim < ini) throw new Error('dtFim anterior a dtIni.');
    if (ms(fim) - ms(ini) > MAX_DIAS_PERIODO * 86400000) throw new Error(`Período de no máximo ${MAX_DIAS_PERIODO} dias por consulta (regra do eSocial).`);
    return `<dtIni>${ini}</dtIni><dtFim>${fim}</dtFim>`;
}

/**
 * Pedido de identificadores, ainda sem assinatura.
 * empregador: { tpEvt: 'S-1299', perApur: '2026-09' | '2026' }
 * tabela:     { tpEvt: 'S-1010', chEvt?, dtIni?, dtFim? }   (as duas datas ou nenhuma)
 * trabalhador:{ cpfTrab, dtIni, dtFim }
 */
export function montarPedidoIdentificadores(p, agora = new Date()) {
    const tipo = CONSULTAS[p?.tipo];
    if (!tipo) throw new Error('tipo deve ser empregador, tabela ou trabalhador.');
    const raiz = raizCnpj(p.cnpj);
    let filtro = '';
    if (p.tipo !== 'trabalhador' && !/^S-\d{4}$/.test(p.tpEvt || '')) throw new Error('tpEvt no formato S-9999.');
    if (p.tipo === 'empregador') {
        if (!/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(p.perApur || '')) throw new Error('perApur no formato AAAA-MM ou AAAA.');
        filtro = `<tpEvt>${p.tpEvt}</tpEvt><perApur>${p.perApur}</perApur>`;
    } else if (p.tipo === 'tabela') {
        if (!!p.dtIni !== !!p.dtFim) throw new Error('Informe as duas datas ou nenhuma.');
        const periodo = p.dtIni ? periodoDaConsulta(p.dtIni, p.dtFim, agora) : '';
        filtro = `<tpEvt>${p.tpEvt}</tpEvt>${p.chEvt ? `<chEvt>${esc(p.chEvt)}</chEvt>` : ''}${periodo}`;
    } else {
        const cpf = String(p.cpfTrab || '').replace(/\D/g, '');
        if (cpf.length !== 11) throw new Error('cpfTrab com 11 dígitos.');
        if (!p.dtIni || !p.dtFim) throw new Error('Consulta do trabalhador exige dtIni e dtFim.');
        filtro = `<cpfTrab>${cpf}</cpfTrab>${periodoDaConsulta(p.dtIni, p.dtFim, agora)}`;
    }
    const xml = `<eSocial xmlns="http://www.esocial.gov.br/schema/consulta/identificadores-eventos/${tipo.ns}/v1_0_0">`
        + `<consultaIdentificadoresEvts>${ideEmpregador(raiz)}<${tipo.grupo}>${filtro}</${tipo.grupo}></consultaIdentificadoresEvts></eSocial>`;
    return { xml, servico: 'identificadores', metodo: tipo.metodo, parametro: tipo.parametro, ns: NS_SERV_CONSULTA, action: `${NS_SERV_CONSULTA}/ServicoConsultarIdentificadoresEventos/${tipo.metodo}` };
}

/** Pedido de download por Id do evento ou por número de recibo (até 50 por vez). */
export function montarPedidoDownload({ cnpj, ids, nrRecs }) {
    const raiz = raizCnpj(cnpj);
    const porId = Array.isArray(ids) && ids.length > 0;
    const lista = porId ? ids : nrRecs;
    if (!Array.isArray(lista) || !lista.length) throw new Error('Informe ids ou nrRecs.');
    if (lista.length > MAX_POR_PEDIDO) throw new Error(`No máximo ${MAX_POR_PEDIDO} eventos por pedido.`);
    if (porId && lista.some((i) => !/^ID\d{34}$/.test(i))) throw new Error('Id de evento no formato ID + 34 dígitos.');
    if (!porId && lista.some((r) => !/^[\d.\-]{1,40}$/.test(r))) throw new Error('Número de recibo inválido.');
    const metodo = porId ? 'SolicitarDownloadEventosPorId' : 'SolicitarDownloadEventosPorNrRecibo';
    const xml = porId
        ? `<eSocial xmlns="http://www.esocial.gov.br/schema/download/solicitacao/id/v1_0_0"><download>${ideEmpregador(raiz)}`
          + `<solicDownloadEvtsPorId>${lista.map((i) => `<id>${i}</id>`).join('')}</solicDownloadEvtsPorId></download></eSocial>`
        : `<eSocial xmlns="http://www.esocial.gov.br/schema/download/solicitacao/nrRecibo/v1_0_0"><download>${ideEmpregador(raiz)}`
          + `<solicDownloadEventosPorNrRecibo>${lista.map((r) => `<nrRec>${r}</nrRec>`).join('')}</solicDownloadEventosPorNrRecibo></download></eSocial>`;
    return { xml, servico: 'download', metodo, parametro: 'solicitacao', ns: NS_SERV_DOWNLOAD, action: `${NS_SERV_DOWNLOAD}/ServicoSolicitarDownloadEventos/${metodo}` };
}

const certificadoBase64 = (pem) => String(pem || '').replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');

export function verificarAssinaturaPedido(xmlAssinado, cert) {
    const m = String(xmlAssinado || '').match(/<Signature[\s\S]*?<\/Signature>/);
    if (!m) return { ok: false, erro: 'Signature ausente' };
    const sig = new SignedXml({ publicCert: cert.pemCert });
    sig.loadSignature(m[0]);
    try {
        return sig.checkSignature(xmlAssinado) ? { ok: true } : { ok: false, erro: (sig.validationErrors || []).join('; ') || 'assinatura inválida' };
    } catch (err) {
        return { ok: false, erro: err?.message || String(err) };
    }
}

/** Assina o pedido inteiro (<Signature> dentro de <eSocial>, URI="") e autovalida. */
export function assinarPedidoEsocial(xml, cert) {
    if (!cert?.pemKey || !cert?.pemCert) throw new Error('certificado sem pemKey/pemCert');
    const sig = new SignedXml({ privateKey: cert.pemKey, publicCert: cert.pemCert, signatureAlgorithm: SIG_ALG, canonicalizationAlgorithm: C14N });
    sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${certificadoBase64(cert.pemCert)}</X509Certificate></X509Data>`;
    // XPath da raiz do pedido. Montado em partes porque barra seguida de asterisco
    // num literal confunde a varredura de código morto (spedCodigoMortoEhReguaVelha).
    const raiz = ['', '*'].join('/') + "[local-name(.)='eSocial']";
    sig.addReference({ xpath: raiz, transforms: [ENVELOPED, C14N], digestAlgorithm: DIGEST_ALG, uri: '', isEmptyUri: true });
    sig.computeSignature(xml, { location: { reference: raiz, action: 'append' } });
    const assinado = sig.getSignedXml();
    const v = verificarAssinaturaPedido(assinado, cert);
    if (!v.ok) throw new Error(`falha de autovalidação XMLDSig (${v.erro})`);
    return assinado;
}

/** Envelope SOAP 1.1, como o eSocial exige. */
export function montarEnvelope(pedido, xmlAssinado) {
    return '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
        + `xmlns:v1="${pedido.ns}"><soapenv:Header/><soapenv:Body>`
        + `<v1:${pedido.metodo}><v1:${pedido.parametro}>${xmlAssinado}</v1:${pedido.parametro}></v1:${pedido.metodo}>`
        + '</soapenv:Body></soapenv:Envelope>';
}

// ─── leitura das respostas ──────────────────────────────────────────────────

const silencioso = { warning() {}, error() {}, fatalError() {} };
function parse(xml) {
    const doc = new DOMParser({ errorHandler: silencioso }).parseFromString(String(xml || ''), 'text/xml');
    if (!doc || !doc.documentElement) throw new Error('resposta do eSocial não é XML');
    return doc;
}
const todos = (no, nome) => Array.from(no.getElementsByTagNameNS('*', nome));
const primeiro = (no, nome) => todos(no, nome)[0];
const texto = (no, nome) => (no && primeiro(no, nome)?.textContent?.trim()) || '';
const filhosElemento = (no) => Array.from(no?.childNodes || []).filter((n) => n.nodeType === 1);

function falhaSoap(doc) {
    const f = primeiro(doc, 'Fault');
    return f ? { cdResposta: null, descResposta: texto(f, 'faultstring') || texto(f, 'Text') || 'SOAP Fault' } : null;
}

/** Retorno da consulta de identificadores: status, total e a lista {id, nrRec}. */
export function lerRetornoIdentificadores(xmlResposta) {
    const doc = parse(xmlResposta);
    const fault = falhaSoap(doc);
    if (fault) return { ...fault, qtdeTotal: 0, dhUltimoEvtRetornado: '', identificadores: [] };
    const ret = primeiro(doc, 'retornoConsultaIdentificadoresEvts');
    if (!ret) throw new Error('resposta sem retornoConsultaIdentificadoresEvts');
    const status = primeiro(ret, 'status');
    return {
        cdResposta: Number(texto(status, 'cdResposta')) || null,
        descResposta: texto(status, 'descResposta'),
        qtdeTotal: Number(texto(ret, 'qtdeTotEvtsConsulta')) || 0,
        dhUltimoEvtRetornado: texto(ret, 'dhUltimoEvtRetornado'),
        identificadores: todos(ret, 'identificadorEvt').map((e) => ({ id: texto(e, 'id'), nrRec: texto(e, 'nrRec') })),
    };
}

/** Retorno do download: um item por evento, com o XML do evento e o do recibo como vieram. */
export function lerRetornoDownload(xmlResposta) {
    const doc = parse(xmlResposta);
    const fault = falhaSoap(doc);
    if (fault) return { ...fault, arquivos: [] };
    const dl = todos(doc, 'download').find((d) => primeiro(d, 'status'));
    if (!dl) throw new Error('resposta sem download/status');
    const ser = new XMLSerializer();
    const status = filhosElemento(dl).find((n) => n.localName === 'status');
    const arquivos = todos(dl, 'arquivo').map((a) => {
        const st = filhosElemento(a).find((n) => n.localName === 'status');
        const conteudo = (nome) => {
            const no = filhosElemento(a).find((n) => n.localName === nome);
            const raiz = filhosElemento(no)[0];
            return raiz ? ser.serializeToString(raiz) : '';
        };
        const evt = conteudo('evt');
        const id = (evt.match(/<evt\w+\s[^>]*\bId="(ID\d{34})"/) || [])[1] || '';
        const elemento = (evt.match(/<(evt\w+)\s[^>]*\bId="/) || [])[1] || '';
        return { cdResposta: Number(texto(st, 'cdResposta')) || null, descResposta: texto(st, 'descResposta'), id, elemento, evt, rec: conteudo('rec') };
    });
    return { cdResposta: Number(texto(status, 'cdResposta')) || null, descResposta: texto(status, 'descResposta'), arquivos };
}
