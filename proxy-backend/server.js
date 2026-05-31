import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import {
    getAccessToken,
    listXmlFiles,
    downloadXmlContent,
    syncXmlsFromFolder,
    checkCredentials,
} from './sharepoint-sync.js';

const app = express();
const PORT = process.env.PORT || 8080;

// ─── Segurança ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({ limit: '50mb' })); // Limita payload (increased for XML sync)

// CORS: aceita apenas o domínio do seu frontend no Cloud Run
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Permite chamadas sem origin (server-to-server) e origins permitidas
        if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`CORS bloqueado para origin: ${origin}`));
        }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
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
    console.log(`   CORS permitido para: ${ALLOWED_ORIGINS.join(', ') || 'todos (desenvolvimento)'}`);
    const creds = checkCredentials();
    console.log(`   SharePoint: ${creds.configured ? '✅ credenciais configuradas' : '⚠️  credenciais não configuradas'}`);
});
