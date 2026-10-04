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
import { carregarCertificado, executarPedido, auditarPedido, serializarPorEmpregador } from './esocial-download-client.js';
import { validarPdf, montarPromptHolerites, lerRespostaHolerites, SCHEMA_HOLERITES } from './holerite-extracao.js';

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

export default router;
