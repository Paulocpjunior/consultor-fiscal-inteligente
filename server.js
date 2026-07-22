import express from 'express';
import { secretsMatch } from './sefaz-backend/cron-secret.js';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import multer from 'multer';
import * as XLSX from 'xlsx';
import sefazCertRouter from './sefaz-backend/cert-manager.js';
import sefazCertAlertaCronRouter from './sefaz-backend/cert-alerta-cron.js';
import sefazCapturaResumoCronRouter from './sefaz-backend/captura-resumo-cron.js';
import saeNfceCronRouter from './sefaz-backend/sefaz-sp-nfce-cron.js';
import distdfeAutxmlRouter from './sefaz-backend/distdfe-autxml-routes.js';
import coberturaSaidaRouter from './sefaz-backend/cobertura-saida-routes.js';
import ipiVarreduraRouter from './sefaz-backend/ipi-varredura-routes.js';
import backlogEntradaRouter from './sefaz-backend/backlog-entrada-routes.js';
import xmlEmailIngestRouter from './sefaz-backend/xml-email-ingestor-routes.js';
import sefazSyncRouter from './sefaz-backend/sync-routes.js';
import { fetchAllDocs } from './sefaz-backend/firestore-paginate.js';
import empresaStatusRouter from './sefaz-backend/empresa-status-routes.js';
import cronHealthRouter from './sefaz-backend/cron-health-routes.js';
import vencimentosRouter from './sefaz-backend/vencimentos-routes.js';
import sefazManifestoRouter from './sefaz-backend/manifesto-routes.js';
import sefazNfseSpRouter from './sefaz-backend/nfse-sp-routes.js';
import spedFiscalRouter from './sefaz-backend/sped-fiscal-routes.js';
import spedContribRouter from './sefaz-backend/sped-contrib-routes.js';
import caixaPostalRouter from './sefaz-backend/caixa-postal-routes.js';
import dasRouter from './sefaz-backend/das-routes.js';
import dctfwebRouter from './sefaz-backend/dctfweb-routes.js';
import darfRouter from './sefaz-backend/darf-routes.js';
import emissionRouter from './sefaz-backend/emission-routes.js';
import nfseNacRouter from './sefaz-backend/nfse-nacional-routes.js';
import planoContasBridgeRouter from './sefaz-backend/plano-contas-bridge-routes.js';
import * as sharepoint from './sefaz-backend/sharepoint-provider.js';
import * as sharepointSync from './sefaz-backend/sharepoint-sync-orchestrator.js';
import { processarAlertasSharePoint } from './sefaz-backend/sharepoint-alertas-orchestrator.js';
import certEmpresaRouter from './sefaz-backend/cert-empresa-routes.js';
import notificacoesRouter from './sefaz-backend/notificacoes-routes.js';
import agentRouter from './sefaz-backend/agent-routes.js';
import agentAdminRouter from './sefaz-backend/agent-admin-routes.js';
import nfseNacionalDfeRouter from './sefaz-backend/nfse-nacional-dfe-routes.js';
import abrasfRouter from './sefaz-backend/abrasf/routes.js';
import abrasfDiagnosticoRouter from './sefaz-backend/abrasf/diagnostico-routes.js';
import recuperacaoRouter from './sefaz-backend/recuperacao-tributaria-routes.js';
import nfpComplianceRouter from './sefaz-backend/nfp-compliance-routes.js';
import dpIntegrationRouter from './sefaz-backend/dp-integration-routes.js';
import sharepointAutoSyncRouter from './sefaz-backend/sharepoint-auto-sync.js';
import efdReinfRouter from './sefaz-backend/efd-reinf-routes.js';
import minhaAgendaRouter from './sefaz-backend/minha-agenda-routes.js';
import diagnosticoDocsFiscaisRouter from './sefaz-backend/diagnostico-docs-fiscais-routes.js';
import simplesSublimiteRouter from './sefaz-backend/simples-sublimite-routes.js';
import diagnosticoCadastrosRouter from './sefaz-backend/diagnostico-cadastros-routes.js';
import certMonitorRouter from './sefaz-backend/cert-monitor-routes.js';
import diagnosticoConfigRouter from './sefaz-backend/diagnostico-config-routes.js';
import healthConsolidadoRouter from './sefaz-backend/health-consolidado-routes.js';
import healthAlertaCronRouter from './sefaz-backend/health-alerta-cron.js';
import empresasPerfilRouter from './sefaz-backend/empresas-perfil-routes.js';
import saeNfceRouter from './sefaz-backend/sefaz-sp-nfce-routes.js';
import { requireAdmin, requireAuth } from './sefaz-backend/require-admin.js';
import { podeAcessarCnpj, getCnpjsDaCarteira } from './sefaz-backend/carteira-auth.js';
import { enviarEmail } from './sefaz-backend/graph-provider.js';
import { parseDestinatarios } from './sefaz-backend/email-destinatarios-helper.js';
import { sanitizeError, respondeErro, errorMiddleware } from './sefaz-backend/sanitize-error.js';
import { gerarObrigacoesPorEmpresa } from './sefaz-backend/calendario-obrigacoes.js';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * Validacao por magic-bytes do arquivo enviado em /analise-creditos/upload.
 * Bloqueia upload de binario malicioso disfarcado de XLSX/XML (ex: zip-bomb
 * em .xlsx, PDF executavel renomeado, etc).
 *
 * Magic bytes:
 *   - XLSX/XLS modernos: PK\x03\x04 (ZIP) — 50 4B 03 04
 *   - XLS antigo: D0 CF 11 E0 A1 B1 1A E1 (OLE compound)
 *   - XML: comeca com '<?xml' ou '<' apos BOM opcional
 */
function validarMagicBytes(buffer, nomeOriginal) {
    if (!buffer || buffer.length < 4) return { ok: false, motivo: 'arquivo vazio' };
    const nome = (nomeOriginal || '').toLowerCase();
    const b = buffer;

    // XLSX (ZIP) - 50 4B 03 04 / 50 4B 05 06 / 50 4B 07 08
    if (nome.endsWith('.xlsx')) {
        if (b[0] !== 0x50 || b[1] !== 0x4B) return { ok: false, motivo: 'XLSX invalido (sem PK)' };
        return { ok: true };
    }
    // XLS antigo (OLE compound)
    if (nome.endsWith('.xls')) {
        const ole = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        if (b.length < 8 || ole.some((byte, i) => b[i] !== byte)) {
            // Aceita variante moderna salva como XLSX
            if (b[0] === 0x50 && b[1] === 0x4B) return { ok: true };
            return { ok: false, motivo: 'XLS invalido (sem assinatura OLE)' };
        }
        return { ok: true };
    }
    // XML - skip BOM (EF BB BF) se houver
    if (nome.endsWith('.xml')) {
        let i = 0;
        if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) i = 3;
        // Aceita <?xml ou < direto
        if (b[i] === 0x3C) return { ok: true };
        return { ok: false, motivo: 'XML invalido (nao comeca com <)' };
    }
    // CSV/TXT: sem magic-bytes especifico, aceita ASCII printavel nos primeiros bytes
    if (nome.endsWith('.csv') || nome.endsWith('.txt')) {
        // Rejeita arquivo que pareca binario (muitos bytes nulos ou > 0x7F nao-UTF8)
        let nulos = 0;
        for (let j = 0; j < Math.min(512, b.length); j++) {
            if (b[j] === 0x00) nulos++;
        }
        if (nulos > 5) return { ok: false, motivo: 'CSV/TXT contem bytes binarios' };
        return { ok: true };
    }
    return { ok: false, motivo: `extensao nao suportada: "${nome}"` };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
// Cloud Run roda atrás de 1 proxy (Google Front End)
// Necessário pra express-rate-limit ler X-Forwarded-For correto
app.set('trust proxy', 1);

const PORT = process.env.PORT || 8080;

const ALLOWED_ORIGINS = [
    ...(process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()),
    'https://consultorfiscalapp.web.app',
    'https://consultorfiscalapp.firebaseapp.com',
    // Projeto Consultor-DP-Folhapagamentos (deploy separado, mesma org/domínio).
    'https://paulocpjunior.github.io',
    'https://consultor-dp-folha.web.app',
    'https://consultor-dp-folha.firebaseapp.com',
    'http://localhost:3000',
    'http://localhost:5173',
].filter(Boolean);

function validateCorsOrigin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(null, false);
}

// CORS — permite apenas origens conhecidas; chamadas server-to-server sem Origin passam.
app.use(cors({
    origin: validateCorsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
        'Authorization',
        'Content-Type',
        'X-Requested-With',
        'X-Cron-Secret',
        'X-Sefaz-Cron-Secret',
        'X-Notif-Cron-Secret',
        'X-Fiscal-Gateway-Token',
        'X-Internal-Token',
    ],
}));

// ── Middleware de segurança e parsing — ANTES dos routers! ──────────────
// BUG corrigido: helmet/express.json/rateLimit estavam montados DEPOIS dos
// routers /api/admin/*. No Express o middleware roda na ordem de registro;
// como o router respondia primeiro, esses 3 NUNCA rodavam pras rotas da API
// (a superficie inteira, incluindo SEFAZ, ficava SEM rate limit nem headers
// de seguranca). Movido pra ca, antes dos mounts, pra valer de verdade.
// CSP endurecida: scriptSrc SEM 'unsafe-inline' (vetor XSS principal).
// styleSrc mantem 'unsafe-inline' pois React injeta inline styles em runtime
// e impacto de XSS via CSS e bem menor que via script. Tailwind CDN removido
// (build-time desde o switch pra @tailwindcss/postcss; nao usamos mais a CDN).
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://apis.google.com", "https://www.gstatic.com", "https://cdnjs.cloudflare.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            frameSrc: ["'self'", "blob:", "https://*.firebaseapp.com", "https://apis.google.com"],
            workerSrc: ["'self'", "https://cdnjs.cloudflare.com", "blob:"],
            // consultor-fiscal-proxy: o front chama o proxy SharePoint (deploy
            // separado) direto do navegador — sem ele no connect-src o CSP
            // bloqueia o /api/sharepoint/health e a aba mostra "indisponivel".
            connectSrc: ["'self'", "https://*.googleapis.com", "https://*.firebaseio.com", "https://*.firebaseapp.com", "https://firebasestorage.googleapis.com", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://cdnjs.cloudflare.com", "https://consultor-fiscal-proxy-631239634290.us-west1.run.app"],
        },
    },
}));
app.use(express.json({ limit: '20mb' }));

// Rate limiting. skip: requisicoes de cron autenticadas (Cloud Scheduler)
// nunca sao limitadas — senao um pico de crons as 7-8h poderia ser barrado.
// Comparacao de segredo em tempo constante (secretsMatch compartilhado —
// sefaz-backend/cron-secret.js). Evita vazamento por timing do prefixo correto.
const isCronRequest = (req) => {
    const secret = process.env.SEFAZ_CRON_SECRET;
    const header = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'];
    return secretsMatch(header, secret);
};
const rateLimitKey = (req) => {
    const auth = req.headers.authorization || '';
    return auth ? `auth:${auth.slice(-48)}` : req.ip;
};
// Limite geral anti-flood em toda a API.
const apiLimiter = rateLimit({
    windowMs: 60_000, max: 600,
    standardHeaders: true, legacyHeaders: false,
    keyGenerator: rateLimitKey,
    skip: (req) => {
        if (isCronRequest(req)) return true;
        const url = req.originalUrl || '';
        return url.startsWith('/api/admin/cert-empresa')
            || url.startsWith('/api/admin/sefaz/window');
    },
    message: { error: 'Muitas requisições em pouco tempo. Aguarde um momento.' },
});
// Limite RIGOROSO nas rotas que consultam a SEFAZ on-demand: cada hit =
// 1 chamada à SEFAZ/SERPRO. Sem isso, um cliente em loop queima a quota do
// IP do Cloud Run e provoca cStat 656 (Consumo Indevido) pra todo mundo.
const sefazLimiter = rateLimit({
    windowMs: 60_000, max: 30,
    standardHeaders: true, legacyHeaders: false,
    skip: isCronRequest,
    message: { error: 'Muitas consultas à SEFAZ em pouco tempo. Aguarde ~1 minuto.' },
});

// Anti-enumeracao em /cnpj-lookup. Antes esse endpoint nao tinha limite
// dedicado e qualquer colaborador podia varrer CNPJs (LGPD). 20/min/IP cobre
// uso humano normal (cadastro de empresa pontual) e bloqueia varredura.
const cnpjLookupLimiter = rateLimit({
    windowMs: 60_000, max: 20,
    standardHeaders: true, legacyHeaders: false,
    skip: isCronRequest,
    keyGenerator: (req) => (req.user?.uid ? `u:${req.user.uid}` : req.ip),
    message: { error: 'Muitas consultas CNPJ em pouco tempo. Aguarde ~1 minuto.' },
});
// Anti-brute-force em /api/agent/* (validacao de API key). Sem limite dedicado
// um atacante consegue testar milhares de keys/min sob o limite global de 120/min.
// 10/min/IP eh suficiente pra uso legitimo (n8n/Zapier publicam mensagens com
// intervalo grande) e duro pra brute force (chave SHA-256 = 2^256 espaco).
const agentLimiter = rateLimit({
    windowMs: 60_000, max: 10,
    standardHeaders: true, legacyHeaders: false,
    skip: isCronRequest,
    message: { error: 'Muitas tentativas de autenticacao. Aguarde 1 minuto.' },
});
const certEmpresaLimiter = rateLimit({
    windowMs: 60_000, max: 80,
    standardHeaders: true, legacyHeaders: false,
    skip: isCronRequest,
    keyGenerator: rateLimitKey,
    message: { error: 'Muitas operações de certificado em pouco tempo. Aguarde alguns instantes.' },
});
const sefazWindowLimiter = rateLimit({
    windowMs: 60_000, max: 600,
    standardHeaders: true, legacyHeaders: false,
    skip: isCronRequest,
    message: { error: 'Muitas consultas de status da janela SEFAZ. Aguarde alguns instantes.' },
});
app.use('/api/admin/cert-empresa', certEmpresaLimiter);
app.use('/api/admin/sefaz/window', sefazWindowLimiter);
app.use('/api/', apiLimiter);
app.use('/api/admin/sefaz/consulta-nfe-por-chave', sefazLimiter);
app.use('/api/admin/sefaz/sync-one', sefazLimiter);
app.use('/api/admin/cnpj-lookup', cnpjLookupLimiter);
app.use('/api/agent', agentLimiter);

// ── Routers (montados DEPOIS do middleware de segurança/limite) ─────────
app.use('/api/admin/sefaz', sefazCertRouter);
app.use('/api/admin/sefaz', sefazCertAlertaCronRouter);
app.use('/api/admin/sefaz', sefazCapturaResumoCronRouter);
app.use('/api/admin/sefaz', saeNfceCronRouter);
app.use('/api/admin/sefaz', distdfeAutxmlRouter);
app.use('/api/admin/sefaz', coberturaSaidaRouter);
app.use('/api/admin/sefaz', ipiVarreduraRouter);
app.use('/api/admin/sefaz', backlogEntradaRouter);
app.use('/api/admin/sefaz', xmlEmailIngestRouter);
app.use('/api/admin/sefaz', sefazSyncRouter);
app.use('/api/admin/sefaz', empresaStatusRouter);
app.use('/api/admin/crons', cronHealthRouter);
app.use('/api/admin/vencimentos', vencimentosRouter);
app.use('/api/admin/sefaz', sefazManifestoRouter);
app.use('/api/admin/sae-nfce', saeNfceRouter);
app.use('/api/admin/sefaz', sefazNfseSpRouter);
app.use('/api/admin/sped-fiscal', spedFiscalRouter);
app.use('/api/admin/sped-contrib', spedContribRouter);
app.use('/api/admin/caixa-postal', caixaPostalRouter);
app.use('/api/admin/das', dasRouter);
app.use('/api/admin/dctfweb', dctfwebRouter);
app.use('/api/admin/darf', darfRouter);
app.use('/api/admin/emission', emissionRouter);
app.use('/api/admin/nfse-nacional', nfseNacRouter);
app.use('/api/admin/cert-empresa', certEmpresaRouter);
app.use('/api/admin/notificacoes', notificacoesRouter);
app.use('/api/admin/agent', agentAdminRouter);
app.use('/api/agent', agentRouter);
app.use('/api/admin/nfse-nacional-dfe', nfseNacionalDfeRouter);
app.use('/api/admin/abrasf', abrasfRouter);
app.use('/api/admin/abrasf', abrasfDiagnosticoRouter);
app.use('/api/internal/plano-contas', planoContasBridgeRouter);
app.use('/api/admin/recuperacao', recuperacaoRouter);
app.use('/api/admin/nfp-compliance', nfpComplianceRouter);
app.use('/api/dp-integration', dpIntegrationRouter);
app.use('/api/admin/sharepoint', sharepointAutoSyncRouter);
app.use('/api/admin/efd-reinf', efdReinfRouter);
app.use('/api/admin/minha-agenda', minhaAgendaRouter);
app.use('/api/admin/diagnostico-docs-fiscais', diagnosticoDocsFiscaisRouter);
app.use('/api/admin/simples-sublimite', simplesSublimiteRouter);
app.use('/api/admin/diagnostico-cadastros', diagnosticoCadastrosRouter);
app.use('/api/admin/cert-monitor', certMonitorRouter);
app.use('/api/admin/diagnostico-config', diagnosticoConfigRouter);
app.use('/api/admin/health-consolidado', healthConsolidadoRouter);
app.use('/api/admin/empresas-perfil', empresasPerfilRouter);
// O cron e chamado pelo Cloud Scheduler com header X-Cron-Secret — fica fora
// do prefixo /api/admin pra preservar o padrao dos outros crons.
app.use('/api/internal/cron', healthAlertaCronRouter);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Modelos centralizados em env vars — trocar de versao = atualizar o secret no
// Cloud Run, sem mexer em codigo. Default: gemini-flash-latest (alias oficial
// do Google que SEMPRE aponta pra ultima versao GA do Flash). Pra pinar uma
// versao especifica (ex: se uma release nova quebrar prompts), defina o env
// GEMINI_MODEL_PRO/FLASH com o ID exato (ex: gemini-3.5-flash).
const GEMINI_MODEL_PRO = process.env.GEMINI_MODEL_PRO || 'gemini-flash-latest';
const GEMINI_MODEL_FLASH = process.env.GEMINI_MODEL_FLASH || 'gemini-flash-latest';
let ai = null;
if (GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    app.set('ai', ai);
    console.log('Gemini API configurada');
} else {
    console.warn('GEMINI_API_KEY nao configurada');
}

const requireAI = (req, res, next) => {
    if (!ai) return res.status(503).json({ error: 'IA indisponivel' });
    next();
};

// ─── Roteamento Gemini Pro vs Flash ────────────────────────────────────────
// Pro custa ~8x mais que Flash. Heuristica: usa Pro so quando faz diferenca
// (anexo, prompt longo, ou consulta analitica). Flash atende ~70% dos casos
// (perguntas factuais, classificacoes curtas, parsings simples) sem perda
// perceptivel de qualidade.
const GEMINI_KEYWORDS_ANALITICAS = /\b(analise|analisar|comparar|comparacao|relatorio|detalhad|consultoria|aprofundad|complexo|elabor|justifica|fundamenta|parecer|tese)/i;

function pickGeminiModel({ explicitModel, prompt, hasAttachment }) {
    // 1. Override explicito do cliente vence
    if (explicitModel && typeof explicitModel === 'string' && explicitModel.startsWith('gemini-')) {
        return explicitModel;
    }
    // 2. Anexo -> Pro (Flash multimodal eh menos confiavel pra docs/imagens longas)
    if (hasAttachment) return GEMINI_MODEL_PRO;
    // 3. Prompt longo -> Pro
    const len = typeof prompt === 'string' ? prompt.length : (prompt ? JSON.stringify(prompt).length : 0);
    if (len > 4000) return GEMINI_MODEL_PRO;
    // 4. Keywords analiticas -> Pro
    if (typeof prompt === 'string' && GEMINI_KEYWORDS_ANALITICAS.test(prompt)) {
        return GEMINI_MODEL_PRO;
    }
    // 5. Default: Flash (barato)
    return GEMINI_MODEL_FLASH;
}

function logGeminiRoute(modelo, contexto) {
    const tag = modelo === GEMINI_MODEL_FLASH ? 'FLASH' : 'PRO  ';
    console.log(`[gemini-router] ${tag} ${modelo} ${JSON.stringify(contexto)}`);
}

app.get('/health', async (_req, res) => {
    const checks = {
        status: 'ok',
        ai: !!ai,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
    };
    try {
        const adminMod = (await import('firebase-admin')).default;
        if (adminMod.apps.length) {
            await adminMod.firestore().collection('users').limit(1).get();
            checks.firestore = 'ok';
        } else {
            checks.firestore = 'not_initialized';
        }
    } catch (e) {
        checks.firestore = 'error';
    }
    res.json(checks);
});

// Readiness estrito: diferente do /health (liveness — 200 se o processo está de
// pé), o /ready retorna 503 quando uma dependência ESSENCIAL (Firestore) está
// quebrada. O gate do canário no deploy bate AQUI — assim uma revisão que sobe
// mas não fala com o Firestore (credencial/env quebrada) é barrada ANTES de
// receber tráfego, em vez de passar num /health que sempre respondia 200.
app.get('/ready', async (_req, res) => {
    const out = { status: 'ready', timestamp: new Date().toISOString() };
    try {
        const adminMod = (await import('firebase-admin')).default;
        // Inicializa o admin se ainda não estiver (numa revisão candidata "fria",
        // sem tráfego, nada inicializou o firebase-admin ainda — não tratar isso
        // como falha: inicializa aqui e testa o Firestore de verdade, igual aos
        // helpers fa() dos routers). Se o credential/Firestore estiver quebrado, o
        // initializeApp/get abaixo lança e cai no 503 — que é o que o gate quer.
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        await adminMod.firestore().collection('users').limit(1).get();
        out.firestore = 'ok';
        return res.json(out);
    } catch (e) {
        out.status = 'not_ready';
        out.firestore = 'error';
        out.motivo = String(e && e.message || e).slice(0, 200);
        return res.status(503).json(out);
    }
});

function isGeminiQuotaError(err) {
    const raw = err instanceof Error ? `${err.message || ''}\n${err.stack || ''}` : String(err || '');
    return /RESOURCE_EXHAUSTED|prepayment credits|quota exceeded|billing|429/i.test(raw);
}

function respondeGeminiQuota(res) {
    return res.status(429).json({
        error: 'Limite de créditos/cota da IA esgotado. Consultas determinísticas de CFOP continuam funcionando; para análises por IA, recarregue créditos ou configure faturamento no Google AI Studio.',
    });
}

app.post('/api/fiscal/query', requireAuth, requireAI, async (req, res) => {
    const { prompt, model, temperature, googleSearch } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt obrigatorio' });
    try {
        const escolhido = pickGeminiModel({ explicitModel: model, prompt, hasAttachment: false });
        logGeminiRoute(escolhido, { rota: 'query', chars: typeof prompt === 'string' ? prompt.length : '?' });
        const requestBody = { model: escolhido, contents: prompt };
        if (temperature !== undefined) requestBody.config = { temperature };
        if (googleSearch) {
            requestBody.config = requestBody.config || {};
            requestBody.config.tools = [{ googleSearch: {} }];
        }
        const response = await ai.models.generateContent(requestBody);
        return res.json({ text: response.text ?? '', candidates: response.candidates || [] });
    } catch (err) {
        console.error('Erro Gemini:', err?.message);
        if (isGeminiQuotaError(err)) return respondeGeminiQuota(res);
        return respondeErro(res, err, 'Erro IA');
    }
});

app.post('/api/fiscal/multimodal', requireAuth, requireAI, async (req, res) => {
    const { prompt, base64Data, mimeType, model } = req.body;
    if (!prompt || !base64Data || !mimeType) return res.status(400).json({ error: 'campos obrigatorios' });
    try {
        const escolhido = pickGeminiModel({ explicitModel: model, prompt, hasAttachment: true });
        logGeminiRoute(escolhido, { rota: 'multimodal', mime: mimeType, chars: typeof prompt === 'string' ? prompt.length : '?' });
        const response = await ai.models.generateContent({
            model: escolhido,
            contents: [{ inlineData: { mimeType, data: base64Data } }, { text: prompt }],
        });
        return res.json({ text: response.text ?? '', candidates: response.candidates || [] });
    } catch (err) {
        if (isGeminiQuotaError(err)) return respondeGeminiQuota(res);
        return respondeErro(res, err, 'Erro');
    }
});

// ─── Previsao DAS (D4a) ─────────────────────────────────────────────────────
// Estatistica simples (regressao linear) + IA opcional pra contextualizar.
// Tabela de faixas Simples (limite anual em R\$).
const ANEXOS_LIMITES = {
    'I':   [180000, 360000, 720000, 1800000, 3600000, 4800000],
    'II':  [180000, 360000, 720000, 1800000, 3600000, 4800000],
    'III': [180000, 360000, 720000, 1800000, 3600000, 4800000],
    'IV':  [180000, 360000, 720000, 1800000, 3600000, 4800000],
    'V':   [180000, 360000, 720000, 1800000, 3600000, 4800000],
};

function regressaoLinear(pontos) {
    // pontos: [{x, y}], retorna { slope, intercept, r2 }
    const n = pontos.length;
    if (n < 2) return { slope: 0, intercept: pontos[0]?.y || 0, r2: 0 };
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (const p of pontos) {
        sumX += p.x; sumY += p.y;
        sumXY += p.x * p.y; sumX2 += p.x * p.x; sumY2 += p.y * p.y;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
    const intercept = (sumY - slope * sumX) / n;
    const yMean = sumY / n;
    let ssRes = 0, ssTot = 0;
    for (const p of pontos) {
        const yPred = slope * p.x + intercept;
        ssRes += Math.pow(p.y - yPred, 2);
        ssTot += Math.pow(p.y - yMean, 2);
    }
    const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
    return { slope, intercept, r2 };
}

function competenciaSeguinte(yyyymm, offset = 1) {
    const m = (yyyymm || '').match(/(\d{4})-(\d{2})/);
    if (!m) return '';
    let ano = parseInt(m[1]), mes = parseInt(m[2]);
    mes += offset;
    while (mes > 12) { mes -= 12; ano++; }
    return `${ano}-${String(mes).padStart(2, '0')}`;
}

function mesReferenciaParaYYYYMM(mesRef) {
    // 'maio de 2026' -> '2026-05', 'abril de 2026' -> '2026-04'
    const meses = { janeiro:1, fevereiro:2, março:3, marco:3, abril:4, maio:5, junho:6,
                    julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12 };
    const m = (mesRef || '').toLowerCase().match(/([a-zç]+)\s+de\s+(\d{4})/);
    if (!m) return '';
    const mes = meses[m[1]];
    const ano = m[2];
    if (!mes) return '';
    return `${ano}-${String(mes).padStart(2, '0')}`;
}

app.get('/api/admin/das/previsao/:empresaId', requireAdmin, async (req, res) => {
    try {
        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const db = adminMod.firestore();

        const empresaId = req.params.empresaId;
        const empSnap = await db.collection('simples_empresas').doc(empresaId).get();
        if (!empSnap.exists) return res.status(404).json({ error: 'empresa nao encontrada' });
        const emp = empSnap.data();
        // 23/05: bloqueia perdedores do merge de duplicatas
        if (emp._merged_into) return res.status(410).json({ error: 'empresa consolidada', mergedInto: emp._merged_into });
        const historico = (emp.historicoCalculos || [])
            .map(h => ({ ...h, yyyymm: mesReferenciaParaYYYYMM(h.mesReferencia) }))
            .filter(h => h.yyyymm)
            .sort((a, b) => a.yyyymm.localeCompare(b.yyyymm));

        if (historico.length < 2) {
            return res.json({
                empresa: { id: empresaId, nome: emp.nome, anexo: emp.anexo, cnpj: emp.cnpj },
                historico,
                previsao: [],
                aviso: 'Histórico insuficiente (precisa ≥ 2 meses).',
            });
        }

        // Regressao no DAS
        const pontosDas = historico.map((h, i) => ({ x: i, y: h.das_mensal || 0 }));
        const regDas = regressaoLinear(pontosDas);

        // Regressao no faturamento mensal (rbt12 deslocado)
        // rbt12 muda devagar; melhor olhar faturamento via diff
        const faturamentos = historico.map(h => h.rbt12 / 12);  // proxy
        const ultimoRbt12 = historico[historico.length - 1].rbt12;
        const ultimoMesYYYYMM = historico[historico.length - 1].yyyymm;

        // Projeta os proximos 3 meses
        const previsao = [];
        const tabelaLimites = ANEXOS_LIMITES[historico[historico.length - 1].anexo_efetivo] || ANEXOS_LIMITES['I'];

        for (let offset = 1; offset <= 3; offset++) {
            const x = historico.length - 1 + offset;
            const dasProvavel = Math.max(0, regDas.slope * x + regDas.intercept);

            // Margem de erro depende do R²
            const margem = (1 - regDas.r2) * 0.30 + 0.05;  // entre 5% e 35%
            const dasMin = dasProvavel * (1 - margem);
            const dasMax = dasProvavel * (1 + margem);

            // Projeta RBT12 com base na tendencia do ultimo trimestre
            const ultTres = historico.slice(-3);
            const fatMedio = ultTres.reduce((s, h) => s + (h.das_mensal / Math.max(0.01, h.aliq_eff / 100)), 0) / ultTres.length;
            const rbt12Projetado = ultimoRbt12 + fatMedio * offset;

            // Detecta mudanca de faixa
            let mudancaFaixa = null;
            for (const limite of tabelaLimites) {
                if (ultimoRbt12 < limite && rbt12Projetado >= limite) {
                    mudancaFaixa = { limite, mensagem: `Pode ultrapassar R\$ ${limite.toLocaleString('pt-BR')} de RBT12` };
                    break;
                }
            }

            previsao.push({
                competencia: competenciaSeguinte(ultimoMesYYYYMM, offset),
                dasProvavel: +dasProvavel.toFixed(2),
                dasMin: +dasMin.toFixed(2),
                dasMax: +dasMax.toFixed(2),
                rbt12Projetado: +rbt12Projetado.toFixed(2),
                mudancaFaixa,
                confianca: regDas.r2,
            });
        }

        return res.json({
            empresa: { id: empresaId, nome: emp.nome, anexo: emp.anexo, cnpj: emp.cnpj },
            historico: historico.map(h => ({
                competencia: h.yyyymm,
                das: h.das_mensal,
                aliquotaEfetiva: h.aliq_eff,
                rbt12: h.rbt12,
            })),
            estatistica: {
                slope: +regDas.slope.toFixed(2),
                r2: +regDas.r2.toFixed(3),
                qtdMesesAnalisados: historico.length,
            },
            previsao,
        });
    } catch (err) {
        console.error('[das/previsao]', err);
        return respondeErro(res, err);
    }
});

app.post('/api/admin/das/previsao-ia', requireAdmin, requireAI, async (req, res) => {
    try {
        const { dadosPrevisao } = req.body;
        if (!dadosPrevisao) return res.status(400).json({ error: 'dadosPrevisao obrigatorio' });

        const histResumo = (dadosPrevisao.historico || []).map(h =>
            `  ${h.competencia}: DAS R\$ ${h.das.toFixed(2)} | aliq ${h.aliquotaEfetiva.toFixed(2)}% | RBT12 R\$ ${h.rbt12.toFixed(0)}`
        ).join('\n');

        const prevResumo = (dadosPrevisao.previsao || []).map(p =>
            `  ${p.competencia}: DAS provável R\$ ${p.dasProvavel.toFixed(2)} (entre ${p.dasMin.toFixed(2)} e ${p.dasMax.toFixed(2)}) | RBT12 projetado R\$ ${p.rbt12Projetado.toFixed(0)}${p.mudancaFaixa ? ' ⚠ ' + p.mudancaFaixa.mensagem : ''}`
        ).join('\n');

        const prompt = `Voce eh um consultor fiscal senior. Analise a previsao de DAS Simples Nacional desta empresa em portugues brasileiro:

Empresa: ${dadosPrevisao.empresa.nome} (Anexo ${dadosPrevisao.empresa.anexo})

Histórico recente:
${histResumo}

Previsão (próximos 3 meses):
${prevResumo}

Estatística: tendência mensal R\$ ${dadosPrevisao.estatistica.slope}/mês, R²=${dadosPrevisao.estatistica.r2} (${dadosPrevisao.estatistica.qtdMesesAnalisados} meses analisados).

Em 3 paragrafos curtos:
1. **Tendencia:** explica se DAS esta subindo, caindo ou estavel, e por que (volume de faturamento, troca de faixa, fator R)
2. **Riscos:** alerta sobre mudanca de faixa, perda do Simples, sazonalidade
3. **Recomendacao:** acao especifica (estoque, planejamento, conversa com cliente)

Use **negrito** nos pontos-chave. Direto, sem rodeios.`;

        const escolhido = pickGeminiModel({ prompt, hasAttachment: false });
        logGeminiRoute(escolhido, { rota: 'das-previsao-ia', chars: prompt.length });
        const response = await ai.models.generateContent({
            model: escolhido,
            contents: prompt,
        });
        return res.json({
            analise: response.text ?? '',
            geradoEm: new Date().toISOString(),
            modelo: escolhido,
        });
    } catch (err) {
        console.error('[das/previsao-ia]', err);
        return respondeErro(res, err);
    }
});

// ─── Consulta CNPJ via BrasilAPI (proxy para CSP) ────────────────────────
app.get('/api/admin/cnpj-lookup/:cnpj', requireAuth, async (req, res) => {
    const cnpj = (req.params.cnpj || '').replace(/\D/g, '');
    if (!cnpj || cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });

    const apis = [
        { name: 'BrasilAPI', url: `https://brasilapi.com.br/api/cnpj/v1/${cnpj}` },
        { name: 'ReceitaWS', url: `https://receitaws.com.br/v1/cnpj/${cnpj}` },
        { name: 'CNPJ.ws', url: `https://publica.cnpj.ws/cnpj/${cnpj}` },
    ];

    for (const api of apis) {
        try {
            const resp = await fetch(api.url, {
                headers: { 'Accept': 'application/json', 'User-Agent': 'ConsultorFiscal/1.0' },
                signal: AbortSignal.timeout(10000),
            });
            if (resp.ok) {
                const raw = await resp.json();
                const data = api.name === 'CNPJ.ws' ? normalizeCnpjWs(raw, cnpj) : api.name === 'ReceitaWS' ? normalizeReceitaWs(raw, cnpj) : raw;
                return res.json(data);
            }
            console.warn(`[cnpj-lookup] ${api.name} retornou ${resp.status} para ${cnpj}`);
        } catch (e) {
            console.warn(`[cnpj-lookup] ${api.name} falhou: ${e.message}`);
        }
    }
    res.status(502).json({ error: 'Todas as APIs de consulta CNPJ falharam. Tente novamente em alguns minutos.' });
});

function normalizeReceitaWs(raw, cnpj) {
    return {
        cnpj, razao_social: raw.nome, nome_fantasia: raw.fantasia,
        cnae_fiscal: raw.atividade_principal?.[0]?.code, cnae_fiscal_descricao: raw.atividade_principal?.[0]?.text,
        logradouro: raw.logradouro, numero: raw.numero, bairro: raw.bairro,
        municipio: raw.municipio, uf: raw.uf, cep: raw.cep,
        situacao_cadastral: raw.situacao === 'ATIVA' ? '2' : raw.situacao === 'INAPTA' ? '4' : '8',
        descricao_situacao_cadastral: raw.situacao,
        data_inicio_atividade: raw.abertura,
        opcao_simples: raw.simples?.optante === 'Sim' ? true : raw.simples?.optante === 'Nao' ? false : null,
        opcao_mei: raw.simples?.mei === 'Sim',
        porte: raw.porte || '',
        natureza_juridica: raw.natureza_juridica || '',
    };
}

function normalizeCnpjWs(raw, cnpj) {
    return {
        cnpj, razao_social: raw.razao_social, nome_fantasia: raw.estabelecimento?.nome_fantasia || '',
        cnae_fiscal: raw.estabelecimento?.atividade_principal?.id, cnae_fiscal_descricao: raw.estabelecimento?.atividade_principal?.descricao,
        logradouro: raw.estabelecimento?.logradouro, numero: raw.estabelecimento?.numero, bairro: raw.estabelecimento?.bairro,
        municipio: raw.estabelecimento?.cidade?.nome, uf: raw.estabelecimento?.estado?.sigla, cep: raw.estabelecimento?.cep,
        situacao_cadastral: raw.estabelecimento?.situacao_cadastral === 'Ativa' ? '2' : raw.estabelecimento?.situacao_cadastral === 'Inapta' ? '4' : '8',
        descricao_situacao_cadastral: raw.estabelecimento?.situacao_cadastral,
        data_inicio_atividade: raw.estabelecimento?.data_inicio_atividade,
        opcao_simples: raw.simples?.simples ?? null,
        opcao_mei: raw.simples?.mei ?? null,
        porte: raw.porte?.descricao || '',
        natureza_juridica: raw.natureza_juridica?.descricao || '',
    };
}

// ─── Empresa: contato (email + telefone) ──────────────────────────────────
app.get('/api/admin/empresa-contato/:cnpj', requireAuth, async (req, res) => {
    try {
        const cnpjLimpo = (req.params.cnpj || '').replace(/\D/g, '');
        if (!cnpjLimpo) return res.json({ email: '', telefone: '' });
        const acesso = await podeAcessarCnpj(req.user, cnpjLimpo);
        if (!acesso.ok) return res.status(acesso.status).json({ error: acesso.error });

        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const db = adminMod.firestore();

        // Busca em simples + lucro
        let dadosFiscais = null;
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).get();
            for (const d of snap.docs) {
                const e = d.data();
                if ((e.cnpj || '').replace(/\D/g, '') === cnpjLimpo) {
                    dadosFiscais = e.dadosFiscais || {};
                    break;
                }
            }
            if (dadosFiscais) break;
        }

        return res.json({
            email: dadosFiscais?.email || '',
            telefone: dadosFiscais?.telefone || '',
        });
    } catch (err) {
        console.error('[empresa-contato]', err);
        return respondeErro(res, err);
    }
});

// ─── Detector de Anomalias DAS ─────────────────────────────────────────────
function mediaArr(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }
function desvioArr(arr) {
    if (arr.length < 2) return 0;
    const m = mediaArr(arr);
    const v = arr.reduce((s, x) => s + Math.pow(x - m, 2), 0) / arr.length;
    return Math.sqrt(v);
}

function detectarAnomalias(empresa) {
    const anomalias = [];
    const historico = (empresa.historicoCalculos || [])
        .slice()
        .sort((a, b) => (a.dataCalculo || 0) - (b.dataCalculo || 0));

    if (historico.length < 4) {
        return { anomalias: [], aviso: 'Historico insuficiente (precisa 4+ meses).' };
    }

    // 1. Salto de faturamento (proxy: das_mensal/aliq_eff = faturamento aproximado)
    const faturamentos = historico.map(h => {
        const aliq = h.aliq_eff || 0;
        return aliq > 0 ? (h.das_mensal || 0) / (aliq / 100) : 0;
    });
    const ultimoFat = faturamentos[faturamentos.length - 1];
    const fatsAnteriores = faturamentos.slice(0, -1);
    const mediaFat = mediaArr(fatsAnteriores);
    const desvioFat = desvioArr(fatsAnteriores);
    if (mediaFat > 0 && desvioFat > 0) {
        const z = (ultimoFat - mediaFat) / desvioFat;
        if (Math.abs(z) >= 2) {
            const direcao = z > 0 ? 'pico' : 'queda';
            const pctMudanca = ((ultimoFat - mediaFat) / mediaFat * 100).toFixed(1);
            anomalias.push({
                tipo: 'salto_faturamento',
                severidade: Math.abs(z) >= 3 ? 'alta' : 'media',
                competencia: historico[historico.length - 1].mesReferencia,
                descricao: `Faturamento estimado teve ${direcao} de ${pctMudanca}% vs media dos ultimos meses (z-score=${z.toFixed(2)})`,
                dados: {
                    valorAtual: +ultimoFat.toFixed(2),
                    mediaHistorica: +mediaFat.toFixed(2),
                    desvioPadrao: +desvioFat.toFixed(2),
                    zScore: +z.toFixed(2),
                },
            });
        }
    }

    // 2. Mudanca de anexo efetivo (provavel oscilacao Fator R)
    for (let i = 1; i < historico.length; i++) {
        if (historico[i].anexo_efetivo !== historico[i - 1].anexo_efetivo) {
            anomalias.push({
                tipo: 'mudanca_anexo',
                severidade: 'media',
                competencia: historico[i].mesReferencia,
                descricao: `Anexo efetivo mudou de ${historico[i - 1].anexo_efetivo} para ${historico[i].anexo_efetivo}. Provavel oscilacao do Fator R.`,
                dados: {
                    anexoAnterior: historico[i - 1].anexo_efetivo,
                    anexoAtual: historico[i].anexo_efetivo,
                    fatorR: historico[i].fator_r,
                },
            });
        }
    }

    // 3. Aliquota efetiva caiu mais de 20% sem queda proporcional do RBT12
    if (historico.length >= 2) {
        const ult = historico[historico.length - 1];
        const ant = historico[historico.length - 2];
        if (ant.aliq_eff > 0 && ult.aliq_eff > 0) {
            const quedaAliq = (ant.aliq_eff - ult.aliq_eff) / ant.aliq_eff;
            const quedaRbt = ant.rbt12 > 0 ? (ant.rbt12 - ult.rbt12) / ant.rbt12 : 0;
            if (quedaAliq > 0.2 && quedaRbt < 0.10) {
                anomalias.push({
                    tipo: 'das_abaixo_esperado',
                    severidade: 'alta',
                    competencia: ult.mesReferencia,
                    descricao: `Aliquota caiu ${(quedaAliq * 100).toFixed(1)}% mas RBT12 so caiu ${(quedaRbt * 100).toFixed(1)}%. Possivel erro de classificacao CNAE ou anexo.`,
                    dados: {
                        aliqAnterior: +ant.aliq_eff.toFixed(2),
                        aliqAtual: +ult.aliq_eff.toFixed(2),
                        rbt12Anterior: +ant.rbt12.toFixed(2),
                        rbt12Atual: +ult.rbt12.toFixed(2),
                    },
                });
            }
        }
    }

    return { anomalias };
}

app.get('/api/admin/das/anomalias/:empresaId', requireAdmin, async (req, res) => {
    try {
        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const db = adminMod.firestore();

        const snap = await db.collection('simples_empresas').doc(req.params.empresaId).get();
        if (!snap.exists) return res.status(404).json({ error: 'empresa nao encontrada' });

        const emp = { id: snap.id, ...snap.data() };
        // 23/05: bloqueia perdedores do merge de duplicatas
        if (emp._merged_into) return res.status(410).json({ error: 'empresa consolidada', mergedInto: emp._merged_into });
        const result = detectarAnomalias(emp);

        return res.json({
            empresa: { id: emp.id, nome: emp.nome, cnpj: emp.cnpj, anexo: emp.anexo },
            ...result,
            geradoEm: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[das/anomalias]', err);
        return respondeErro(res, err);
    }
});

// Endpoint global: scaneia todas as empresas e retorna as que tem anomalias
app.get('/api/admin/das/anomalias-todas', requireAdmin, async (req, res) => {
    try {
        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const db = adminMod.firestore();

        const snap = await db.collection('simples_empresas').get();
        const resultados = [];
        snap.forEach(d => {
            const emp = { id: d.id, ...d.data() };
            if (emp._merged_into) return; // 23/05: ignora perdedores do merge
            const r = detectarAnomalias(emp);
            if (r.anomalias && r.anomalias.length > 0) {
                resultados.push({
                    empresaId: emp.id,
                    empresaNome: emp.nome,
                    empresaCnpj: emp.cnpj,
                    qtdAnomalias: r.anomalias.length,
                    severidadeMax: r.anomalias.some(a => a.severidade === 'alta') ? 'alta' : 'media',
                    anomalias: r.anomalias,
                });
            }
        });
        resultados.sort((a, b) => {
            if (a.severidadeMax !== b.severidadeMax) return a.severidadeMax === 'alta' ? -1 : 1;
            return b.qtdAnomalias - a.qtdAnomalias;
        });

        return res.json({
            geradoEm: new Date().toISOString(),
            totalEmpresas: snap.size,
            empresasComAnomalia: resultados.length,
            resultados,
        });
    } catch (err) {
        console.error('[das/anomalias-todas]', err);
        return respondeErro(res, err);
    }
});

app.post('/api/admin/das/anomalia-explicar', requireAdmin, requireAI, async (req, res) => {
    try {
        const { empresaNome, empresaAnexo, anomalia } = req.body;
        if (!anomalia) return res.status(400).json({ error: 'anomalia obrigatoria' });

        const prompt = `Voce eh um consultor fiscal senior. Analise esta anomalia detectada na apuracao DAS Simples Nacional:

Empresa: ${empresaNome} (Anexo ${empresaAnexo || 'I-V'})
Anomalia tipo: ${anomalia.tipo}
Competencia: ${anomalia.competencia || 'N/I'}
Descricao: ${anomalia.descricao}
Dados: ${JSON.stringify(anomalia.dados, null, 2)}

Em portugues brasileiro, em 2-3 paragrafos curtos:
1. **Causas provaveis:** o que pode ter gerado essa anomalia (3-4 hipoteses concretas)
2. **Impacto fiscal:** o que pode acontecer se isso passar despercebido (multa? autuacao? perda do regime?)
3. **Acao recomendada:** o que o contador deve fazer agora (verificar PGDAS, conferir CNAE, conversar com cliente, etc).

Use **negrito** nos pontos-chave. Seja direto, sem rodeios.`;

        const escolhido = pickGeminiModel({ prompt, hasAttachment: false });
        logGeminiRoute(escolhido, { rota: 'das-anomalia-ia', tipo: anomalia.tipo });
        const response = await ai.models.generateContent({
            model: escolhido,
            contents: prompt,
        });

        return res.json({
            analise: response.text ?? '',
            modelo: escolhido,
            geradoEm: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[das/anomalia-explicar]', err);
        return respondeErro(res, err);
    }
});

// ─── Cobranca DAS via IA ───────────────────────────────────────────────────
// POST /api/admin/das/cobranca-ia
// Gera draft de email/whatsapp pro cliente. NUNCA envia automaticamente.
app.post('/api/admin/das/cobranca-ia', requireAuth, requireAI, async (req, res) => {
    try {
        const {
            empresaCnpj, empresaNome, valor, competencia, vencimento, diasAtraso,
            tom, assinante, canal, numeroDocumento, codigoBarras, hasPdf,
        } = req.body;
        if (!empresaNome || !valor) {
            return res.status(400).json({ error: 'empresaNome e valor obrigatorios' });
        }
        if (empresaCnpj || req.user?.role !== 'admin') {
            const acesso = await podeAcessarCnpj(req.user, empresaCnpj);
            if (!acesso.ok) return res.status(acesso.status).json({ error: acesso.error });
        }

        const emAtraso = Number(diasAtraso || 0) > 0;
        const tomMsg = tom === 'firme'
            ? (emAtraso
                ? 'tom profissional, direto e firme. Sem rodeios. Mencione consequencias do atraso (juros 0,33% ao dia + multa 20% conforme legislacao).'
                : 'tom profissional, direto e firme. Sem rodeios. Trate como guia pendente de pagamento, sem afirmar atraso.')
            : 'tom cordial, profissional e empatico. Convide a regularizacao sem ameacar.';

        const canalMsg = canal === 'whatsapp'
            ? 'mensagem de WhatsApp curta (200-400 caracteres). Use quebras de linha. Sem cumprimento formal de email. Sem assunto.'
            : 'corpo de email profissional (5-8 linhas). Comece com saudacao curta. Termine com a assinatura.';

        const valorBR = `R$ ${(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

        const prompt = `Voce eh o assistente fiscal de uma contabilidade brasileira (SP Assessoria Contabil).
Gere uma mensagem pro cliente sobre DAS Simples Nacional ${emAtraso ? 'vencido' : 'pendente de pagamento'}.

Dados:
- Empresa: ${empresaNome}
- Valor: ${valorBR}
- Competencia (mes referencia): ${competencia || 'N/I'}
- Vencimento: ${vencimento || 'N/I'}
- Dias em atraso: ${emAtraso ? diasAtraso : 0} dias
- Numero do documento: ${numeroDocumento || 'nao retornado'}
- Codigo de barras/linha digitavel: ${codigoBarras || 'nao retornado'}
- PDF disponivel para o operador anexar: ${hasPdf ? 'sim' : 'nao'}
- Assinante: ${assinante || 'Equipe SP Contabil'}

Tom: ${tomMsg}

Formato: ${canalMsg}

REGRAS IMPORTANTES:
- NAO invente prazos, multas ou juros especificos alem dos padroes legais (0,33% dia + 20%).
- NAO mencione bloqueios bancarios nem ameacas vagas.
- NAO use emojis (mensagem profissional).
- Se o DAS ainda nao venceu, nao trate como atraso e nao fale em juros/multa.
- Se o codigo de barras foi informado, inclua exatamente uma vez no final da mensagem.
- Se o codigo de barras nao foi informado, nao diga que o cliente ja consegue pagar sozinho com dados incompletos.
- NAO diga que o PDF segue em anexo; o sistema abre o canal e o operador anexa manualmente quando aplicavel.
- Se for email: monte um assunto curto e direto na PRIMEIRA linha, prefixado com 'ASSUNTO:' e o corpo nas linhas seguintes apos uma linha em branco.
- Mencione o nome do cliente/empresa no corpo.
- Seja claro sobre o que precisa ser feito (regularizar pagamento).

${canal === 'whatsapp' ? 'Comece direto sem assunto.' : 'Comece com ASSUNTO: ...'}`;

        const escolhido = pickGeminiModel({ prompt, hasAttachment: false });
        logGeminiRoute(escolhido, { rota: 'das-cobranca-ia', tom, canal, chars: prompt.length });
        const response = await ai.models.generateContent({
            model: escolhido,
            contents: prompt,
        });

        const texto = (response.text ?? '').trim();
        let assunto = '', mensagem = texto;
        if (canal !== 'whatsapp') {
            const m = texto.match(/^ASSUNTO:\s*(.+?)$/im);
            if (m) {
                assunto = m[1].trim();
                mensagem = texto.replace(m[0], '').trim();
            }
        }

        return res.json({
            assunto,
            mensagem,
            modelo: escolhido,
            geradoEm: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[das/cobranca-ia]', err);
        return respondeErro(res, err);
    }
});

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function textoParaHtml(texto) {
    return escapeHtml(texto).replace(/\n/g, '<br>');
}

function limparBase64Pdf(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.includes(',') ? (raw.split(',').pop() || '').replace(/\s/g, '') : raw.replace(/\s/g, '');
}

// POST /api/admin/das/enviar-cliente
// Envia e-mail real via Microsoft Graph. WhatsApp continua manual por wa.me.
app.post('/api/admin/das/enviar-cliente', requireAuth, async (req, res) => {
    try {
        const {
            dasId, empresaCnpj, empresaNome, competencia, valor, vencimento,
            emailDest, assunto, mensagem, pdfBase64, pdfFileName,
        } = req.body || {};
        if (!empresaCnpj || !empresaNome) return res.status(400).json({ error: 'empresaCnpj e empresaNome obrigatorios' });
        if (!emailDest || !String(emailDest).includes('@')) return res.status(400).json({ error: 'E-mail do cliente invalido ou ausente' });
        if (!mensagem) return res.status(400).json({ error: 'Mensagem obrigatoria' });

        const acesso = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!acesso.ok) return res.status(acesso.status).json({ error: acesso.error });

        const pdfLimpo = limparBase64Pdf(pdfBase64);
        if (pdfLimpo && pdfLimpo.length > 4_000_000) {
            return res.status(413).json({ error: 'PDF muito grande para envio por e-mail automatico' });
        }

        const remetente = process.env.GRAPH_REMETENTE || process.env.NOTIF_REMETENTE_EMAIL || 'junior@spassessoriacontabil.com.br';
        // Copia oculta (BCC) automatica pro gestor em todo envio de DAS ao
        // cliente — o cliente nao ve o endereco interno. Configuravel via
        // DAS_ENVIO_BCC (lista separada por virgula; DAS_ENVIO_CC aceito por
        // compatibilidade); nao duplica quando o gestor ja e o destinatario.
        const copiaGestor = parseDestinatarios(process.env.DAS_ENVIO_BCC || process.env.DAS_ENVIO_CC, 'alexandre@spassessoriacontabil.com.br')
            .filter(cc => cc.toLowerCase() !== String(emailDest).trim().toLowerCase());
        const anexos = pdfLimpo ? [{
            name: pdfFileName || `das_${String(empresaCnpj).replace(/\D/g, '')}_${competencia || 'competencia'}.pdf`,
            contentType: 'application/pdf',
            contentBytes: pdfLimpo,
        }] : [];
        const assuntoFinal = assunto || `DAS Simples Nacional - ${empresaNome}`;
        const corpoHtml = [
            `<p>${textoParaHtml(mensagem)}</p>`,
            '<hr>',
            '<p style="font-size:12px;color:#64748b">',
            `Enviado pelo Consultor Fiscal Inteligente em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
            pdfLimpo ? ' PDF do DAS anexado.' : ' PDF nao estava disponivel no retorno SERPRO.',
            '</p>',
        ].join('');

        const envio = await enviarEmail({
            remetente,
            para: emailDest,
            bcc: copiaGestor,
            assunto: assuntoFinal,
            corpoHtml,
            anexos,
        });
        if (!envio.ok) return res.status(502).json({ error: envio.error || 'Falha ao enviar e-mail' });

        try {
            const adminMod = (await import('firebase-admin')).default;
            if (!adminMod.apps.length) {
                adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
            }
            const db = adminMod.firestore();
            const log = {
                dasId: dasId || null,
                empresaCnpj: String(empresaCnpj).replace(/\D/g, ''),
                empresaNome,
                competencia: competencia || null,
                valor: Number(valor || 0),
                vencimento: vencimento || null,
                canal: 'email',
                para: emailDest,
                copiaPara: copiaGestor,
                assunto: assuntoFinal,
                mensagem: String(mensagem).slice(0, 10_000),
                anexouPdf: Boolean(pdfLimpo),
                enviadoPor: req.user?.email || req.user?.uid || null,
                enviadoEm: adminMod.firestore.FieldValue.serverTimestamp(),
            };
            await db.collection('das_envios_cliente').add(log);
            if (dasId) {
                await db.collection('das_emitidos').doc(dasId).set({
                    ultimoEnvioCliente: {
                        canal: 'email',
                        para: emailDest,
                        copiaPara: copiaGestor,
                        anexouPdf: Boolean(pdfLimpo),
                        enviadoPor: req.user?.email || req.user?.uid || null,
                        enviadoEm: new Date().toISOString(),
                    },
                }, { merge: true });
            }
        } catch (logErr) {
            console.warn('[das/enviar-cliente] envio OK, log falhou:', logErr.message);
        }

        return res.json({ ok: true, canal: 'email', para: emailDest, copiaPara: copiaGestor, anexouPdf: Boolean(pdfLimpo) });
    } catch (err) {
        console.error('[das/enviar-cliente]', err);
        return respondeErro(res, err);
    }
});

// GET /api/admin/das/envios-cliente?cnpj=&dasId=&limit=
// Historico de envios de DAS ao cliente (coleção das_envios_cliente).
// Admin ve tudo; colaborador ve apenas empresas da sua carteira.
app.get('/api/admin/das/envios-cliente', requireAuth, async (req, res) => {
    try {
        const cnpjFiltro = String(req.query.cnpj || '').replace(/\D/g, '');
        const dasIdFiltro = String(req.query.dasId || '').trim();
        const limite = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);

        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const db = adminMod.firestore();

        // Filtros com igualdade nao exigem indice composto; ordenacao em memoria.
        let q = db.collection('das_envios_cliente');
        if (cnpjFiltro) q = q.where('empresaCnpj', '==', cnpjFiltro);
        if (dasIdFiltro) q = q.where('dasId', '==', dasIdFiltro);
        const snap = await q.limit(500).get();

        const cnpjsCarteira = await getCnpjsDaCarteira(req.user); // null = admin
        const envios = snap.docs
            .map(d => {
                const x = d.data();
                return {
                    id: d.id,
                    dasId: x.dasId || null,
                    empresaCnpj: x.empresaCnpj || '',
                    empresaNome: x.empresaNome || '',
                    competencia: x.competencia || null,
                    valor: Number(x.valor || 0),
                    vencimento: x.vencimento || null,
                    canal: x.canal || 'email',
                    para: x.para || '',
                    copiaPara: Array.isArray(x.copiaPara) ? x.copiaPara : [],
                    assunto: x.assunto || '',
                    mensagem: x.mensagem || null,
                    anexouPdf: Boolean(x.anexouPdf),
                    enviadoPor: x.enviadoPor || null,
                    enviadoEm: x.enviadoEm?.toDate?.()?.toISOString() || null,
                };
            })
            .filter(e => cnpjsCarteira === null || cnpjsCarteira.includes(e.empresaCnpj))
            .sort((a, b) => (b.enviadoEm || '').localeCompare(a.enviadoEm || ''))
            .slice(0, limite);

        return res.json({ envios, total: envios.length });
    } catch (err) {
        console.error('[das/envios-cliente]', err);
        return respondeErro(res, err);
    }
});

// ─── SharePoint (Microsoft Graph API) ─────────────────────────────────────
// Rotas administrativas pra configurar/testar acesso ao SharePoint.
// Permissao: apenas admin.

// GET /api/admin/sharepoint/test-auth
//   Valida credenciais OAuth2 + resolve site ID. Nao expoe secret.
app.get('/api/admin/sharepoint/test-auth', requireAdmin, async (req, res) => {
    try {
        const info = await sharepoint.testAuth();
        return res.json({ ok: true, info });
    } catch (err) {
        console.error('[sharepoint/test-auth]', err);
        return res.status(500).json({
            ok: false,
            error: err.message,
            hint: 'Se erro for "invalid_client", o CLIENT_SECRET no Secret Manager pode estar incorreto ou expirado.',
        });
    }
});

// POST /api/admin/sharepoint/grant-site
//   Autoriza este app a ler o site especifico. Roda 1 vez apos
//   configurar permissoes Sites.Selected no Azure.
//   Idempotente — chamar 2x cria 2 permissoes identicas, sem dano.
app.post('/api/admin/sharepoint/grant-site', requireAdmin, async (req, res) => {
    try {
        const permission = await sharepoint.grantAppPermissionOnSite();
        return res.json({
            ok: true,
            permission,
            message: 'App autorizado a ler o site. Daqui pra frente, list-files/list-folders devem funcionar.',
        });
    } catch (err) {
        console.error('[sharepoint/grant-site]', err);
        return res.status(500).json({
            ok: false,
            error: err.message,
            hint: 'Se 403 Insufficient privileges, o app precisa de Sites.FullControl.All temporariamente OU um admin SharePoint precisa autorizar via portal.',
        });
    }
});

// GET /api/admin/sharepoint/list-drives
//   Lista bibliotecas de documentos do site.
app.get('/api/admin/sharepoint/list-drives', requireAdmin, async (req, res) => {
    try {
        const drives = await sharepoint.listDrives();
        return res.json({ ok: true, drives });
    } catch (err) {
        console.error('[sharepoint/list-drives]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// GET /api/admin/sharepoint/list-root
//   Lista raiz do drive default (pastas e arquivos no nivel raiz).
app.get('/api/admin/sharepoint/list-root', requireAdmin, async (req, res) => {
    try {
        const items = await sharepoint.listRootItems();
        return res.json({ ok: true, items });
    } catch (err) {
        console.error('[sharepoint/list-root]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// POST /api/admin/sharepoint/test-write
//   Cria pasta /Empresas/_test/ + arquivo dentro pra validar escrita.
app.post('/api/admin/sharepoint/test-write', requireAdmin, async (req, res) => {
    try {
        const testPath = 'Empresas/_test_cfi';
        const fileName = `test_${Date.now()}.txt`;
        const fullPath = `${testPath}/${fileName}`;
        const conteudo = `Teste de escrita CFI - ${new Date().toISOString()}\n` +
                         `Se voce esta lendo isso, o app conseguiu escrever no SharePoint.`;

        // 1. Garante pasta
        const folder = await sharepoint.ensureFolder(testPath);
        // 2. Upload arquivo
        const file = await sharepoint.uploadSmallFile(fullPath, conteudo, 'text/plain');

        return res.json({
            ok: true,
            message: 'Escrita funcionou!',
            folderCreated: { id: folder.id, name: folder.name, webUrl: folder.webUrl },
            fileCreated: { id: file.id, name: file.name, webUrl: file.webUrl, size: file.size },
            verification: `Acesse ${folder.webUrl} pra ver`,
        });
    } catch (err) {
        console.error('[sharepoint/test-write]', err);
        return res.status(500).json({
            ok: false,
            error: err.message,
            hint: 'Se 403 accessDenied, precisa Files.ReadWrite.All no Azure + role write na permissao do site.',
        });
    }
});

// GET /api/admin/sharepoint/check-folder?cnpj=...&tipo=XMLs&periodo=2026-05
//   Verifica se uma pasta de empresa existe (idempotencia).
app.get('/api/admin/sharepoint/check-folder', requireAdmin, async (req, res) => {
    try {
        const { cnpj, tipo = 'XMLs', periodo } = req.query;
        if (!cnpj) return res.status(400).json({ error: 'cnpj obrigatorio' });

        const folderPath = sharepoint.buildEmpresaPath(cnpj, tipo, periodo);
        const meta = await sharepoint.itemExists(folderPath);
        return res.json({
            ok: true,
            exists: !!meta,
            folderPath,
            metadata: meta ? { id: meta.id, name: meta.name, webUrl: meta.webUrl } : null,
        });
    } catch (err) {
        console.error('[sharepoint/check-folder]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// GET /api/admin/sharepoint/empresa-folder?cnpj=...
//   Retorna URL clicavel pra pasta da empresa (pra UI).
app.get('/api/admin/sharepoint/empresa-folder', requireAdmin, async (req, res) => {
    try {
        const { cnpj } = req.query;
        if (!cnpj) return res.status(400).json({ error: 'cnpj obrigatorio' });

        const url = await sharepoint.getEmpresaFolderUrl(cnpj);
        return res.json({
            ok: true,
            exists: !!url,
            webUrl: url,
        });
    } catch (err) {
        console.error('[sharepoint/empresa-folder]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// POST /api/admin/sharepoint/upload-xml
//   Body: { cnpj, periodo: 'YYYY-MM', fileName: 'NFe123.xml', xmlContent: '<xml>...</xml>' }
//   Upload manual de XML pra empresa (usado depois pelo cron).
app.post('/api/admin/sharepoint/upload-xml', requireAdmin, async (req, res) => {
    try {
        const { cnpj, periodo, fileName, xmlContent } = req.body || {};
        if (!cnpj || !periodo || !fileName || !xmlContent) {
            return res.status(400).json({
                error: 'campos obrigatorios: cnpj, periodo (YYYY-MM), fileName, xmlContent',
            });
        }

        const result = await sharepoint.uploadXmlParaEmpresa(cnpj, periodo, fileName, xmlContent);
        return res.json({ ok: true, ...result });
    } catch (err) {
        console.error('[sharepoint/upload-xml]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// POST /api/admin/sharepoint/upload-relatorio
//   Body: { cnpj, subPath: 'PGDAS/2026-05.pdf', content: base64, mimeType: 'application/pdf' }
//   Upload de relatorio pra empresa.
app.post('/api/admin/sharepoint/upload-relatorio', requireAdmin, async (req, res) => {
    try {
        const { cnpj, subPath, content, mimeType = 'application/pdf', encoding = 'base64' } = req.body || {};
        if (!cnpj || !subPath || !content) {
            return res.status(400).json({
                error: 'campos obrigatorios: cnpj, subPath, content (base64 ou utf-8)',
            });
        }

        const buf = encoding === 'base64'
            ? Buffer.from(content, 'base64')
            : Buffer.from(content, 'utf-8');

        const result = await sharepoint.uploadRelatorioParaEmpresa(cnpj, subPath, buf, mimeType);
        return res.json({ ok: true, ...result, sizeBytes: buf.length });
    } catch (err) {
        console.error('[sharepoint/upload-relatorio]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// GET /api/admin/sharepoint/sync-dry-run?cnpj=&periodo=2026-05
//   Pre-visualizacao: lista o que SERIA sincronizado, sem subir nada.
app.get('/api/admin/sharepoint/sync-dry-run', requireAdmin, async (req, res) => {
    try {
        const { cnpj, periodo } = req.query;
        if (!cnpj || !periodo) {
            return res.status(400).json({ error: 'cnpj e periodo obrigatorios' });
        }

        const stats = await sharepointSync.syncEmpresaPeriodo({
            cnpj, periodo, dryRun: true,
        });
        return res.json({ ok: true, ...stats });
    } catch (err) {
        console.error('[sharepoint/sync-dry-run]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// POST /api/admin/sharepoint/sync-empresa
//   Body: { cnpj, periodo: 'YYYY-MM', force: bool }
//   Sincroniza uma empresa+periodo. Idempotente (skipa o que ja foi).
//   force=true re-uploada tudo.
app.post('/api/admin/sharepoint/sync-empresa', requireAdmin, async (req, res) => {
    try {
        const { cnpj, periodo, force = false } = req.body || {};
        if (!cnpj || !periodo) {
            return res.status(400).json({ error: 'cnpj e periodo obrigatorios' });
        }

        const stats = await sharepointSync.syncEmpresaPeriodo({
            cnpj, periodo, force,
        });
        return res.json({ ok: true, ...stats });
    } catch (err) {
        console.error('[sharepoint/sync-empresa]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// POST /api/admin/sharepoint/sync-all
//   Body: { periodo: 'YYYY-MM', force: bool, maxEmpresas: int }
//   Sincroniza TODAS as empresas (simples + lucro) pro periodo.
//   Usado pelo cron noturno + botao admin.
app.post('/api/admin/sharepoint/sync-all', requireAdmin, async (req, res) => {
    try {
        const { periodo, force = false, maxEmpresas = null } = req.body || {};
        if (!periodo) return res.status(400).json({ error: 'periodo obrigatorio' });

        const stats = await sharepointSync.syncAllEmpresas({
            periodo, force, maxEmpresas,
        });
        return res.json({ ok: true, ...stats });
    } catch (err) {
        console.error('[sharepoint/sync-all]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// GET /api/admin/sharepoint/sync-log?limit=10
//   Retorna as N ultimas execucoes do cron (ou manual via sync-all).
app.get('/api/admin/sharepoint/sync-log', requireAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const db = adminMod.firestore();
        const snap = await db.collection('sharepoint_sync_log')
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();

        const logs = [];
        snap.forEach(s => {
            const d = s.data();
            logs.push({
                id: s.id,
                periodo: d.periodo,
                empresasProcessadas: d.empresasProcessadas,
                empresasComErro: d.empresasComErro,
                totalDocsSincronizados: d.totalDocsSincronizados,
                totalDocsJaSincronizados: d.totalDocsJaSincronizados,
                totalDocsSemXml: d.totalDocsSemXml,
                totalDocsErros: d.totalDocsErros,
                startedAt: d.startedAt,
                finishedAt: d.finishedAt,
                empresasCount: (d.empresas || []).length,
            });
        });

        return res.json({ ok: true, logs });
    } catch (err) {
        console.error('[sharepoint/sync-log]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// DELETE /api/admin/sharepoint/cleanup-test
//   Remove pasta de teste apos validacao.
app.delete('/api/admin/sharepoint/cleanup-test', requireAdmin, async (req, res) => {
    try {
        const result = await sharepoint.deleteItem('Empresas/_test_cfi');
        return res.json({ ok: true, ...result });
    } catch (err) {
        console.error('[sharepoint/cleanup-test]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// GET /api/admin/sharepoint/list-folder?path=Pasta1/Subpasta
//   Lista items de pasta especifica.
app.get('/api/admin/sharepoint/list-folder', requireAdmin, async (req, res) => {
    try {
        const path = req.query.path || '/';
        const items = await sharepoint.listFolderItems(path);
        return res.json({ ok: true, path, items });
    } catch (err) {
        console.error('[sharepoint/list-folder]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// GET /api/admin/sharepoint/list-permissions
//   Lista permissoes ativas do app no site (debug do grant-site).
app.get('/api/admin/sharepoint/list-permissions', requireAdmin, async (req, res) => {
    try {
        const perms = await sharepoint.listSitePermissions();
        return res.json({ ok: true, perms });
    } catch (err) {
        console.error('[sharepoint/list-permissions]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// ─── Simulador IBS/CBS Reforma Tributaria 2026-2033 ────────────────────────
// Calcula carga tributaria projetada por ano segundo LC 214/2025.
// Aliquotas estimativas: CBS 8,8%, IBS 17,7%, total IVA Dual 26,5%.

const REFORMA_CRONOGRAMA = {
    2026: { cbsTeste: 0.009, ibsTeste: 0.001, regimeAtivo: true,  ibsPct: 0,    icmsIssPct: 1.0 },
    2027: { cbsTeste: 0,     ibsTeste: 0.001, regimeAtivo: true,  ibsPct: 0,    icmsIssPct: 1.0, cbsCheia: 0.088 },
    2028: { cbsTeste: 0,     ibsTeste: 0.001, regimeAtivo: false, ibsPct: 0,    icmsIssPct: 1.0, cbsCheia: 0.088 },
    2029: { cbsTeste: 0,     ibsTeste: 0,     regimeAtivo: false, ibsPct: 0.10, icmsIssPct: 0.90, cbsCheia: 0.088, ibsCheia: 0.177 },
    2030: { cbsTeste: 0,     ibsTeste: 0,     regimeAtivo: false, ibsPct: 0.20, icmsIssPct: 0.80, cbsCheia: 0.088, ibsCheia: 0.177 },
    2031: { cbsTeste: 0,     ibsTeste: 0,     regimeAtivo: false, ibsPct: 0.30, icmsIssPct: 0.70, cbsCheia: 0.088, ibsCheia: 0.177 },
    2032: { cbsTeste: 0,     ibsTeste: 0,     regimeAtivo: false, ibsPct: 0.40, icmsIssPct: 0.60, cbsCheia: 0.088, ibsCheia: 0.177 },
    2033: { cbsTeste: 0,     ibsTeste: 0,     regimeAtivo: false, ibsPct: 1.00, icmsIssPct: 0,    cbsCheia: 0.088, ibsCheia: 0.177 },
};

function simularAnoSimples(ano, faturamentoAnual, dasAtual) {
    // Simples Nacional MANTEM o regime unico (DAS) ate 2033.
    // Empresas Simples NAO destacam CBS/IBS na nota em 2026.
    // A partir de 2027, podem optar por regime hibrido (manter Simples ou ir pro
    // regime regular pra dar credito de IBS/CBS pros clientes B2B).
    return {
        ano,
        regimeMantido: 'Simples Nacional',
        dasAnual: dasAtual,
        cargaTotal: dasAtual,
        observacao: ano >= 2027 ? 'Em 2027, avaliar migracao pra regime regular se cliente B2B exige credito de IBS/CBS' : null,
    };
}

function simularAnoLucroPresumido(ano, faturamentoAnual, regime) {
    const cron = REFORMA_CRONOGRAMA[ano];
    if (!cron) return null;

    // Lucro Presumido tipico: PIS 0,65% + COFINS 3% + IRPJ + CSLL + ICMS/ISS
    // Aqui isolamos APENAS PIS/COFINS/CBS/IBS (impacto direto da reforma)
    // IRPJ/CSLL nao mudam com a reforma.

    const pisAtual = ano <= 2026 ? faturamentoAnual * 0.0065 : 0;
    const cofinsAtual = ano <= 2026 ? faturamentoAnual * 0.03 : 0;

    // CBS
    let cbs = 0;
    if (cron.cbsTeste) {
        cbs = faturamentoAnual * cron.cbsTeste;  // teste, compensavel
    } else if (cron.cbsCheia) {
        cbs = faturamentoAnual * cron.cbsCheia;  // cheia desde 2027
    }

    // IBS
    let ibs = 0;
    if (cron.ibsTeste) {
        ibs = faturamentoAnual * cron.ibsTeste;
    } else if (cron.ibsCheia && cron.ibsPct) {
        ibs = faturamentoAnual * cron.ibsCheia * cron.ibsPct;
    }

    // ICMS/ISS proporcional (assumindo carga combinada media de 18% sobre faturamento -
    // muito variavel, depende UF/atividade. Vamos pedir input do usuario.)
    // Por enquanto: deixa 0 e exige input do regime atual.

    // Compensacao em 2026 (cbs+ibs teste sao compensaveis com pis+cofins)
    let compensacao = 0;
    if (cron.cbsTeste && cron.regimeAtivo) {
        compensacao = Math.min(pisAtual + cofinsAtual, cbs + ibs);
    }

    const cargaPisCofins = pisAtual + cofinsAtual - compensacao;
    const cargaIvaDual = cbs + ibs;
    const cargaTotal = cargaPisCofins + cargaIvaDual;

    return {
        ano,
        regime: 'Lucro Presumido',
        pisAtual: +pisAtual.toFixed(2),
        cofinsAtual: +cofinsAtual.toFixed(2),
        cbs: +cbs.toFixed(2),
        ibs: +ibs.toFixed(2),
        compensacao: +compensacao.toFixed(2),
        cargaPisCofinsLiquida: +cargaPisCofins.toFixed(2),
        cargaIvaDualLiquida: +cargaIvaDual.toFixed(2),
        cargaTotal: +cargaTotal.toFixed(2),
        cargaPctFaturamento: faturamentoAnual > 0 ? +(cargaTotal / faturamentoAnual * 100).toFixed(2) : 0,
    };
}

function simularAnoLucroReal(ano, faturamentoAnual, regime) {
    const cron = REFORMA_CRONOGRAMA[ano];
    if (!cron) return null;

    // Lucro Real nao-cumulativo: PIS 1,65% + COFINS 7,6% sobre faturamento bruto.
    // Mas tem direito a credito sobre insumos. Simplificacao: assumimos credito de
    // 60% (carga liquida ~3,7% PIS+COFINS, valor empirico pra empresas medias).

    const pisCofinsBruto = ano <= 2026 ? faturamentoAnual * (0.0165 + 0.076) : 0;
    const pisCofinsLiquido = pisCofinsBruto * 0.4;  // 60% de credito assumido

    let cbs = 0;
    if (cron.cbsTeste) cbs = faturamentoAnual * cron.cbsTeste;
    else if (cron.cbsCheia) cbs = faturamentoAnual * cron.cbsCheia * 0.4;  // CBS tem credito amplo

    let ibs = 0;
    if (cron.ibsTeste) ibs = faturamentoAnual * cron.ibsTeste;
    else if (cron.ibsCheia && cron.ibsPct) ibs = faturamentoAnual * cron.ibsCheia * cron.ibsPct * 0.4;

    let compensacao = 0;
    if (cron.cbsTeste && cron.regimeAtivo) {
        compensacao = Math.min(pisCofinsLiquido, cbs + ibs);
    }

    const cargaTotal = (pisCofinsLiquido - compensacao) + cbs + ibs;

    return {
        ano,
        regime: 'Lucro Real',
        pisCofinsLiquido: +pisCofinsLiquido.toFixed(2),
        cbs: +cbs.toFixed(2),
        ibs: +ibs.toFixed(2),
        compensacao: +compensacao.toFixed(2),
        cargaTotal: +cargaTotal.toFixed(2),
        cargaPctFaturamento: faturamentoAnual > 0 ? +(cargaTotal / faturamentoAnual * 100).toFixed(2) : 0,
    };
}

app.post('/api/admin/simulador-ibs-cbs', requireAdmin, async (req, res) => {
    try {
        const { faturamentoAnual, regime, dasAtualAnual } = req.body || {};
        if (!faturamentoAnual || faturamentoAnual <= 0) {
            return res.status(400).json({ error: 'faturamentoAnual obrigatorio (>0)' });
        }
        if (!['Simples', 'Presumido', 'Real'].includes(regime)) {
            return res.status(400).json({ error: 'regime deve ser Simples, Presumido ou Real' });
        }

        const projecoes = [];
        for (const ano of [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033]) {
            let p;
            if (regime === 'Simples') {
                p = simularAnoSimples(ano, faturamentoAnual, dasAtualAnual || 0);
            } else if (regime === 'Presumido') {
                p = simularAnoLucroPresumido(ano, faturamentoAnual, regime);
            } else {
                p = simularAnoLucroReal(ano, faturamentoAnual, regime);
            }
            if (p) projecoes.push(p);
        }

        return res.json({
            faturamentoAnual,
            regime,
            projecoes,
            cronograma: REFORMA_CRONOGRAMA,
            premissas: {
                cbsCheia: '8,8% (estimativa Tax Group/Fiscoplan)',
                ibsCheia: '17,7% (estimativa)',
                ivaDualTotal: '~26,5%',
                creditoLucroReal: '60% assumido (varia por setor)',
                fonte: 'LC 214/2025',
            },
            observacoes: [
                'Aliquotas cheias sao ESTIMATIVAS — Senado fixa valores reais em 2026/2028.',
                'Calculo nao inclui IRPJ/CSLL (nao mudam com a reforma).',
                'ICMS/ISS atual nao esta na simulacao (varia muito por UF/atividade).',
                'Simples Nacional mantem DAS unico ate 2033, com opcao em 2027 de migrar pra regime hibrido.',
            ],
            geradoEm: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[simulador-ibs-cbs]', err);
        return respondeErro(res, err);
    }
});

app.post('/api/admin/simulador-ibs-cbs-explicar', requireAdmin, requireAI, async (req, res) => {
    try {
        const { simulacao, empresaNome } = req.body || {};
        if (!simulacao) return res.status(400).json({ error: 'simulacao obrigatoria' });

        const resumoProjecoes = (simulacao.projecoes || []).map(p =>
            `  ${p.ano}: carga total R\$ ${(p.cargaTotal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` +
            (p.cargaPctFaturamento !== undefined ? ` (${p.cargaPctFaturamento}% do faturamento)` : '')
        ).join('\n');

        const prompt = `Voce eh consultor tributario senior. Analise esta projecao de impacto da Reforma Tributaria (LC 214/2025) para a empresa abaixo:

Empresa: ${empresaNome || 'N/I'}
Regime atual: ${simulacao.regime}
Faturamento anual: R\$ ${(simulacao.faturamentoAnual || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

Projecao de carga tributaria (PIS+COFINS+CBS+IBS, sem IRPJ/CSLL/ICMS/ISS):
${resumoProjecoes}

Em portugues brasileiro, em 3 paragrafos curtos:
1. **Impacto financeiro:** o que essa empresa pode esperar nos proximos 7 anos? Carga sobe, cai ou estabiliza?
2. **Riscos:** quais cuidados especificos pra esse regime? (ex: Simples deveria considerar migrar em 2027? Lucro Real precisa rever cadeia de creditos?)
3. **Acoes estrategicas:** 2-3 medidas concretas pra 2026-2027 (sistemas, classificacao, opcao de regime)

Use **negrito** nos pontos-chave. Seja direto, sem rodeios. Nao invente numeros que nao estao na projecao.`;

        const escolhido = pickGeminiModel({ prompt, hasAttachment: false });
        logGeminiRoute(escolhido, { rota: 'simulador-ibs-cbs-ia', regime: simulacao.regime });
        const response = await ai.models.generateContent({
            model: escolhido,
            contents: prompt,
        });

        return res.json({
            analise: response.text ?? '',
            modelo: escolhido,
            geradoEm: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[simulador-ibs-cbs-explicar]', err);
        return respondeErro(res, err);
    }
});

// ─── Conferencia PGDAS-D ───────────────────────────────────────────────────
// POST /api/admin/pgdas/conferir
// Recebe { empresaId, base64Pdf } e retorna comparacao PGDAS vs calculo proprio.
app.post('/api/admin/pgdas/conferir', requireAdmin, requireAI, async (req, res) => {
    try {
        const { empresaId, base64Pdf } = req.body || {};
        if (!empresaId || !base64Pdf) return res.status(400).json({ error: 'empresaId e base64Pdf obrigatorios' });

        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const db = adminMod.firestore();

        // 1. Carrega empresa + historico
        const snap = await db.collection('simples_empresas').doc(empresaId).get();
        if (!snap.exists) return res.status(404).json({ error: 'empresa nao encontrada' });
        const emp = snap.data();
        // 23/05: bloqueia perdedores do merge de duplicatas
        if (emp._merged_into) return res.status(410).json({ error: 'empresa consolidada', mergedInto: emp._merged_into });
        const historico = emp.historicoCalculos || [];

        // 2. Extrai dados ricos do PGDAS via Gemini
        const promptExtrator = `Extraia TODOS os dados deste PGDAS-D em JSON estruturado.

Estrutura esperada (preencha o que conseguir, omita o que nao houver):
{
  "cnpj": "00.000.000/0001-00",
  "competencia": "MM/AAAA",
  "anexoAplicado": "I" | "II" | "III" | "IV" | "V",
  "rbt12": number,
  "rbt12Proporcional": number,
  "faturamentoMes": number,
  "fatorR": number,
  "aliqEfetiva": number,
  "valorDas": number,
  "receitas": {
    "mercadoInternoComercio": number,
    "mercadoInternoIndustria": number,
    "mercadoInternoServicos": number,
    "exportacao": number,
    "comST": number,
    "monofasica": number,
    "retidoNaFonte": number,
    "imunidade": number
  },
  "deducoes": {
    "icmsRetidoST": number,
    "issRetidoFonte": number,
    "outrasRetencoes": number
  },
  "tributosDiscriminados": {
    "irpj": number,
    "csll": number,
    "pis": number,
    "cofins": number,
    "cpp": number,
    "icms": number,
    "iss": number
  }
}

Responda APENAS o JSON, sem markdown, sem comentarios.`;

        let extraido = {};
        try {
            const respExt = await ai.models.generateContent({
                model: GEMINI_MODEL_PRO,
                contents: [
                    { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
                    { text: promptExtrator },
                ],
            });
            const txtExt = (respExt.text || '').trim().replace(/^```json|```$/g, '').trim();
            extraido = JSON.parse(txtExt);
        } catch (e) {
            return respondeErro(res, e, 'extrair-pgdas');
        }

        // 3. Localiza o calculo correspondente do app pela competencia
        const comp = (extraido.competencia || '').replace('/', '-');  // MM/AAAA -> MM-AAAA
        let calculoAppCorrespondente = null;
        if (historico.length > 0) {
            // Busca por mesReferencia que case com a competencia
            // mesReferencia eh tipo 'maio de 2026'; precisamos converter MM/AAAA pra essa forma
            const meses = ['', 'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
                           'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
            const m = (extraido.competencia || '').match(/(\d{2})\/(\d{4})/);
            if (m) {
                const mesNum = parseInt(m[1]);
                const ano = m[2];
                const mesRefBuscado = `${meses[mesNum]} de ${ano}`;
                calculoAppCorrespondente = historico.find(h =>
                    (h.mesReferencia || '').toLowerCase().includes(meses[mesNum]) &&
                    (h.mesReferencia || '').includes(ano)
                );
            }
        }

        // 4. Compara campo a campo
        const divergencias = [];
        const tolerancia = (campo, valPgdas, valApp, pctTol) => {
            if (valPgdas === undefined || valApp === undefined || valApp === 0) return;
            const dif = Math.abs(valPgdas - valApp);
            const pct = (dif / Math.max(valApp, 0.01)) * 100;
            if (pct > pctTol) {
                divergencias.push({
                    campo,
                    valorPgdas: +valPgdas.toFixed(2),
                    valorApp: +valApp.toFixed(2),
                    diferenca: +dif.toFixed(2),
                    diferencaPct: +pct.toFixed(2),
                    severidade: pct > 10 ? 'alta' : pct > 5 ? 'media' : 'baixa',
                });
            }
        };

        if (calculoAppCorrespondente) {
            tolerancia('valorDas', extraido.valorDas, calculoAppCorrespondente.das_mensal, 5);
            tolerancia('aliquotaEfetiva', extraido.aliqEfetiva, calculoAppCorrespondente.aliq_eff, 2);
            tolerancia('rbt12', extraido.rbt12, calculoAppCorrespondente.rbt12, 2);
            tolerancia('fatorR', extraido.fatorR, calculoAppCorrespondente.fator_r, 5);

            // Anexo aplicado: igualdade exata
            if (extraido.anexoAplicado &&
                calculoAppCorrespondente.anexo_efetivo &&
                extraido.anexoAplicado !== calculoAppCorrespondente.anexo_efetivo) {
                divergencias.push({
                    campo: 'anexoAplicado',
                    valorPgdas: extraido.anexoAplicado,
                    valorApp: calculoAppCorrespondente.anexo_efetivo,
                    diferenca: 'ANEXO DIFERENTE',
                    diferencaPct: null,
                    severidade: 'alta',
                });
            }
        }

        // 5. Validacoes que nao precisam de comparacao com o app
        const validacoes = [];
        if (extraido.cnpj && emp.cnpj) {
            const cnpjPgdas = (extraido.cnpj || '').replace(/\D/g, '');
            const cnpjEmp = (emp.cnpj || '').replace(/\D/g, '');
            if (cnpjPgdas && cnpjEmp && cnpjPgdas !== cnpjEmp) {
                validacoes.push({
                    tipo: 'cnpj_divergente',
                    severidade: 'alta',
                    descricao: `CNPJ do PGDAS (${extraido.cnpj}) nao bate com CNPJ da empresa (${emp.cnpj}). PDF errado?`,
                });
            }
        }

        return res.json({
            empresa: { id: emp.id, nome: emp.nome, cnpj: emp.cnpj, anexo: emp.anexo },
            extraido,
            calculoAppCorrespondente,
            divergencias,
            validacoes,
            temCalculoNoApp: !!calculoAppCorrespondente,
            geradoEm: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[pgdas/conferir]', err);
        return respondeErro(res, err);
    }
});

// POST /api/admin/pgdas/conferir-explicar — IA contextualiza divergencias
app.post('/api/admin/pgdas/conferir-explicar', requireAdmin, requireAI, async (req, res) => {
    try {
        const { empresaNome, divergencia, contextoExtraido } = req.body || {};
        if (!divergencia) return res.status(400).json({ error: 'divergencia obrigatoria' });

        const prompt = `Voce eh consultor fiscal senior. Esta divergencia foi detectada na conferencia PGDAS-D vs calculo proprio:

Empresa: ${empresaNome || 'N/I'}
Campo: ${divergencia.campo}
Valor no PGDAS: ${divergencia.valorPgdas}
Valor no app: ${divergencia.valorApp}
Diferenca: ${divergencia.diferenca} (${divergencia.diferencaPct ?? '-'}%)
Severidade: ${divergencia.severidade}

Contexto adicional do PGDAS extraido:
${JSON.stringify(contextoExtraido || {}, null, 2)}

Em portugues brasileiro, em 2 paragrafos curtos:
1. **Causa provavel:** o que pode ter gerado essa divergencia (3-4 hipoteses concretas baseadas nos dados)
2. **Acao recomendada:** o que conferir/corrigir antes de transmitir

Use **negrito** nos pontos-chave. Sem rodeios.`;

        const escolhido = pickGeminiModel({ prompt, hasAttachment: false });
        logGeminiRoute(escolhido, { rota: 'pgdas-conferir-explicar', campo: divergencia.campo });
        const response = await ai.models.generateContent({
            model: escolhido,
            contents: prompt,
        });

        return res.json({
            analise: response.text ?? '',
            modelo: escolhido,
            geradoEm: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[pgdas/conferir-explicar]', err);
        return respondeErro(res, err);
    }
});

// ─── Calendario de Obrigacoes Fiscais ──────────────────────────────────────
// GET /api/admin/calendario/:ano/:mes
// Agrega obrigacoes de Simples + Lucro pro mes solicitado.
// Implementacao centralizada em sefaz-backend/calendario-obrigacoes.js

// Middleware: aceita admin OU colaborador autenticados via Firebase Bearer token.
async function requireAuthOrColab(req, res, next) {
    try {
        const auth = req.headers.authorization || '';
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ error: 'Token ausente' });

        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const decoded = await adminMod.auth().verifyIdToken(m[1]);
        const userDoc = await adminMod.firestore().collection('users').doc(decoded.uid).get();
        if (!userDoc.exists) return res.status(403).json({ error: 'Usuario nao encontrado' });
        const role = userDoc.data().role;
        if (role !== 'admin' && role !== 'colaborador') {
            return res.status(403).json({ error: 'Sem permissao' });
        }
        req.user = { uid: decoded.uid, email: decoded.email || userDoc.data().email, role };
        next();
    } catch (e) {
        console.error('[requireAuthOrColab] erro:', e.message);
        return res.status(401).json({ error: 'Token invalido ou expirado' });
    }
}

app.get('/api/admin/calendario/:ano/:mes', requireAuthOrColab, async (req, res) => {
    try {

        const ano = parseInt(req.params.ano);
        const mes = parseInt(req.params.mes);
        if (!ano || !mes || mes < 1 || mes > 12) {
            return res.status(400).json({ error: 'ano e mes (1-12) obrigatorios' });
        }

        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const db = adminMod.firestore();

        const [simplesSnap, lucroSnap] = await Promise.all([
            db.collection('simples_empresas').get(),
            db.collection('lucro_empresas').get(),
        ]);

        const obrigacoes = [];
        simplesSnap.forEach(d => {
            const e = { id: d.id, ...d.data() };
            if (e._merged_into) return; // 23/05: ignora perdedores do merge
            obrigacoes.push(...gerarObrigacoesPorEmpresa(e, 'simples', ano, mes));
        });
        lucroSnap.forEach(d => {
            const e = { id: d.id, ...d.data() };
            if (e._merged_into) return; // 23/05: ignora perdedores do merge
            obrigacoes.push(...gerarObrigacoesPorEmpresa(e, 'lucro', ano, mes));
        });

        // Ordena por vencimento ascendente
        obrigacoes.sort((a, b) => a.vencimento.localeCompare(b.vencimento));

        // Estatisticas
        const hoje = new Date().toISOString().slice(0, 10);
        const stats = {
            total: obrigacoes.length,
            vencidas: obrigacoes.filter(o => o.vencimento < hoje).length,
            proximas7Dias: obrigacoes.filter(o => {
                if (o.vencimento < hoje) return false;
                const venc = new Date(o.vencimento);
                const limite = new Date(hoje);
                limite.setDate(limite.getDate() + 7);
                return venc <= limite;
            }).length,
            porTipo: obrigacoes.reduce((acc, o) => {
                acc[o.tipo] = (acc[o.tipo] || 0) + 1;
                return acc;
            }, {}),
        };

        return res.json({
            ano, mes,
            geradoEm: new Date().toISOString(),
            stats,
            obrigacoes,
            limitacoes: 'Datas conforme legislação federal/SP vigente em 2026. Sempre confirme no calendário oficial da RFB, SEFAZ-SP e Prefeitura de SP. Vencimentos em fim de semana são antecipados para o último dia útil anterior conforme regra de cada órgão.',
        });
    } catch (err) {
        console.error('[calendario]', err);
        return respondeErro(res, err);
    }
});

// ─── Dashboard CEO — endpoint de KPIs + insights IA ─────────────────────────
app.get('/api/admin/dashboard-ceo/kpis', requireAdmin, async (req, res) => {
    try {
        const admin = (await import('firebase-admin')).default;
        if (!admin.apps.length) {
            admin.initializeApp({ credential: admin.credential.applicationDefault() });
        }
        const db = admin.firestore();

        const hoje = new Date().toISOString().slice(0, 10);
        const mesAtual = hoje.slice(0, 7); // YYYY-MM

        // ── Empresas (Simples + Lucro)
        const [simplesSnap, lucroSnap] = await Promise.all([
            db.collection('simples_empresas').get(),
            db.collection('lucro_empresas').get(),
        ]);
        // 23/05: filtra perdedores do merge de duplicatas
        const simplesAtivos = simplesSnap.docs.filter(d => !d.data()._merged_into);
        const lucroAtivos   = lucroSnap.docs.filter(d => !d.data()._merged_into);
        const totalEmpresas = simplesAtivos.length + lucroAtivos.length;

        // ── Caixa Postal
        const cxSnap = await fetchAllDocs(db.collection('caixa_postal_mensagens'), { label: 'caixa_postal/ceo' });
        let cxNaoLidasCriticas = 0;
        const cnpjsCriticos = new Set();
        cxSnap.forEach(d => {
            const m = d.data();
            if (!m.dataLeitura && ['intimacao', 'malha', 'exclusao'].includes(m.categoria)) {
                cxNaoLidasCriticas++;
                cnpjsCriticos.add(m.empresaCnpj);
            }
        });

        // ── DAS
        const dasSnap = await fetchAllDocs(db.collection('das_emitidos'), { label: 'das_emitidos/ceo' });
        let dasPendentes = 0, dasVencidos = 0, valorVencido = 0;
        const cnpjsDasVencido = new Set();
        dasSnap.forEach(d => {
            const m = d.data();
            const status = m.statusPagamento || 'pendente';
            if (status === 'pago') return;
            const venc = m.vencimento || '';
            if (venc && venc < hoje) {
                dasVencidos++;
                valorVencido += m.valor || 0;
                cnpjsDasVencido.add(m.empresaCnpj);
            } else {
                dasPendentes++;
            }
        });

        // ── NFSe
        const nfseSnap = await fetchAllDocs(db.collection('nfse_nacional_emitidas'), { label: 'nfse_nacional_emitidas/ceo' });
        let nfseMes = 0, nfseIssMes = 0;
        nfseSnap.forEach(d => {
            const m = d.data();
            if (m.status !== 'autorizada') return;
            const dataEmis = (m.emitidaEm || '').slice(0, 7);
            if (dataEmis === mesAtual) {
                nfseMes++;
                nfseIssMes += m.servico?.issValor || 0;
            }
        });

        // ── Apurações Simples pendentes (empresas sem cálculo no mês corrente)
        let apuracoesPendentes = 0;
        simplesSnap.forEach(d => {
            const e = d.data();
            const histor = e.historicoCalculos || [];
            const tem = histor.some(h => (h.mesReferencia || '').toLowerCase().includes(getMesNome(mesAtual)));
            if (!tem) apuracoesPendentes++;
        });

        // ── Cobertura PGDAS-D (mês anterior — quem não emitiu?)
        // Importa o helper testado pra calcular o mês anterior corretamente.
        const { ultimasCompetencias } = await import('./sefaz-backend/competencias-helper.js');
        const mesAnterior = ultimasCompetencias(1)[0];
        const dasMesAnteriorPorEmpresa = new Set();
        dasSnap.forEach(d => {
            const x = d.data();
            if (x.competencia === mesAnterior) dasMesAnteriorPorEmpresa.add(x.empresaId);
        });
        let pgdasMesAnteriorPendentes = 0;
        simplesAtivos.forEach(d => {
            if (!dasMesAnteriorPorEmpresa.has(d.id)) pgdasMesAnteriorPendentes++;
        });

        // ── Cobertura DCTFWeb (mês anterior — quem não transmitiu?)
        const dctfwebSnap = await fetchAllDocs(db.collection('dctfweb_declaracoes'), { label: 'dctfweb_declaracoes/ceo' });
        const [anoAntStr, mesAntStr] = (mesAnterior || '').split('-');
        const anoAnt = Number(anoAntStr), mesAnt = Number(mesAntStr);
        const dctfwebMesAnteriorAtivos = new Set();
        dctfwebSnap.forEach(d => {
            const x = d.data();
            if (x.anoPA === anoAnt && x.mesPA === mesAnt && x.situacao === 'ATIVA' && (!x.categoria || x.categoria === 'GERAL_MENSAL')) {
                dctfwebMesAnteriorAtivos.add(x.empresaId);
            }
        });
        let dctfwebMesAnteriorPendentes = 0;
        lucroAtivos.forEach(d => {
            if (!dctfwebMesAnteriorAtivos.has(d.id)) dctfwebMesAnteriorPendentes++;
        });

        // ── Sublimite Simples (RBT12 perto/passou de R$ 3,6M ou R$ 4,8M)
        const { calcularRbt12, classificarRbt12 } = await import('./sefaz-backend/simples-sublimite-helper.js');
        let sublimiteUltrapassou = 0, sublimiteCritico = 0, tetoUltrapassou = 0, tetoCritico = 0;
        simplesAtivos.forEach(d => {
            const e = d.data();
            const { rbt12 } = calcularRbt12(e.faturamentoManual || {});
            const c = classificarRbt12(rbt12);
            if (c.teto.faixa === 'ultrapassou') tetoUltrapassou++;
            else if (c.teto.faixa === 'critico') tetoCritico++;
            if (c.sublimite.faixa === 'ultrapassou') sublimiteUltrapassou++;
            else if (c.sublimite.faixa === 'critico') sublimiteCritico++;
        });

        return res.json({
            timestamp: new Date().toISOString(),
            totalEmpresas,
            caixaPostal: {
                naoLidasCriticas: cxNaoLidasCriticas,
                empresasComCriticas: cnpjsCriticos.size,
            },
            das: {
                pendentes: dasPendentes,
                vencidos: dasVencidos,
                valorVencido: +valorVencido.toFixed(2),
                empresasComVencido: cnpjsDasVencido.size,
            },
            nfse: {
                mesAtual: nfseMes,
                issTotal: +nfseIssMes.toFixed(2),
            },
            apuracoes: {
                pendentes: apuracoesPendentes,
            },
            // ── Novos KPIs do dia ──
            cobertura: {
                mesAnterior,
                pgdasPendentes: pgdasMesAnteriorPendentes,
                pgdasTotal: simplesAtivos.length,
                dctfwebPendentes: dctfwebMesAnteriorPendentes,
                dctfwebTotal: lucroAtivos.length,
            },
            sublimite: {
                tetoUltrapassou,
                tetoCritico,
                sublimiteUltrapassou,
                sublimiteCritico,
            },
        });
    } catch (err) {
        console.error('[dashboard-ceo/kpis]', err);
        return respondeErro(res, err);
    }
});

function getMesNome(yyyymm) {
    const [_, m] = yyyymm.split('-');
    const meses = { '01':'janeiro','02':'fevereiro','03':'marco','04':'abril','05':'maio','06':'junho','07':'julho','08':'agosto','09':'setembro','10':'outubro','11':'novembro','12':'dezembro' };
    return meses[m] || '';
}

app.get('/api/admin/dashboard-ceo/acoes', requireAdmin, async (req, res) => {
    try {
        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const db = adminMod.firestore();

        const acoes = [];
        const hoje = new Date().toISOString().slice(0, 10);
        const mesAtual = hoje.slice(0, 7);

        // ── 1. Mensagens criticas Caixa Postal (urgencia ALTA)
        const cxSnap = await fetchAllDocs(db.collection('caixa_postal_mensagens'), { label: 'caixa_postal/ceo' });
        const empresasCxCriticas = new Map();
        cxSnap.forEach(d => {
            const m = d.data();
            if (m.dataLeitura) return;
            if (!['intimacao', 'malha', 'exclusao'].includes(m.categoria)) return;
            const key = m.empresaCnpj;
            if (!empresasCxCriticas.has(key)) {
                empresasCxCriticas.set(key, { cnpj: key, count: 0, categorias: new Set(), empresaId: m.empresaId });
            }
            const e = empresasCxCriticas.get(key);
            e.count++;
            e.categorias.add(m.categoria);
        });
        // Lookup de nomes das empresas (Simples + Lucro) pra enriquecer
        const cnpjsCx = [...empresasCxCriticas.keys()].map(k => k.replace(/\D/g, ''));
        const nomePorCnpj = new Map();
        try {
            const [simAll, lucAll] = await Promise.all([
                db.collection('simples_empresas').get(),
                db.collection('lucro_empresas').get(),
            ]);
            simAll.forEach(d => {
                const e = d.data();
                if (e._merged_into) return; // 23/05: ignora perdedores do merge
                if (e.cnpj) nomePorCnpj.set(e.cnpj.replace(/\D/g, ''), e.nome);
            });
            lucAll.forEach(d => {
                const e = d.data();
                if (e._merged_into) return; // 23/05: ignora perdedores do merge
                if (e.cnpj) nomePorCnpj.set(e.cnpj.replace(/\D/g, ''), e.nome);
            });
        } catch (e) { /* segue sem nomes */ }

        for (const e of empresasCxCriticas.values()) {
            const cnpjLimpo = (e.cnpj || '').replace(/\D/g, '');
            const nome = nomePorCnpj.get(cnpjLimpo);
            acoes.push({
                tipo: 'caixa-postal',
                urgencia: e.categorias.has('intimacao') ? 'alta' : (e.categorias.has('exclusao') ? 'alta' : 'media'),
                empresaCnpj: e.cnpj,
                empresaId: e.empresaId,
                empresaNome: nome || null,
                titulo: `${e.count} mensagem(ns) crítica(s) no e-CAC`,
                descricao: `Categorias: ${[...e.categorias].join(', ')}`,
                acao: 'Ver Caixa Postal',
                modulo: 'caixa-postal',
            });
        }

        // ── 2. DAS vencidos (urgencia ALTA)
        const dasSnap = await fetchAllDocs(db.collection('das_emitidos'), { label: 'das_emitidos/ceo' });
        const empresasDasVencido = new Map();
        dasSnap.forEach(d => {
            const m = d.data();
            if (m.statusPagamento === 'pago') return;
            const venc = m.vencimento || '';
            if (!venc || venc >= hoje) return;
            const key = m.empresaCnpj;
            if (!empresasDasVencido.has(key)) {
                empresasDasVencido.set(key, { cnpj: key, count: 0, valor: 0, empresaId: m.empresaId, nome: m.empresaNome });
            }
            const e = empresasDasVencido.get(key);
            e.count++;
            e.valor += m.valor || 0;
        });
        for (const e of empresasDasVencido.values()) {
            const diasAtraso = (() => {
                const venc = new Date(hoje);
                return 0; // simplificado por ora
            })();
            acoes.push({
                tipo: 'das-vencido',
                urgencia: e.valor > 5000 ? 'alta' : 'media',
                empresaCnpj: e.cnpj,
                empresaId: e.empresaId,
                empresaNome: e.nome,
                titulo: `${e.count} DAS vencido(s) — R\$ ${e.valor.toFixed(2)}`,
                descricao: 'Marcar como pago se já regularizou, ou cobrar do cliente.',
                acao: 'Ver DAS',
                modulo: 'das',
            });
        }

        // ── 3. Apuracoes Simples sem calculo do mes (urgencia MEDIA)
        const empSnap = await db.collection('simples_empresas').get();
        const meses = { '01':'janeiro','02':'fevereiro','03':'marco','04':'abril','05':'maio','06':'junho','07':'julho','08':'agosto','09':'setembro','10':'outubro','11':'novembro','12':'dezembro' };
        const mesNome = meses[mesAtual.slice(5, 7)] || '';
        empSnap.forEach(d => {
            const e = d.data();
            if (e._merged_into) return; // 23/05: ignora perdedores do merge
            const histor = e.historicoCalculos || [];
            const tem = histor.some(h => (h.mesReferencia || '').toLowerCase().includes(mesNome));
            if (!tem) {
                acoes.push({
                    tipo: 'apuracao-pendente',
                    urgencia: 'media',
                    empresaCnpj: e.cnpj,
                    empresaId: d.id,
                    empresaNome: e.nome,
                    titulo: `Sem apuração de ${mesNome}`,
                    descricao: 'Fechar mês para emitir DAS.',
                    acao: 'Apurar',
                    modulo: 'simples',
                });
            }
        });

        // Ordena: alta antes, depois media, depois baixa
        const peso = { alta: 0, media: 1, baixa: 2 };
        acoes.sort((a, b) => peso[a.urgencia] - peso[b.urgencia]);

        return res.json({
            timestamp: new Date().toISOString(),
            totalAcoes: acoes.length,
            porUrgencia: {
                alta: acoes.filter(a => a.urgencia === 'alta').length,
                media: acoes.filter(a => a.urgencia === 'media').length,
                baixa: acoes.filter(a => a.urgencia === 'baixa').length,
            },
            acoes: acoes.slice(0, 50),  // limita pra nao explodir UI
        });
    } catch (err) {
        console.error('[dashboard-ceo/acoes]', err);
        return respondeErro(res, err);
    }
});

app.post('/api/admin/dashboard-ceo/insights', requireAdmin, requireAI, async (req, res) => {
    try {
        const { kpis } = req.body;
        if (!kpis) return res.status(400).json({ error: 'kpis obrigatorio' });

        const prompt = `Voce eh um consultor fiscal senior assessorando o CEO de um escritorio
contabil (SP Assessoria Contabil). Com base nos KPIs operacionais abaixo,
forneca 3 a 5 recomendacoes praticas e priorizadas em ordem de urgencia,
em portugues brasileiro, no tom direto e profissional.

Foque em:
- Itens criticos (intimacoes, malha fiscal, DAS vencido)
- Riscos fiscais detectados
- Oportunidades operacionais

KPIs (data ${new Date().toISOString().slice(0,10)}):
- Total de empresas atendidas: ${kpis.totalEmpresas}
- Caixa Postal e-CAC: ${kpis.caixaPostal.naoLidasCriticas} mensagens criticas nao lidas em ${kpis.caixaPostal.empresasComCriticas} empresas
- DAS Simples Nacional: ${kpis.das.vencidos} vencidos (R\$ ${kpis.das.valorVencido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) em ${kpis.das.empresasComVencido} empresas, ${kpis.das.pendentes} pendentes no prazo
- NFS-e Nacional: ${kpis.nfse.mesAtual} emitidas neste mes (ISS R\$ ${kpis.nfse.issTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})
- Apuracoes Simples sem calculo no mes corrente: ${kpis.apuracoes.pendentes}

Responda em formato:

**1. [Acao priorizada]**
[Justificativa em 1-2 frases]

**2. [Acao]**
[Justificativa]

(...)

Maximo 5 itens. Seja direto, sem rodeios. Nao repita os numeros literais
dos KPIs — assuma que o CEO ja viu.`;

        const escolhido = pickGeminiModel({ prompt, hasAttachment: false });
        logGeminiRoute(escolhido, { rota: 'dashboard-ceo-insights', chars: prompt.length });
        const response = await ai.models.generateContent({
            model: escolhido,
            contents: prompt,
        });
        return res.json({
            insights: response.text ?? '',
            geradoEm: new Date().toISOString(),
            modelo: escolhido,
        });
    } catch (err) {
        console.error('[dashboard-ceo/insights]', err);
        return respondeErro(res, err);
    }
});





// ─── Análise de Créditos Fiscais ────────────────────────────────────────────
function xmlTag(xml, tag) {
    // Aceita: <tag>valor</tag>, <tag attr="x">valor</tag>, <ns:tag>valor</ns:tag>, <![CDATA[...]]>
    const r = new RegExp('<(?:[a-zA-Z][a-zA-Z0-9]*:)?' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z][a-zA-Z0-9]*:)?' + tag + '>', 'i');
    const m = xml.match(r);
    if (!m) return '';
    let val = m[1].trim();
    const cd = val.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    if (cd) val = cd[1].trim();
    return val;
}
function xmlTagAll(xml, tag) {
    const r = new RegExp('<(?:[a-zA-Z][a-zA-Z0-9]*:)?' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z][a-zA-Z0-9]*:)?' + tag + '>', 'gi');
    const out = [];
    let m;
    while ((m = r.exec(xml)) !== null) {
        let val = m[1].trim();
        const cd = val.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
        if (cd) val = cd[1].trim();
        out.push(val);
    }
    return out;
}
function analisarPisCofins(nota, regime) {
    if (regime === 'SIMPLES') return { tipo:'NEGADO', creditoPIS:0, creditoCOFINS:0, observacao:'Simples Nacional não gera créditos de PIS/COFINS.', fundamentoLegal:'Lei 123/2006, art. 23', avisos:[] };
    if (regime === 'LUCRO_PRESUMIDO') return { tipo:'NEGADO', creditoPIS:0, creditoCOFINS:0, observacao:'Lucro Presumido sujeito ao regime cumulativo — sem crédito.', fundamentoLegal:'Lei 9.718/1998', avisos:[] };
    const cfop = String(nota.cfop||'');
    const cst  = String(nota.cst||'');
    const base = parseFloat(nota.valorTotal||nota.vProd||0);
    // CFOPs que geram crédito: 1xxx (entradas internas), 2xxx (interestaduais), 3xxx (importações),
    // 5xxx/6xxx quando for devolução de venda recebida
    const cfopPrimeiro = cfop.charAt(0);
    const ehDevolucaoRecebida = (cfopPrimeiro === '5' || cfopPrimeiro === '6') && cfop.startsWith(cfopPrimeiro + '2');
    if (!['1','2','3'].includes(cfopPrimeiro) && !ehDevolucaoRecebida) {
        if (!cfop) {
            return { tipo:'REVISAR', creditoPIS:0, creditoCOFINS:0, observacao:'CFOP não identificado — revisar nota manualmente.', fundamentoLegal:'Lei 10.637/2002', avisos:['CFOP ausente no XML/planilha'] };
        }
        return { tipo:'NEGADO', creditoPIS:0, creditoCOFINS:0, observacao:'CFOP '+cfop+' (saída) não gera crédito de PIS/COFINS.', fundamentoLegal:'Lei 10.637/2002, art. 3º', avisos:[] };
    }
    // CST PIS/COFINS: 01,02 = integral / 03 = regime misto (parcial) / 50,51,55,99 = diferido
    // CSOSN (emitente Simples): 101,102 = permite crédito / 201-900 = sem crédito
    const cstOk      = ['01','02','50','51','55','99','1','2','101','102'];
    const cstParcial = ['03','52','3'];
    const cstNeg     = ['04','06','07','08','09','4','6','7','8','9','103','201','202','203','300','400','500','900'];
    if (cstOk.includes(cst))
        return { tipo:'APROVADO', creditoPIS:+(base*0.0165).toFixed(2), creditoCOFINS:+(base*0.076).toFixed(2), observacao:'Crédito integral — CST permite aproveitamento pleno.', fundamentoLegal:'Lei 10.637/2002 e 10.833/2003, art. 3º', avisos:[] };
    if (cstParcial.includes(cst))
        return { tipo:'PARCIAL', creditoPIS:+(base*0.0165*0.5).toFixed(2), creditoCOFINS:+(base*0.076*0.5).toFixed(2), observacao:'CST '+cst+' indica aproveitamento parcial (50%).', fundamentoLegal:'Lei 10.637/2002, art. 3º §1º', avisos:['Revisar proporção de aproveitamento com contador'] };
    if (cstNeg.includes(cst))
        return { tipo:'NEGADO', creditoPIS:0, creditoCOFINS:0, observacao:'CST '+cst+' indica isenção/não incidência — sem crédito.', fundamentoLegal:'IN RFB 2.121/2022', avisos:[] };
    if (!cst) {
        return { tipo:'REVISAR', creditoPIS:0, creditoCOFINS:0, observacao:'CST ausente — revisar nota manualmente.', fundamentoLegal:'Lei 10.637/2002', avisos:['CST não identificado no XML/planilha'] };
    }
    return { tipo:'REVISAR', creditoPIS:0, creditoCOFINS:0, observacao:'CST '+cst+' requer análise individualizada.', fundamentoLegal:'Lei 10.637/2002 e 10.833/2003', avisos:['Consulte o contador responsável'] };
}
function analisarIcms(nota) {
    const cfop  = String(nota.cfop||'');
    // Preferir cstIcms (específico do ICMS) quando disponível — no NFe o CST do ICMS é
    // diferente do CST do PIS/COFINS.
    const cst   = String(nota.cstIcms || nota.cst || '');
    const vICMS = parseFloat(nota.valorIcms||nota.vICMS||0);
    if (!cfop.startsWith('1') && !cfop.startsWith('2'))
        return { tipo:'NEGADO', creditoIcms:0, observacao:'CFOP de saída não gera crédito de ICMS.', fundamentoLegal:'RICMS', avisos:[] };
    if (['40','41','50'].includes(cst))
        return { tipo:'NEGADO', creditoIcms:0, observacao:'Operação isenta/não tributada — sem ICMS a creditar.', fundamentoLegal:'CF/88 art.155 §2º I; RICMS', avisos:[] };
    if (['00','20'].includes(cst))
        return { tipo:'APROVADO', creditoIcms:vICMS, observacao:'ICMS destacado aproveitável como crédito.', fundamentoLegal:'CF/88 art.155 §2º I; RICMS', avisos:[] };
    if (cst.startsWith('1') || cst.startsWith('7'))
        return { tipo:'PARCIAL', creditoIcms:+(vICMS*0.5).toFixed(2), observacao:'Substituição tributária — crédito parcial conforme RICMS.', fundamentoLegal:'Convênio ICMS', avisos:['Verificar DIFAL e antecipação ST'] };
    return { tipo:'REVISAR', creditoIcms:0, observacao:'CST requer análise específica pelo regulamento estadual.', fundamentoLegal:'RICMS', avisos:['Verifique o RICMS do estado emissor'] };
}

// --- Analise de relatorio de despesas (xlsx) --------------------------------
const KEYWORDS={LUCRO_REAL_SERVICOS:['energia','aluguel','telefon','internet','licen','software','ti','medic','psicol','nutri','consultor','qualidade','saude'],LUCRO_REAL_COMERCIO:['mercadoria','compra','energia','aluguel','frete','internet','licen','software'],LUCRO_REAL_INDUSTRIA:['materia','insumo','embalagem','energia','aluguel','frete','deprecia','licen','software','ti'],LUCRO_REAL:['energia','aluguel','telefon','internet','licen','software','ti','medic','psicol','nutri','consultor']};
function hasCredito(tipo,regime){const kws=KEYWORDS[regime]||KEYWORDS.LUCRO_REAL_SERVICOS;const t=tipo.toLowerCase();return kws.some(k=>t.includes(k));}
function parseBRL(v){const s=String(v||'').trim().replace(/[^0-9,.]/g,'');if(!s)return 0;if(s.includes(',')){return parseFloat(s.replace(/\./g,'').replace(',','.'))||0;}if((s.match(/\./g)||[]).length>1){return parseFloat(s.replace(/\.(?=.*\.)/g,''))||0;}return parseFloat(s)||0;}
function parseXlsxExpense(buf){try{const wb=XLSX.read(buf,{type:'buffer'});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});let hr=-1,ti=-1,vi=-1,fi=-1,ni=-1;for(let i=0;i<Math.min(rows.length,10);i++){const r=rows[i].map(x=>String(x).toLowerCase().trim());if(r.some(x=>x.includes('tipo'))||r.some(x=>x.includes('despesa'))){hr=i;ti=r.findIndex(h=>h.includes('tipo'));vi=r.findIndex(h=>h.includes('valor'));fi=r.findIndex(h=>h.includes('fornec'));ni=r.findIndex(h=>h.includes('nota'));break;}}if(hr<0||ti<0||vi<0)return null;const g={};for(let i=hr+1;i<rows.length;i++){const row=rows[i];const tipo=String(row[ti]||'').trim();if(!tipo||/^[\d.,]/.test(tipo)||tipo.toLowerCase().includes('total')||tipo.toLowerCase().includes('custo'))continue;const val=parseBRL(row[vi]);if(!val)continue;const forn=fi>=0?String(row[fi]||'').trim():'';const nota=ni>=0?String(row[ni]||'').trim():'';if(!g[tipo])g[tipo]={tipo,valor:0,count:0,entradas:[]};g[tipo].valor=+(g[tipo].valor+val).toFixed(2);g[tipo].count++;g[tipo].entradas.push({nota,forn,valor:val});}return Object.keys(g).length?g:null;}catch(e){console.error('XLSX parse error:',e.message);return null;}}
function classificarFaturaCartao(desc){
  const up = String(desc||'').toUpperCase();
  const RULES = [
    [/\b(AZUL|GOL|LATAM|TAM|AVIANCA)\b/, 'PASSAGEM AEREA'],
    [/\bUBER\b|\b99 ?TAX|\bCABIFY\b/, 'TRANSPORTE URBANO PESSOAL'],
    [/\b(HOTEL|ROYAL PALM|ATLANTE|IBIS|ACCOR|POUSADA|RESORT)\b/, 'HOTELARIA'],
    [/\b(KOPENHAGEN|CACAU SHOW|PALACIO DAS SACOLA)/, 'BRINDES E CORTESIA'],
    [/\b(G4 EDUCACAO|MET HUB)\b|\bCURSO\b|\bTREINAMENTO\b/, 'CURSO TREINAMENTO PESSOA FISICA'],
    [/\bIOF\b/, 'IOF TARIFA BANCARIA'],
    [/\bANUIDADE\b/, 'ANUIDADE CARTAO'],
    [/\bESTORNO\b/, 'ESTORNO'],
    [/\b(PORTO SEGURO|SEGUROS|SEGURADORA|BRADESCO SEGURO)\b/, 'SEGURO BEM NAO OPERACIONAL'],
    [/\bCANVA\b|EBN.*CANVA/, 'LICENCA TI'],
    [/\b(CLICKUP|MONDAY|ASANA|NOTION|PIPEFY|ATLASSIAN|TRELLO|JIRA)/, 'LICENCA TI'],
    [/\bSLACK\b/, 'LICENCA TI'],
    [/\b(PIPEDRIVE|HUBSPOT|SALESFORCE|ZOHO|RD STATION)/, 'LICENCA TI'],
    [/\b(GOOGLE WORKSPACE|MICROSOFT|MIRO|LUCID|FIGMA|OFFICE 365|ADOBE)/, 'LICENCA TI'],
    [/\b(HOSTGATOR|AWS|AZURE|GCP|TURBO CLOUD|CLOUDFLARE|GODADDY)/, 'LICENCA TI'],
    [/\b(CLICKSIGN|DOCUSIGN)/, 'LICENCA TI'],
    [/\b(STRACT|SHUTTERSTOCK|FREEPIK|ENVATO|GETTY|ZAPIER)\b|STK\*SHUTTERSTOCK/, 'LICENCA TI'],
    [/\b(QR\.?IO|QRGEN)\b/, 'LICENCA TI'],
    [/\b(SALVY|ZUPPER)\b|IG\*SALVY/, 'TELEFONIA'],
    [/\b(KABUM|COMPULIN|TERABYTE|PICHAU)\b/, 'MATERIAL INFORMATICA REVER ATIVO'],
    [/\b(GOOGLE ADS|FACEBOOK ADS|META ADS|LINKEDIN ADS)\b/, 'MARKETING DIGITAL'],
  ];
  for (const [rgx, tipo] of RULES) { if (rgx.test(up)) return tipo; }
  return 'A CLASSIFICAR CARTAO';
}
function parseXlsxFaturaItauEmpresas(buf){
  try{
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
    const flat = rows.slice(0, 30).flat().map(v => String(v == null ? '' : v));
    const hasItau = flat.some(s => /Logotipo Ita|ITAU EMPRESAS MASTERCARD/i.test(s));
    const hasFatura = flat.some(s => /Total da fatura/i.test(s));
    if (!hasItau || !hasFatura) return null;
    let state = null;
    const lancamentos = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const a = row[0]; const c = row[2]; const k = row[10];
      const sa = String(a == null ? '' : a).trim();
      if (/^Lan\u00e7amentos nacionais$/i.test(sa)) { state = 'NAC'; continue; }
      if (/^Lan\u00e7amentos internacionais$/i.test(sa)) { state = 'INT'; continue; }
      if (/^Total de lan\u00e7amentos/i.test(sa)) { state = null; continue; }
      if (/^Produtos, servi\u00e7os/i.test(sa)) { state = null; continue; }
      if (sa === 'data' || sa === 'descri\u00e7\u00e3o' || sa === 'Lan\u00e7amentos') continue;
      if (!state) continue;
      const isDate = (a instanceof Date) || (typeof a === 'string' && /^\d{4}-\d{2}-\d{2}/.test(a)) || (typeof a === 'number' && a > 40000 && a < 60000);
      const valor = typeof k === 'number' ? k : parseBRL(k);
      if (isDate && c && valor) {
        lancamentos.push({ desc: String(c).trim(), valor: valor, origem: state });
      }
    }
    if (!lancamentos.length) return null;
    const grupos = {};
    for (const l of lancamentos) {
      const tipo = classificarFaturaCartao(l.desc);
      if (!grupos[tipo]) grupos[tipo] = { tipo, valor: 0, count: 0, entradas: [] };
      grupos[tipo].valor = +(grupos[tipo].valor + l.valor).toFixed(2);
      grupos[tipo].count++;
      grupos[tipo].entradas.push({ nota: 'FATURA CARTAO ' + l.origem, forn: l.desc, valor: l.valor });
    }
    return Object.keys(grupos).length ? grupos : null;
  } catch (e) {
    console.error('XLSX Itau parse error:', e.message);
    return null;
  }
}

function calcularCreditoExpense(grupos,regime){const P=0.0165,CF=0.076;const det=Object.values(grupos).map(g=>{const ok=hasCredito(g.tipo,regime);const cP=ok?+(g.valor*P).toFixed(2):0;const cC=ok?+(g.valor*CF).toFixed(2):0;return{nota:{numero:g.tipo,emitente:g.count+' nota(s)',entradas:g.entradas||[],cfop:'N/A',cst:'N/A',natureza:g.tipo,valorTotal:g.valor,baseCalculo:g.valor,valorIcms:0,aliquotaIcms:0,tipo:'SERVICO'},pisCofins:{tipo:ok?'APROVADO':'NEGADO',creditoPIS:cP,creditoCOFINS:cC,observacao:ok?g.tipo+': base R$ '+g.valor.toLocaleString('pt-BR',{minimumFractionDigits:2})+' | PIS 1,65% + COFINS 7,6%':g.tipo+': sem credito neste regime.',fundamentoLegal:ok?'Lei 10.637/2002 e 10.833/2003, art. 3':'IN RFB 2.121/2022',avisos:[]},icms:{tipo:'NEGADO',creditoIcms:0,observacao:'Relatorio de despesas: ICMS nao aplicavel.',fundamentoLegal:'N/A',avisos:[]}};});const tot=det.reduce((a,d)=>{a.creditoPIS+=d.pisCofins.creditoPIS||0;a.creditoCOFINS+=d.pisCofins.creditoCOFINS||0;a.notasAnalisadas++;const tp=d.pisCofins.tipo,k='total'+tp[0]+tp.slice(1).toLowerCase();if(a.resumo.pisCofins[k]!==undefined)a.resumo.pisCofins[k]++;return a;},{creditoPIS:0,creditoCOFINS:0,creditoIcms:0,notasAnalisadas:0,resumo:{pisCofins:{totalAprovado:0,totalParcial:0,totalNegado:0,totalRevisar:0},icms:{totalAprovado:0,totalParcial:0,totalNegado:0,totalRevisar:0}}});tot.creditoTotal=+(tot.creditoPIS+tot.creditoCOFINS).toFixed(2);const base=det.filter(d=>d.pisCofins.tipo==='APROVADO').reduce((s,d)=>s+d.nota.valorTotal,0);return{resultado:{totais:tot,detalhes:det,alertas:[{nivel:'info',mensagem:det.length+' categorias de despesa analisadas.'},{nivel:'info',mensagem:'Base aprovada: R$ '+base.toLocaleString('pt-BR',{minimumFractionDigits:2})+' | PIS: R$ '+tot.creditoPIS.toFixed(2)+' | COFINS: R$ '+tot.creditoCOFINS.toFixed(2)}]}};}
// ---------------------------------------------------------------------------

function parseXlsxNotas(buf) {
    try {
        const wb = XLSX.read(buf, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        // Normalizador: lowercase sem acentos
        const norm = s => String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        // Acha header row (tem "cfop" ou "cst" em algum lugar)
        let hr = -1, idx = {};
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
            const r = rows[i].map(norm);
            if (r.some(x => x === 'cfop' || x === 'cst' || x === 'csosn')) {
                hr = i;
                r.forEach((h, j) => {
                    if (h === 'cfop' || h.includes('cfop emissao')) idx.cfop = j;
                    else if (h === 'cst' || h === 'csosn' || h.includes('cst icms')) idx.cst = j;
                    else if (h.includes('numero') || h === 'nf' || h === 'n nf') idx.numero = j;
                    else if (h.includes('emitente') || h.includes('razao') || h.includes('fornec')) idx.emitente = j;
                    else if (h === 'valor total' || h === 'valortotal' || h === 'valor' || h.includes('valor nota')) idx.valorTotal = j;
                    else if (h.includes('base calculo') || h === 'base' || h === 'vbc') idx.baseCalculo = j;
                    else if (h === 'valor icms' || h === 'icms' || h === 'vicms') idx.valorIcms = j;
                    else if (h.includes('aliq') || h === 'picms') idx.aliquotaIcms = j;
                    else if (h === 'natureza' || h.includes('nat op') || h.includes('natureza op')) idx.natureza = j;
                });
                break;
            }
        }
        if (hr < 0 || idx.cfop === undefined) return null;
        const notas = [];
        for (let i = hr + 1; i < rows.length; i++) {
            const row = rows[i];
            const cfop = String(row[idx.cfop] || '').trim();
            if (!cfop || cfop.length < 4) continue; // linha de total/blank
            notas.push({
                numero:   idx.numero !== undefined ? String(row[idx.numero] || '').trim() : String(i),
                emitente: idx.emitente !== undefined ? String(row[idx.emitente] || '').trim() : '',
                cfop: cfop,
                cst: idx.cst !== undefined ? String(row[idx.cst] || '').trim() : '',
                natureza: idx.natureza !== undefined ? String(row[idx.natureza] || '').trim() : '',
                valorTotal:   idx.valorTotal !== undefined ? parseBRL(row[idx.valorTotal]) : 0,
                baseCalculo:  idx.baseCalculo !== undefined ? parseBRL(row[idx.baseCalculo]) : 0,
                valorIcms:    idx.valorIcms !== undefined ? parseBRL(row[idx.valorIcms]) : 0,
                aliquotaIcms: idx.aliquotaIcms !== undefined ? parseBRL(row[idx.aliquotaIcms]) : 0,
                tipo: 'PRODUTO'
            });
        }
        return notas;
    } catch (e) {
        console.error('XLSX notas parse error:', e.message);
        return null;
    }
}

function calcularResultado(notas, regime) {
    const detalhes = notas.map(nota => ({ nota, pisCofins: analisarPisCofins(nota, regime), icms: analisarIcms(nota) }));
    const totais = detalhes.reduce((acc, d) => {
        acc.creditoPIS    += d.pisCofins.creditoPIS||0;
        acc.creditoCOFINS += d.pisCofins.creditoCOFINS||0;
        acc.creditoIcms   += d.icms.creditoIcms||0;
        const tp = d.pisCofins.tipo, ti = d.icms.tipo;
        const k = t => 'total' + t[0] + t.slice(1).toLowerCase();
        if (tp && acc.resumo.pisCofins[k(tp)] !== undefined) acc.resumo.pisCofins[k(tp)]++;
        if (ti && acc.resumo.icms[k(ti)] !== undefined) acc.resumo.icms[k(ti)]++;
        return acc;
    }, { creditoPIS:0, creditoCOFINS:0, creditoIcms:0, notasAnalisadas:notas.length,
         resumo:{ pisCofins:{totalAprovado:0,totalParcial:0,totalNegado:0,totalRevisar:0},
                  icms:{totalAprovado:0,totalParcial:0,totalNegado:0,totalRevisar:0} } });
    totais.creditoTotal = +(totais.creditoPIS + totais.creditoCOFINS + totais.creditoIcms).toFixed(2);
    const alertas = [];
    if (regime === 'LUCRO_REAL' && totais.creditoTotal > 0)
        alertas.push({ nivel:'info', mensagem:'Créditos calculados com PIS 1,65% e COFINS 7,6% (Lucro Real não cumulativo).' });
    if (detalhes.some(d => d.pisCofins.tipo==='REVISAR'||d.icms.tipo==='REVISAR'))
        alertas.push({ nivel:'alerta', mensagem:'Algumas notas necessitam revisão manual — consulte o contador.' });
    return { totais, detalhes, alertas };
}
function parseNFeXml(xml) {
    // Se vier um pacote (nfeProc contendo múltiplas NFe), iteramos cada <NFe>
    const notas = [];
    const nfeRegex = /<NFe[\s\S]*?<\/NFe>/gi;
    let nfeMatches = xml.match(nfeRegex);
    if (!nfeMatches || nfeMatches.length === 0) nfeMatches = [xml]; // single NFe sem wrapper
    for (const nfeXml of nfeMatches) {
        const nNF = xmlTag(nfeXml, 'nNF');
        const natOp = xmlTag(nfeXml, 'natOp');
        // xNome do emitente (dentro de <emit>), não do destinatário
        const emitBlock = nfeXml.match(/<emit[\s\S]*?<\/emit>/);
        const xNome = emitBlock ? xmlTag(emitBlock[0], 'xNome') : xmlTag(nfeXml, 'xNome');
        const detRegex = /<det\b[^>]*>([\s\S]*?)<\/det>/gi;
        let m;
        while ((m = detRegex.exec(nfeXml)) !== null) {
            const det = m[1];
            const cfop = xmlTag(det, 'CFOP');
            // Em NFe, cada tributo tem seu próprio CST:
            //   ICMS: <ICMSxx><CST>YY</CST></ICMSxx>  ou  <ICMSSN...><CSOSN>YY</CSOSN>
            //   PIS:  <PISAliq/PISNT/PISSN><CST>YY</CST>
            //   COFINS: <COFINSAliq/COFINSNT><CST>YY</CST>
            // Extraímos cada um do seu bloco.
            const icmsBlock = (det.match(/<ICMS[\s\S]*?<\/ICMS>/i) || [''])[0];
            const pisBlock  = (det.match(/<PIS[\s\S]*?<\/PIS>/i) || [''])[0];
            const cstIcms = xmlTag(icmsBlock, 'CST') || xmlTag(icmsBlock, 'CSOSN');
            const cstPis  = xmlTag(pisBlock, 'CST');
            // CST "principal" pra análise PIS/COFINS = cstPis quando disponível, senão cai no ICMS
            const cst = cstPis || cstIcms;
            const vProd = parseFloat(xmlTag(det, 'vProd').replace(',','.')) || 0;
            const vBC = parseFloat(xmlTag(icmsBlock, 'vBC').replace(',','.')) || parseFloat(xmlTag(det, 'vBC').replace(',','.')) || 0;
            const vICMS = parseFloat(xmlTag(icmsBlock, 'vICMS').replace(',','.')) || 0;
            const pICMS = parseFloat(xmlTag(icmsBlock, 'pICMS').replace(',','.')) || 0;
            notas.push({
                numero: nNF, emitente: xNome, cfop: cfop,
                cst: cst, cstIcms: cstIcms, cstPis: cstPis,
                natureza: natOp,
                valorTotal: vProd, baseCalculo: vBC,
                valorIcms: vICMS, aliquotaIcms: pICMS,
                tipo: 'PRODUTO'
            });
        }
    }
    return notas;
}
function parseCsv(text) {
    // Remove BOM (Byte Order Mark)
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const linhas = text.split(/\r?\n/).filter(l => l.trim());
    if (linhas.length < 2) return [];
    const sep = linhas[0].includes(';') ? ';' : linhas[0].includes('\t') ? '\t' : ',';
    // Normaliza: remove acentos, lower-case, remove aspas
    const norm = s => String(s||'').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/['"]/g,'').replace(/\s+/g,' ');
    const headers = linhas[0].split(sep).map(norm);
    return linhas.slice(1).map((linha, i) => {
        const cols = linha.split(sep);
        const row = {};
        headers.forEach((h,j) => row[h] = (cols[j]||'').trim().replace(/['"]/g,''));
        const n = k => parseFloat((row[k]||'0').replace(/\./g,'').replace(',','.'))||0;
        // Aceita tanto cabeçalhos simples (cfop) quanto compostos (valor total, valor_total, vproduto)
        return {
            numero: row['numero'] || row['numero nf'] || row['nf'] || row['n nf'] || row['nfnumero'] || String(i+1),
            emitente: row['emitente'] || row['razao social'] || row['fornecedor'] || row['favorecido'] || '',
            cfop: row['cfop'] || row['cfop emissao'] || '',
            cst: row['cst'] || row['csosn'] || row['cst icms'] || row['cst pis'] || row['cst cofins'] || '',
            natureza: row['natureza'] || row['nat op'] || row['nat operacao'] || row['natureza operacao'] || row['descricao'] || '',
            valorTotal: n('valor total') || n('valortotal') || n('valor nota') || n('valor') || n('valor total nota') || n('vprod') || n('valor produto'),
            baseCalculo: n('base calculo') || n('base') || n('valor base') || n('base pis cofins') || n('vbc'),
            valorIcms: n('valor icms') || n('icms') || n('vicms') || n('icms destacado'),
            aliquotaIcms: n('aliq icms') || n('aliquota icms') || n('aliquota') || n('picms') || 0,
            tipo: 'PRODUTO'
        };
    });
}
app.post('/api/analise-creditos/manual', requireAuth, async (req, res) => {
    try {
        const { notas, perfilCliente } = req.body;
        if (!Array.isArray(notas)||!notas.length||!perfilCliente)
            return res.status(400).json({ erro:'Dados incompletos' });
        return res.json({ resultado: calcularResultado(notas, perfilCliente.regime) });
    } catch(err) {
        const { error, requestId } = sanitizeError(err);
        console.error('[analise-creditos/manual]', requestId, err);
        return res.status(500).json({ erro: error, requestId });
    }
});
app.post('/api/analise-creditos/upload', requireAuth, upload.single('arquivo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ erro:'Arquivo não enviado' });
        // Validacao magic-bytes ANTES de processar (anti zip-bomb / binario disfarcado)
        const mb = validarMagicBytes(req.file.buffer, req.file.originalname);
        if (!mb.ok) {
            console.warn('[upload] arquivo rejeitado magic-bytes:', mb.motivo, 'nome=', req.file.originalname);
            return res.status(400).json({ erro: `Arquivo invalido: ${mb.motivo}` });
        }
        const perfil = JSON.parse(req.body.perfil||'{}');
        const nome2=req.file.originalname.toLowerCase();const regime=perfil.regime||'LUCRO_REAL_SERVICOS';if(nome2.endsWith('.xlsx')||nome2.endsWith('.xls')){
            // Detector especifico: fatura Itau Empresas Mastercard (cabecalho longo, valor em col K)
            const gItau = parseXlsxFaturaItauEmpresas(req.file.buffer);
            if (gItau) return res.json(calcularCreditoExpense(gItau, regime));
            const g = parseXlsxExpense(req.file.buffer);
            if (g) return res.json(calcularCreditoExpense(g, regime));
            // fallback: tenta como planilha de notas fiscais (CFOP/CST/Valor)
            const notasXlsx = parseXlsxNotas(req.file.buffer);
            if (notasXlsx && notasXlsx.length > 0) {
                return res.json({ resultado: calcularResultado(notasXlsx, regime) });
            }
            return res.status(400).json({ erro: 'Planilha sem dados reconhecidos. Aceitamos: (1) TIPO DE DESPESA/VALOR, (2) CFOP/CST/Valor Total, (3) Fatura Itau Empresas Mastercard (.xlsx do internet banking).' });
        }
const conteudo = req.file.buffer.toString('utf-8');
        const nome = req.file.originalname.toLowerCase();
        let notas = [];
        if (nome.endsWith('.xml')) {
            notas = parseNFeXml(conteudo);
        } else {
            notas = parseCsv(conteudo);
        }
        if (!notas.length) return res.status(400).json({ erro:'Nenhuma nota encontrada no arquivo' });
        return res.json({ resultado: calcularResultado(notas, regime) });
    } catch(err) {
        const { error, requestId } = sanitizeError(err);
        console.error('[analise-creditos/upload]', requestId, err);
        return res.status(500).json({ erro: error, requestId });
    }
});
// ────────────────────────────────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'dist'), {
    index: 'index.html',
    maxAge: '1y',
    setHeaders: (res, filePath) => {
        // index.html e version.json NUNCA cacheam — UpdateBanner depende disso
        if (filePath.endsWith('index.html') || filePath.endsWith('version.json')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else {
            // Assets versionados (com hash no filename) podem cachear 1 ano
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    },
}));
app.get('/{*splat}', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
    // SPA fallback: NUNCA cachear (cada request precisa pegar o index.html freshly)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// POST /api/admin/sharepoint/cron-alertas
//   Frente 3 — varre Empresas, detecta docs novos, alerta admins por e-mail.
//   Protegida por X-Cron-Secret (header). Sem login — chamada pelo Cloud Scheduler.
app.post('/api/admin/sharepoint/cron-alertas', express.json(), async (req, res) => {
    const cronSecret = req.headers['x-cron-secret'];
    const expected = process.env.SEFAZ_CRON_SECRET;
    if (!secretsMatch(cronSecret, expected)) {
        return res.status(401).json({ ok: false, error: 'Cron nao autorizado' });
    }
    try {
        const r = await processarAlertasSharePoint();
        return res.json(r);
    } catch (err) {
        console.error('[sharepoint/cron-alertas]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// POST /api/tarefas/cron-mensal
//   Cron mensal — cria tarefas automaticas pra todas as empresas.
//   Protegida por X-Cron-Secret (header). Chamada pelo Cloud Scheduler dia 1, 03h BRT.
//   Body opcional: { competencia: "MM/AAAA" }  (default: mes corrente)
app.post('/api/tarefas/cron-mensal', express.json(), async (req, res) => {
    const cronSecret = req.headers['x-cron-secret'];
    const expected = process.env.SEFAZ_CRON_SECRET;
    if (!secretsMatch(cronSecret, expected)) {
        return res.status(401).json({ ok: false, error: 'Cron nao autorizado' });
    }
    try {
        const { executarCronMensal } = await import('./sefaz-backend/tarefas-orchestrator.js');
        const competencia = (req.body && req.body.competencia) || null;
        const r = await executarCronMensal(competencia);
        return res.json({ ok: true, ...r });
    } catch (err) {
        console.error('[tarefas/cron-mensal]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// POST /api/tarefas/aplicar-carteira
//   Atribui retroativamente as tarefas sem dono ao titular da Carteira.
//   Idempotente. Protegida por X-Cron-Secret.
app.post('/api/tarefas/aplicar-carteira', express.json(), async (req, res) => {
    const cronSecret = req.headers['x-cron-secret'];
    const expected = process.env.SEFAZ_CRON_SECRET;
    if (!secretsMatch(cronSecret, expected)) {
        return res.status(401).json({ ok: false, error: 'Cron nao autorizado' });
    }
    try {
        const { aplicarCarteiraRetroativo } = await import('./sefaz-backend/tarefas-orchestrator.js');
        const r = await aplicarCarteiraRetroativo();
        return res.json({ ok: true, ...r });
    } catch (err) {
        console.error('[tarefas/aplicar-carteira]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// POST /api/tarefas/gerar-empresa
//   Smoke / sob demanda — gera tarefas pra 1 empresa especifica.
//   Protegida por X-Cron-Secret. Body: { empresaId, competencia? }
app.post('/api/tarefas/gerar-empresa', express.json(), async (req, res) => {
    const cronSecret = req.headers['x-cron-secret'];
    const expected = process.env.SEFAZ_CRON_SECRET;
    if (!secretsMatch(cronSecret, expected)) {
        return res.status(401).json({ ok: false, error: 'Cron nao autorizado' });
    }
    const { empresaId, competencia } = req.body || {};
    if (!empresaId) return res.status(400).json({ ok: false, error: 'empresaId obrigatorio' });
    try {
        const { gerarTarefasDeUmaEmpresa } = await import('./sefaz-backend/tarefas-orchestrator.js');
        const r = await gerarTarefasDeUmaEmpresa(empresaId, competencia || null);
        return res.json({ ok: true, ...r });
    } catch (err) {
        console.error('[tarefas/gerar-empresa]', err);
        return respondeErro(res, err, undefined, { formatoOk: true });
    }
});

// Middleware global de erro: catch-all pra erros nao tratados (next(err)) e
// throws sincronos em handlers (Express 5). Sanitiza msg antes de devolver
// ao cliente. PRECISA ser o ultimo middleware registrado.
app.use(errorMiddleware);

app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
