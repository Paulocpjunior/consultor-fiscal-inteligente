import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
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

// ─── Gemini Client (chave fica APENAS no servidor) ───────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY não configurada!');
    process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Proxy endpoint: Consulta Fiscal ─────────────────────────────────────────
app.post('/api/fiscal/query', async (req, res) => {
    const { prompt, model = 'gemini-2.0-flash' } = req.body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: 'Campo "prompt" é obrigatório.' });
    }

    if (prompt.length > 4000) {
        return res.status(400).json({ error: 'Prompt muito longo (máx 4000 chars).' });
    }

    try {
        const response = await ai.models.generateContent({
            model,
            contents: prompt,
        });

        const text = response.text ?? '';
        return res.json({ text });
    } catch (err) {
        console.error('Erro Gemini:', err?.message);

        const status = err?.status || 500;
        const message = err?.message || 'Erro ao comunicar com a IA.';

        return res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
    }
});

// ─── Proxy endpoint: Comparação ───────────────────────────────────────────────
app.post('/api/fiscal/compare', async (req, res) => {
    const { prompt, model = 'gemini-2.0-flash' } = req.body;

    if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Campo "prompt" é obrigatório.' });
    }

    try {
        const response = await ai.models.generateContent({
            model,
            contents: prompt,
        });

        return res.json({ text: response.text ?? '' });
    } catch (err) {
        console.error('Erro Gemini (compare):', err?.message);
        return res.status(500).json({ error: err?.message || 'Erro interno.' });
    }
});

// ─── Proxy endpoint: Serviços similares ──────────────────────────────────────
app.post('/api/fiscal/similar', async (req, res) => {
    const { prompt, model = 'gemini-2.0-flash' } = req.body;

    if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Campo "prompt" é obrigatório.' });
    }

    try {
        const response = await ai.models.generateContent({
            model,
            contents: prompt,
        });

        return res.json({ text: response.text ?? '' });
    } catch (err) {
        console.error('Erro Gemini (similar):', err?.message);
        return res.status(500).json({ error: err?.message || 'Erro interno.' });
    }
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
