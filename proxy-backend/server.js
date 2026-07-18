import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import admin from 'firebase-admin';
import {
    getAccessToken,
    listXmlFiles,
    downloadXmlContent,
    syncXmlsFromFolder,
    checkCredentials,
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

async function requireProxyAuth(req, res, next) {
    try {
        const auth = req.headers.authorization || '';
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ error: 'Token ausente' });

        const token = m[1].trim();
        if (PROXY_SHARED_TOKEN && token === PROXY_SHARED_TOKEN) {
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
app.use(express.json({ limit: '50mb' })); // Limita payload (increased for XML sync)

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
app.get('/api/sharepoint/health', (_req, res) => {
    const status = checkCredentials();
    res.json({
        status: status.configured ? 'ok' : 'missing_credentials',
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

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Proxy rodando na porta ${PORT}`);
    console.log(`   CORS permitido para: ${ALLOWED_ORIGINS.join(', ')}`);
    const creds = checkCredentials();
    console.log(`   SharePoint: ${creds.configured ? '✅ credenciais configuradas' : '⚠️  credenciais não configuradas'}`);
});
