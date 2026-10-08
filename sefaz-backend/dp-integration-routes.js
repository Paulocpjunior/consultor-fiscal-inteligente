// ============================================================================
// sefaz-backend/dp-integration-routes.js
// Endpoints consumidos pelo projeto Consultor-DP-Folhapagamentos.
// Montados em /api/dp-integration/ pelo server.js raiz.
//
// Provê acesso a dados reais SERPRO (FGTS, eSocial, DCTFWeb, CRF FGTS) que o
// projeto de DP/Folha consome via cross-origin para evitar duplicar a
// integração mTLS + OAuth2 do Integra Contador em outro deploy.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireCrossProjectAuth } from './require-cross-project-auth.js';
import {
    consultarFgtsDigital,
    consultarESocial,
    consultarDctfWeb,
    consultarCrfFgtsSerpro,
} from './nfp-compliance-provider.js';
import { consultarCndsPublicas } from './cnd-publica-provider.js';
import { getDctfwebProvider } from './dctfweb-provider.js';
import { montarRespostaDebitosDctfweb } from './dp-dctfweb-debitos.js';
import { montarPedidoIdentificadores, montarPedidoDownload, lerRetornoIdentificadores, lerRetornoDownload } from './esocial-download.js';
import { carregarCertificado, executarPedido, auditarPedido, serializarPorEmpregador, postSoap, CNPJ_ESCRITORIO } from './esocial-download-client.js';
import { assinarPedidoEsocial } from './esocial-download.js';
import {
    analisarLote, montarLoteEnvio, envelopeEnvio, envelopeConsulta, lerRetornoEnvio, lerRetornoProcessamento,
    situacaoDoLote, validarProtocolo, ENDPOINTS_ENVIO, ACTION_ENVIO, ACTION_CONSULTA,
} from './esocial-envio.js';
import { confirmarEmpresaDaCarteiraDp, AcessoNegado } from './dp-acesso-empresa.js';
import { crossProjectAuth, PROJETO } from './require-cross-project-auth.js';
import { validarPdf, montarPromptHolerites, lerRespostaHolerites, SCHEMA_HOLERITES } from './holerite-extracao.js';
import { instrucaoMia, validarConversa, montarConteudo, lerResposta } from './dp-assistente-mia.js';
import { validarPedidoEmailDp, montarEmailPacoteDp } from './dp-email-pacote.js';
import { enviarEmail } from './graph-provider.js';
import { escolherRemetente, dominiosPermitidos, ehErroDeCaixaInexistente } from './graph-remetente.js';
import { anexoLogo } from './email-layout.js';
import { parseDestinatarios } from './email-destinatarios-helper.js';

const router = express.Router();
router.use(express.json());

// ─── Validação ──────────────────────────────────────────────────────────────

function validarCnpj(req, res) {
    const cnpj = (req.body?.cnpj || req.query?.cnpj || '').replace(/\D/g, '');
    if (!cnpj || cnpj.length !== 14) {
        res.status(400).json({ error: 'CNPJ inválido — informe 14 dígitos.' });
        return null;
    }
    return cnpj;
}

// ─── Rotas ──────────────────────────────────────────────────────────────────

// FGTS - Consulta recolhimento por competência
// POST /api/dp-integration/fgts/recolhimento
// Body: { cnpj, competencia: 'YYYY-MM' }
router.post('/fgts/recolhimento', requireCrossProjectAuth, async (req, res) => {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    const competencia = req.body.competencia;
    if (!competencia || !/^\d{4}-\d{2}$/.test(competencia)) {
        return res.status(400).json({ error: 'competencia obrigatória no formato YYYY-MM' });
    }
    try {
        const result = await consultarFgtsDigital(cnpj, competencia);
        return res.json(result);
    } catch (err) {
        console.error('[dp-integration/fgts/recolhimento]', err);
        return res.status(500).json({ error: err.message });
    }
});

// FGTS - Consulta CRF (Certificado de Regularidade)
// Tenta SERPRO primeiro; se falhar, cai no fallback de consulta pública (Caixa).
// POST /api/dp-integration/fgts/crf
// Body: { cnpj }
router.post('/fgts/crf', requireCrossProjectAuth, async (req, res) => {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    let result;
    try {
        result = await consultarCrfFgtsSerpro(cnpj);
    } catch {
        result = { ok: false, status: 'indisponivel' };
    }
    // Se SERPRO falhou ou indisponivel, tenta consulta pública
    if (!result?.ok || result?.status === 'indisponivel' || result?.status === 'nao_consultada') {
        try {
            const publicas = await consultarCndsPublicas(cnpj);
            const crfPub = (publicas?.certidoes || []).find(c => c.tipo?.includes('CRF') || c.esfera === 'fgts');
            if (crfPub && crfPub.status !== 'indisponivel') {
                return res.json({ ...crfPub, fonte: 'consulta_publica' });
            }
        } catch (err) {
            console.warn('[dp-integration/fgts/crf] fallback publico falhou:', err.message);
        }
    }
    return res.json(result || { ok: false, status: 'indisponivel' });
});

// eSocial - Status de fechamento mensal
// POST /api/dp-integration/esocial/status
// Body: { cnpj, competencia: 'YYYY-MM' }
router.post('/esocial/status', requireCrossProjectAuth, async (req, res) => {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    const competencia = req.body.competencia;
    if (!competencia) return res.status(400).json({ error: 'competencia obrigatória' });
    try {
        const result = await consultarESocial(cnpj, competencia);
        return res.json(result);
    } catch (err) {
        console.error('[dp-integration/esocial/status]', err);
        return res.status(500).json({ error: err.message });
    }
});

// DCTFWeb - Status de transmissão
// POST /api/dp-integration/dctfweb/status
// Body: { cnpj, competencia: 'YYYY-MM' }
router.post('/dctfweb/status', requireCrossProjectAuth, async (req, res) => {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    const competencia = req.body.competencia;
    if (!competencia) return res.status(400).json({ error: 'competencia obrigatória' });
    try {
        const result = await consultarDctfWeb(cnpj, competencia);
        return res.json(result);
    } catch (err) {
        console.error('[dp-integration/dctfweb/status]', err);
        return res.status(500).json({ error: err.message });
    }
});

// DCTFWeb - Débitos com saldo a pagar, por código de receita
// POST /api/dp-integration/dctfweb/debitos
// Body: { cnpj, competencia: 'YYYY-MM' }
//
// Usado pela conferência pós-folha do Consultor DP para comparar a DCTFWeb
// com o S-5011 do eSocial. Reaproveita o que a emissão de guias separadas já
// usa: CONSXMLDECLARACAO38 (consultarXmlDeclaracao) + extrairDebitosDctfweb.
// A identificação vem do PRÓPRIO XML (inscContrib/perApuracao), não do pedido:
// número de outra empresa ou competência não pode chegar ao DP como se fosse
// desta. `fonte` diz se veio do SERPRO ou do mock (DCTFWEB_MODE).
router.post('/dctfweb/debitos', requireCrossProjectAuth, async (req, res) => {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    const competencia = String(req.body?.competencia || '');
    if (!/^\d{4}-\d{2}$/.test(competencia)) {
        return res.status(400).json({ error: 'competencia obrigatória no formato YYYY-MM' });
    }
    const [anoPA, mesPA] = competencia.split('-');
    try {
        const consulta = await getDctfwebProvider().consultarXmlDeclaracao({ empresaCnpj: cnpj, anoPA, mesPA });
        return res.json(montarRespostaDebitosDctfweb(consulta, { cnpj, competencia }));
    } catch (err) {
        console.error('[dp-integration/dctfweb/debitos]', err);
        return res.status(500).json({ error: err.message });
    }
});

// eSocial - Download de eventos (download cirúrgico)
// POST /api/dp-integration/esocial/download/identificadores
// Body: { cnpj, tipo: 'empregador'|'tabela'|'trabalhador', tpEvt?, perApur?,
//         cpfTrab?, dtIni?, dtFim?, chEvt?, certificado?: 'escritorio'|'empresa', tpAmb? }
// POST /api/dp-integration/esocial/download/eventos
// Body: { cnpj, ids?: string[] | nrRecs?: string[] (até 50), certificado?, tpAmb? }
//
// O CFI assina o pedido e abre o mTLS com o A1 do cofre (por padrão o do
// escritório, procurador do empregador); a chave não sai daqui. Devolve os
// XMLs como o eSocial mandou e quantos pedidos já foram feitos hoje para o
// empregador, porque o eSocial limita os pedidos por dia. O conteúdo dos
// eventos não é gravado; a auditoria (dp_esocial_download_log) guarda quem,
// o quê e o código de resposta, sem CPF.
async function executarDownload(req, res, montar, ler, operacao) {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    let pedido;
    try { pedido = montar({ ...req.body, cnpj }); } catch (err) { return res.status(400).json({ error: err.message }); }
    const tpAmb = Number(req.body?.tpAmb || 1);
    let cert;
    try { cert = await carregarCertificado({ origem: req.body?.certificado, cnpjEmpresa: cnpj }); } catch (err) { return res.status(412).json({ error: err.message }); }
    try {
        const r = await serializarPorEmpregador(cnpj.slice(0, 8), () => executarPedido({ pedido, cert, tpAmb }));
        let retorno;
        try { retorno = ler(r.body); } catch (err) {
            return res.status(502).json({ error: `Resposta inesperada do eSocial (HTTP ${r.status}): ${err.message}`, detalhe: String(r.body || '').slice(0, 300) });
        }
        const b = req.body || {};
        const filtro = operacao === 'identificadores'
            ? { tipo: b.tipo, tpEvt: b.tpEvt || null, perApur: b.perApur || null, dtIni: b.dtIni || null, dtFim: b.dtFim || null, trabalhador: b.tipo === 'trabalhador' }
            : { porRecibo: !(Array.isArray(b.ids) && b.ids.length) };
        const qtd = operacao === 'identificadores' ? retorno.identificadores.length : retorno.arquivos.length;
        const pedidosHoje = await auditarPedido({ por: req.user?.email, cnpj, operacao, filtro, qtd, cdResposta: retorno.cdResposta, httpStatus: r.status, certFingerprint: cert.fingerprint, tpAmb })
            .catch((err) => { console.warn('[dp-integration/esocial/download] auditoria falhou:', err.message); return null; });
        return res.json({ ...retorno, httpStatus: r.status, tpAmb, pedidosHoje, certificado: req.body?.certificado === 'empresa' ? 'empresa' : 'escritorio' });
    } catch (err) {
        console.error(`[dp-integration/esocial/download/${operacao}]`, err);
        return res.status(502).json({ error: err.message });
    }
}

router.post('/esocial/download/identificadores', requireCrossProjectAuth, (req, res) =>
    executarDownload(req, res, montarPedidoIdentificadores, lerRetornoIdentificadores, 'identificadores'));

router.post('/esocial/download/eventos', requireCrossProjectAuth, (req, res) =>
    executarDownload(req, res, montarPedidoDownload, lerRetornoDownload, 'eventos'));

// eSocial - Transmissão de eventos pelo cofre (Paulo, 05/10/2026)
// POST /api/dp-integration/esocial/envio/lote
// Body: { empresaId, cnpj, eventos: string[] (até 50, mesmo grupo),
//         tpAmb?: 1|2, confirmoProducao?: true, certificado?: 'escritorio'|'empresa' }
// POST /api/dp-integration/esocial/envio/consulta
// Body: { empresaId, cnpj, protocolo, tpAmb?, certificado? }
//
// Só o Consultor DP entra (transmitir ao eSocial não é para qualquer módulo),
// e só nas empresas da carteira do usuário — conferido nas regras do próprio
// DP com o token dele (dp-acesso-empresa.js). O CFI confere cada evento
// (empregador, ambiente, grupo, Id), assina com o A1 do cofre (por padrão o
// do escritório, procurador) e envia. Produção restrita é o padrão; produção
// exige confirmoProducao=true, como no gateway da EFD-Reinf: entrega ao
// eSocial não se desfaz. A auditoria (dp_esocial_envio_log) guarda quem,
// empresa, ambiente, Ids, tipos e protocolo — nunca o conteúdo dos eventos.
const soDoDp = crossProjectAuth([PROJETO.dpFolha]);

function resolverAmbienteEsocial(b) {
    const tpAmb = Number(b?.tpAmb ?? 2);
    if (![1, 2].includes(tpAmb)) return { erro: 'tpAmb deve ser 1 (produção) ou 2 (produção restrita).' };
    if (tpAmb === 1 && b?.confirmoProducao !== true) {
        return { erro: 'Transmissão em PRODUÇÃO exige confirmação explícita (confirmoProducao: true): entrega ao eSocial não se desfaz.' };
    }
    return { tpAmb };
}

async function travasDoEnvio(req, res) {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return null;
    const amb = resolverAmbienteEsocial(req.body);
    if (amb.erro) { res.status(400).json({ error: amb.erro }); return null; }
    try {
        await confirmarEmpresaDaCarteiraDp({ token: (req.headers.authorization || '').replace(/^Bearer\s+/i, ''), empresaId: req.body?.empresaId, cnpj });
    } catch (err) {
        res.status(err instanceof AcessoNegado ? 403 : 502).json({ error: err.message });
        return null;
    }
    let cert;
    try { cert = await carregarCertificado({ origem: req.body?.certificado, cnpjEmpresa: cnpj }); } catch (err) { res.status(412).json({ error: err.message }); return null; }
    return { cnpj, tpAmb: amb.tpAmb, cert };
}

function logDoEnvio() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore().collection('dp_esocial_envio_log');
}
function auditarEnvio(dados) {
    return logDoEnvio().add({ em: admin.firestore.FieldValue.serverTimestamp(), ...dados })
        .catch((err) => console.warn('[dp-integration/esocial/envio] auditoria falhou:', err.message));
}
/** O protocolo tem de ter saído deste túnel, para esta empresa e neste ambiente. */
async function protocoloEnviadoPorAqui(protocolo, cnpj, tpAmb) {
    const s = await logDoEnvio().where('protocolo', '==', protocolo).where('operacao', '==', 'envio').limit(5).get();
    return s.docs.some((d) => d.data().empregador === cnpj && d.data().tpAmb === tpAmb);
}

router.post('/esocial/envio/lote', soDoDp, async (req, res) => {
    const cnpjPedido = String(req.body?.cnpj || '').replace(/\D/g, '');
    const ambPedido = resolverAmbienteEsocial(req.body);
    // Conferir os eventos ANTES das travas de I/O: erro de conteúdo volta sem gastar consulta.
    let lote;
    try { lote = analisarLote(req.body?.eventos, { cnpj: cnpjPedido, tpAmb: ambPedido.tpAmb ?? 2 }); } catch (err) { return res.status(400).json({ error: err.message }); }
    const t = await travasDoEnvio(req, res);
    if (!t) return;
    const { cnpj, tpAmb, cert } = t;
    try {
        const assinados = lote.eventos.map((e) => ({ id: e.id, xml: assinarPedidoEsocial(e.xml, cert) }));
        const transmissor = String(req.body?.certificado === 'empresa' ? (cert.cnpjFonte || cnpj) : (cert.cnpjFonte || CNPJ_ESCRITORIO)).replace(/\D/g, '');
        const envelope = envelopeEnvio(montarLoteEnvio({ cnpj, cnpjTransmissor: transmissor, grupo: lote.grupo, eventos: assinados }));
        const r = await serializarPorEmpregador(cnpj.slice(0, 8), () => postSoap({
            url: ENDPOINTS_ENVIO[tpAmb].envio, action: ACTION_ENVIO, envelope, pfxBuffer: cert.pfxBuffer, password: cert.password,
        }));
        let retorno;
        try { retorno = lerRetornoEnvio(r.body); } catch (err) {
            return res.status(502).json({ error: `Resposta inesperada do eSocial (HTTP ${r.status}): ${err.message}`, detalhe: String(r.body || '').slice(0, 300) });
        }
        const eventos = lote.eventos.map((e) => ({ id: e.id, tipo: e.tipo, perApur: e.perApur || null }));
        await auditarEnvio({
            operacao: 'envio', por: req.user?.email || null, empresaIdDp: req.body.empresaId, empregador: cnpj, tpAmb, grupo: lote.grupo,
            eventos, protocolo: retorno.protocolo || null, cdResposta: retorno.cdResposta, httpStatus: r.status, certFingerprint: cert.fingerprint || null, transmissor,
        });
        return res.json({ ...retorno, recebido: retorno.cdResposta === 201 && !!retorno.protocolo, grupo: lote.grupo, eventos, tpAmb, transmissor, httpStatus: r.status });
    } catch (err) {
        console.error('[dp-integration/esocial/envio/lote]', err);
        return res.status(502).json({ error: err.message });
    }
});

router.post('/esocial/envio/consulta', soDoDp, async (req, res) => {
    let protocolo;
    try { protocolo = validarProtocolo(req.body?.protocolo); } catch (err) { return res.status(400).json({ error: err.message }); }
    // Consultar não altera nada no eSocial: produção não pede confirmação.
    if (Number(req.body?.tpAmb) === 1) req.body.confirmoProducao = true;
    const t = await travasDoEnvio(req, res);
    if (!t) return;
    const { cnpj, tpAmb, cert } = t;
    try {
        if (!(await protocoloEnviadoPorAqui(protocolo, cnpj, tpAmb))) {
            return res.status(404).json({ error: 'Este protocolo não foi enviado pelo Consultor DP para esta empresa neste ambiente.' });
        }
        const r = await serializarPorEmpregador(cnpj.slice(0, 8), () => postSoap({
            url: ENDPOINTS_ENVIO[tpAmb].consulta, action: ACTION_CONSULTA, envelope: envelopeConsulta(protocolo), pfxBuffer: cert.pfxBuffer, password: cert.password,
        }));
        let retorno;
        try { retorno = lerRetornoProcessamento(r.body); } catch (err) {
            return res.status(502).json({ error: `Resposta inesperada do eSocial (HTTP ${r.status}): ${err.message}`, detalhe: String(r.body || '').slice(0, 300) });
        }
        await auditarEnvio({
            operacao: 'consulta', por: req.user?.email || null, empresaIdDp: req.body.empresaId, empregador: cnpj, tpAmb, protocolo,
            cdResposta: retorno.cdResposta, aceitos: retorno.eventos.filter((e) => e.nrRecibo).length, recusados: retorno.eventos.filter((e) => !e.nrRecibo).length, httpStatus: r.status,
        });
        return res.json({ ...retorno, protocolo: retorno.protocolo || protocolo, situacao: situacaoDoLote(retorno.cdResposta), tpAmb, httpStatus: r.status });
    } catch (err) {
        console.error('[dp-integration/esocial/envio/consulta]', err);
        return res.status(502).json({ error: err.message });
    }
});

// Leitura de holerites do IOB em PDF pelo Gemini (conferência do motor de
// cálculo do DP). O Gemini só transcreve; a comparação é feita no DP.
// POST /api/dp-integration/holerites/extrair
// Body: { pdfBase64, competencia?: 'YYYY-MM' }
router.post('/holerites/extrair', requireCrossProjectAuth, async (req, res) => {
    const ai = req.app.get('ai');
    if (!ai) return res.status(503).json({ error: 'IA indisponível no CFI (GEMINI_API_KEY ausente).' });
    const pdf = validarPdf(req.body?.pdfBase64);
    if (!pdf.ok) return res.status(400).json({ error: pdf.erro });
    const competencia = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.body?.competencia || '')) ? req.body.competencia : undefined;
    const modelos = req.app.get('geminiModelos');
    const modelo = (typeof modelos === 'function' ? modelos().flash : null) || undefined;
    try {
        const r = await ai.models.generateContent({
            model: modelo,
            contents: [{ role: 'user', parts: [{ text: montarPromptHolerites({ competencia }) }, { inlineData: { mimeType: 'application/pdf', data: pdf.base64 } }] }],
            config: { responseMimeType: 'application/json', responseSchema: SCHEMA_HOLERITES, temperature: 0, maxOutputTokens: 65536 },
        });
        if (r?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
            return res.status(422).json({ error: 'O PDF tem holerites demais para uma leitura só. Divida em partes de até uns 30 funcionários.' });
        }
        const lido = lerRespostaHolerites(r?.text ?? '', { competencia });
        // LGPD: o log não leva nomes nem valores.
        console.info(`[dp-integration/holerites/extrair] ${pdf.bytes} bytes, ${lido.holerites.length} holerite(s), modelo ${modelo || 'padrão'}`);
        return res.json({ ok: true, modelo: modelo || null, ...lido });
    } catch (err) {
        console.error('[dp-integration/holerites/extrair]', err?.message);
        return res.status(502).json({ error: err.message });
    }
});

// MiA, a agente de IA do DP (Consultor DP). Explica legislação, o cálculo da
// tela e as divergências com o IOB; não calcula nem grava nada.
// POST /api/dp-integration/assistente/mia
// Body: { mensagens: [{ papel: 'usuaria'|'mia', texto }], contexto?: { tela, texto } }
router.post('/assistente/mia', requireCrossProjectAuth, async (req, res) => {
    const ai = req.app.get('ai');
    if (!ai) return res.status(503).json({ error: 'IA indisponível no CFI (GEMINI_API_KEY ausente).' });
    const conversa = validarConversa(req.body);
    if (!conversa.ok) return res.status(400).json({ error: conversa.erro });
    const modelos = req.app.get('geminiModelos');
    const modelo = (typeof modelos === 'function' ? modelos().flash : null) || undefined;
    const hoje = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
    try {
        const r = await ai.models.generateContent({
            model: modelo,
            contents: montarConteudo(conversa.mensagens, conversa.contexto),
            // Busca ligada: legislação com fonte, não de memória.
            config: { systemInstruction: instrucaoMia({ hoje }), tools: [{ googleSearch: {} }], temperature: 0.3, maxOutputTokens: 4096 },
        });
        const { texto, fontes } = lerResposta(r);
        if (!texto) return res.status(502).json({ error: 'A MiA não conseguiu responder agora. Tente reformular a pergunta.' });
        // LGPD: o log não leva a conversa.
        console.info(`[dp-integration/assistente/mia] ${conversa.mensagens.length} mensagem(ns), contexto ${conversa.contexto ? conversa.contexto.texto.length : 0} car., ${fontes.length} fonte(s), modelo ${modelo || 'padrão'}`);
        return res.json({ ok: true, texto, fontes, modelo: modelo || null });
    } catch (err) {
        console.error('[dp-integration/assistente/mia]', err?.message);
        return res.status(502).json({ error: err.message });
    }
});

// Batch query — all DP-relevant data for a company in a single call.
// POST /api/dp-integration/empresa-completo
// Body: { cnpj, competencia: 'YYYY-MM' }
router.post('/empresa-completo', requireCrossProjectAuth, async (req, res) => {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    const competencia = req.body.competencia || new Date().toISOString().slice(0, 7);

    try {
        const [fgts, esocial, dctfweb, crf] = await Promise.allSettled([
            consultarFgtsDigital(cnpj, competencia),
            consultarESocial(cnpj, competencia),
            consultarDctfWeb(cnpj, competencia),
            consultarCrfFgtsSerpro(cnpj),
        ]);

        return res.json({
            cnpj,
            competencia,
            consultadoEm: new Date().toISOString(),
            fgts: fgts.status === 'fulfilled' ? fgts.value : { ok: false, erro: fgts.reason?.message },
            esocial: esocial.status === 'fulfilled' ? esocial.value : { ok: false, erro: esocial.reason?.message },
            dctfweb: dctfweb.status === 'fulfilled' ? dctfweb.value : { ok: false, erro: dctfweb.reason?.message },
            crfFgts: crf.status === 'fulfilled' ? crf.value : { ok: false, erro: crf.reason?.message },
        });
    } catch (err) {
        console.error('[dp-integration/empresa-completo]', err);
        return res.status(500).json({ error: err.message });
    }
});

// ─── E-mail do DP ao cliente (Graph) ─────────────────────────────────────────
// POST /api/dp-integration/email/enviar
// Body: { empresaId, cnpj, empresaNome, titulo, competencia?, para, assunto?,
//         mensagem, anexos: [{ nome, base64, mime? }] }
// Mesma régua do CFI (envio-imposto /graph) e do CCI (Paulo, 08/10/2026):
// remetente = colaborador logado (caixa do domínio; senão a institucional),
// com volta à institucional se a caixa dele não existir, DITA na resposta;
// cópia oculta do gestor do DP (DP_EMAIL_BCC); cópia em Itens Enviados. Só
// para empresa da carteira do usuário no DP (lida com o token dele).
// Auditoria em dp_email_envio_log: quem, de onde, para quem, nomes e
// tamanhos dos anexos — nunca o conteúdo.
router.post('/email/enviar', soDoDp, async (req, res) => {
    const cnpj = validarCnpj(req, res);
    if (!cnpj) return;
    const pedido = validarPedidoEmailDp(req.body);
    if (!pedido.ok) return res.status(pedido.status).json({ ok: false, error: pedido.error });
    try {
        await confirmarEmpresaDaCarteiraDp({ token: (req.headers.authorization || '').replace(/^Bearer\s+/i, ''), empresaId: req.body?.empresaId, cnpj });
    } catch (err) {
        return res.status(err instanceof AcessoNegado ? 403 : 502).json({ ok: false, error: err.message });
    }
    try {
        const padrao = process.env.GRAPH_REMETENTE || process.env.NOTIF_REMETENTE_EMAIL || 'junior@spassessoriacontabil.com.br';
        const escolha = escolherRemetente({ emailColaborador: req.user?.email, padrao, dominios: dominiosPermitidos() });
        const jaNoPara = new Set(pedido.para.map((e) => e.toLowerCase()));
        const bcc = parseDestinatarios(process.env.DP_EMAIL_BCC).filter((c) => !jaNoPara.has(c.toLowerCase()));
        const corpoHtml = montarEmailPacoteDp({ titulo: pedido.titulo, empresaNome: pedido.empresaNome, competencia: pedido.competencia, mensagem: pedido.mensagem, anexos: pedido.anexos });
        const anexos = [...pedido.anexos.map(({ bytes: _b, ...a }) => a), ...anexoLogo()];

        let remetente = escolha.remetente;
        let fonteRemetente = escolha.fonte;
        let avisoRemetente = escolha.motivo;
        let envio = await enviarEmail({ remetente, para: pedido.para, bcc, assunto: pedido.assunto, corpoHtml, anexos });
        if (!envio.ok && fonteRemetente === 'colaborador' && ehErroDeCaixaInexistente(envio.error)) {
            avisoRemetente = `a caixa ${remetente} não pôde enviar; usamos ${padrao}`;
            remetente = padrao;
            fonteRemetente = 'padrao';
            envio = await enviarEmail({ remetente, para: pedido.para, bcc, assunto: pedido.assunto, corpoHtml, anexos });
        }
        if (!envio.ok) return res.status(502).json({ ok: false, error: envio.error || 'Falha ao enviar o e-mail.' });

        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
        await admin.firestore().collection('dp_email_envio_log').add({
            em: admin.firestore.FieldValue.serverTimestamp(),
            por: req.user?.email || null, projetoOrigem: req.user?.projectId || null,
            empresaId: String(req.body?.empresaId || ''), cnpj,
            para: pedido.para, copiaPara: bcc, assunto: pedido.assunto,
            remetente, fonteRemetente,
            anexos: pedido.anexos.map((a) => ({ nome: a.name, bytes: a.bytes })),
            convites: envio.convites || 0,
        }).catch((err) => console.warn('[dp-integration/email] auditoria falhou:', err.message));
        // O enviarEmail acrescenta vencimentos-sp.ics quando lê um vencimento num
        // PDF anexo, e avisa quando não consegue ler: a tela do DP diz as duas
        // coisas, como o /graph do envio de impostos (Codex, CFI #1391).
        const convites = envio.convites || 0;
        const avisosConvites = envio.avisosConvites || [];
        const totalAnexos = pedido.anexos.length + (convites ? 1 : 0);
        console.log(`[dp-integration/email] ${cnpj} de ${remetente} (${fonteRemetente}) → ${pedido.para.join(', ')} · ${totalAnexos} anexo(s)`);
        return res.json({ ok: true, remetente, fonteRemetente, avisoRemetente, copiaPara: bcc, anexos: totalAnexos, convites, avisosConvites });
    } catch (err) {
        console.error('[dp-integration/email]', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

export default router;
