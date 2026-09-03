import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import admin from 'firebase-admin';
import {
    getAccessToken,
    listXmlFiles,
    downloadXmlContent,
    syncXmlsFromFolder,
    uploadXmlToFolder,
    checkCredentials,
    checkAuth,
    listarSites,
    listarPastas,
} from './sharepoint-sync.js';

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 8080;
const PROXY_SHARED_TOKEN = (process.env.SHAREPOINT_PROXY_TOKEN || process.env.PROXY_SHARED_TOKEN || '').trim();

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Compara o token compartilhado em TEMPO CONSTANTE.
 *
 * `token === PROXY_SHARED_TOKEN` para no primeiro byte diferente — num serviço
 * `--allow-unauthenticated` isso vaza, pelo tempo de resposta, quantos bytes
 * do prefixo o atacante já acertou. `timingSafeEqual` exige buffers do MESMO
 * tamanho; tamanho diferente devolve false direto (o comprimento do segredo
 * não é o segredo — é o conteúdo que a comparação protege).
 */
function tokenConfere(recebido, esperado) {
    if (!esperado || typeof recebido !== 'string') return false;
    const a = Buffer.from(recebido, 'utf8');
    const b = Buffer.from(esperado, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

async function requireProxyAuth(req, res, next) {
    try {
        const auth = req.headers.authorization || '';
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ error: 'Token ausente' });

        const token = m[1].trim();
        if (tokenConfere(token, PROXY_SHARED_TOKEN)) {
            req.user = { source: 'shared-token', role: 'service' };
            return next();
        }

        const decoded = await fa().auth().verifyIdToken(token);
        const userDoc = await fa().firestore().collection('users').doc(decoded.uid).get();
        const role = userDoc.exists ? userDoc.data().role : null;
        if (role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a admin' });

        req.user = { source: 'firebase', uid: decoded.uid, email: decoded.email || null, role };
        return next();
    } catch (err) {
        console.error('[proxy-auth]', err?.message || err);
        return res.status(401).json({ error: 'Token invalido ou expirado' });
    }
}

// ─── Segurança ────────────────────────────────────────────────────────────────
app.use(helmet());
// Corpo JSON PEQUENO por padrão. O `50mb` global vinha ANTES da autenticação,
// num serviço `--allow-unauthenticated`: qualquer um na internet fazia o proxy
// alocar até 50 MB por requisição sem token nenhum. Só o /upload (que recebe o
// arquivo em base64) precisa do teto alto — e ele é montado NA ROTA, depois do
// `requireProxyAuth`. O parser pequeno PULA essa rota: se corresse antes, um
// upload de 5 MB levaria 413 do global antes de chegar ao parser de 50 MB.
const ROTA_UPLOAD = '/api/sharepoint/upload';
const jsonPequeno = express.json({ limit: '100kb' });
app.use((req, res, next) => (req.path === ROTA_UPLOAD ? next() : jsonPequeno(req, res, next)));

// CORS: aceita apenas origens conhecidas; chamadas server-to-server sem Origin passam.
const ALLOWED_ORIGINS = [
    ...(process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()),
    ...(process.env.CORS_ORIGIN || '').split(',').map(o => o.trim()),
    'https://consultorfiscalapp.web.app',
    'https://consultorfiscalapp.firebaseapp.com',
    // App servido tambem pela URL do Cloud Run (consultor-fiscal-inteligente).
    // Sem isto o navegador bloqueava o /api/sharepoint/health e a aba SharePoint
    // mostrava "Proxy indisponivel" mesmo com o proxy no ar.
    'https://consultor-fiscal-inteligente-631239634290.us-west1.run.app',
    'http://localhost:3000',
    'http://localhost:5173',
].filter(Boolean);

// Regex de seguranca: qualquer host run.app do app principal (numeros/revisoes
// mudam) e do proprio firebase, para nao voltar a quebrar por CORS.
const ALLOWED_ORIGIN_RE = /^https:\/\/consultor-fiscal-inteligente-[a-z0-9-]+\.us-west1\.run\.app$/;

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGIN_RE.test(origin)) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type'],
}));

// Rate limiting: 60 req/min por IP
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas requisições. Aguarde um momento.' },
});
app.use('/api/', limiter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/sharepoint', requireProxyAuth);

// ─── SharePoint: Health check ────────────────────────────────────────────────
// 🚦 O /health TENTA O TOKEN — validação por RESULTADO, não por status.
//
// Até 28/08 ele respondia `ok` sempre que CLIENT_ID e CLIENT_SECRET existiam,
// SEM olhar o tenant. Com o tenant cravado errado no workflow, o proxy não
// gravava NADA (nem XML, nem a cópia da guia do rito) e o card do CFI mostrava
// "✓ Conectado" em verde. `configured` continua saindo — ele distingue "faltou
// preencher" de "preencheram errado", e são ações diferentes —, mas o VEREDITO
// agora é `tokenOk`.
app.get('/api/sharepoint/health', async (_req, res) => {
    const status = await checkAuth();
    res.json({
        status: status.tokenOk ? 'ok' : (status.configured ? 'auth_failed' : 'missing_credentials'),
        ...status,
        timestamp: new Date().toISOString(),
    });
});

// ─── SharePoint: List XMLs in a folder ──────────────────────────────────────
app.post('/api/sharepoint/list-xmls', async (req, res) => {
    const { folderPath } = req.body;

    if (!folderPath || typeof folderPath !== 'string') {
        return res.status(400).json({ error: 'Campo "folderPath" é obrigatório.' });
    }

    try {
        const token = await getAccessToken();
        const files = await listXmlFiles(token, folderPath);

        return res.json({
            folderPath,
            count: files.length,
            files,
        });
    } catch (err) {
        console.error('Erro SharePoint (list-xmls):', err?.message);
        return res.status(500).json({ error: err?.message || 'Erro ao listar XMLs.' });
    }
});

// ─── SharePoint: Download a single XML ──────────────────────────────────────
app.post('/api/sharepoint/download-xml', async (req, res) => {
    const { driveItemId } = req.body;

    if (!driveItemId || typeof driveItemId !== 'string') {
        return res.status(400).json({ error: 'Campo "driveItemId" é obrigatório.' });
    }

    try {
        const token = await getAccessToken();
        const content = await downloadXmlContent(token, driveItemId);

        return res.json({
            driveItemId,
            content,
        });
    } catch (err) {
        console.error('Erro SharePoint (download-xml):', err?.message);
        return res.status(500).json({ error: err?.message || 'Erro ao baixar XML.' });
    }
});

// ─── SharePoint: Sync XMLs from a folder ────────────────────────────────────
app.post('/api/sharepoint/sync', async (req, res) => {
    const { folderPath } = req.body;

    if (!folderPath || typeof folderPath !== 'string') {
        return res.status(400).json({ error: 'Campo "folderPath" é obrigatório.' });
    }

    try {
        const token = await getAccessToken();
        const result = await syncXmlsFromFolder(token, folderPath);

        return res.json({
            folderPath,
            found: result.found,
            downloaded: result.downloaded,
            errors: result.errors,
            files: result.files,
        });
    } catch (err) {
        console.error('Erro SharePoint (sync):', err?.message);
        return res.status(500).json({ error: err?.message || 'Erro ao sincronizar XMLs.' });
    }
});

// ─── SharePoint: EXPLORAR — "a árvore está em qual site?" ───────────────────
//
// 🔎 02/09. O erro passou a dizer onde procurou e sobrou uma pergunta
// factual: a pasta Empresas/…/XML SAÍDA existe em /sites/ClientesSP2 ou em
// /sites/GRUPOFISCAL? Devolver essa pergunta para uma pessoa navegar no
// SharePoint é o que este dia inteiro ensinou a não fazer — o token já
// funciona, então quem responde é o app.
//
// ⚠️ Só LISTA nome de pasta. Não baixa, não grava, não lê conteúdo.
app.post('/api/sharepoint/explorar', async (req, res) => {
    const { caminho = '', sitePath = '' } = req.body || {};
    try {
        const token = await getAccessToken();
        return res.json(await listarPastas(token, String(caminho), String(sitePath)));
    } catch (err) {
        console.error('Erro SharePoint (explorar):', err?.message);
        return res.status(500).json({ error: err?.message || 'Erro ao explorar pasta.' });
    }
});

// ─── SharePoint: os sites que esta credencial enxerga ───────────────────────
app.post('/api/sharepoint/sites', async (req, res) => {
    const { busca = '*' } = req.body || {};
    try {
        const token = await getAccessToken();
        return res.json({ sites: await listarSites(token, String(busca)) });
    } catch (err) {
        console.error('Erro SharePoint (sites):', err?.message);
        return res.status(500).json({ error: err?.message || 'Erro ao listar sites.' });
    }
});

// ─── SharePoint: Upload de um XML para a pasta do cliente ───────────────────
// O parser de 50 MB entra SÓ aqui, depois do `app.use('/api/sharepoint',
// requireProxyAuth)` acima — corpo grande só de quem provou quem é. A auth lê
// o header, não o corpo, então nada é alocado antes dela.
app.post(ROTA_UPLOAD, express.json({ limit: '50mb' }), async (req, res) => {
    const { folderPath, filename, contentBase64, mimeType } = req.body || {};
    if (!folderPath || !filename || !contentBase64) {
        return res.status(400).json({ error: 'Campos "folderPath", "filename" e "contentBase64" são obrigatórios.' });
    }
    try {
        const token = await getAccessToken();
        const buffer = Buffer.from(String(contentBase64), 'base64');
        const result = await uploadXmlToFolder(token, folderPath, filename, buffer, mimeType || 'application/xml');
        return res.json({ ok: true, ...result });
    } catch (err) {
        console.error('Erro SharePoint (upload):', err?.message);
        return res.status(500).json({ error: err?.message || 'Erro ao subir arquivo.' });
    }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Proxy rodando na porta ${PORT}`);
    console.log(`   CORS permitido para: ${ALLOWED_ORIGINS.join(', ')}`);
    const creds = checkCredentials();
    console.log(`   SharePoint: ${creds.configured ? '✅ credenciais configuradas' : '⚠️  credenciais não configuradas'}`);
});
