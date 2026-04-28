import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = process.env.PORT || 8080;

// ─── Segurança ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({ limit: '10kb' })); // Limita payload

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
    methods: ['POST'],
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

// === Retry wrapper para 429/500/503 (Gemini quota) =========================
async function geminiWithRetry(fn, maxRetries = 5) {
    let lastErr;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            const msg = err?.message || '';
            const status = err?.status || 0;
            const isQuota = status === 429
                || status === 500
                || status === 503
                || msg.includes('429')
                || msg.includes('500')
                || msg.includes('503')
                || msg.includes('RESOURCE_EXHAUSTED')
                || msg.includes('Quota');
            if (!isQuota || i === maxRetries - 1) throw err;
            const baseMs = Math.min(4000 * Math.pow(2, i), 60000);
            const waitMs = baseMs + Math.floor(Math.random() * 1000);
            console.warn('[Gemini retry] ' + (i+1) + '/' + maxRetries + ' em ' + Math.round(waitMs/1000) + 's (status=' + status + ' ' + msg.substring(0, 80) + ')');
            await new Promise(r => setTimeout(r, waitMs));
        }
    }
    throw lastErr;
}



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
        const response = await geminiWithRetry(() => ai.models.generateContent({
            model,
            contents: prompt,
        }));

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
        const response = await geminiWithRetry(() => ai.models.generateContent({
            model,
            contents: prompt,
        }));

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
        const response = await geminiWithRetry(() => ai.models.generateContent({
            model,
            contents: prompt,
        }));

        return res.json({ text: response.text ?? '' });
    } catch (err) {
        console.error('Erro Gemini (similar):', err?.message);
        return res.status(500).json({ error: err?.message || 'Erro interno.' });
    }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Proxy Gemini rodando na porta ${PORT}`);
    console.log(`   CORS permitido para: ${ALLOWED_ORIGINS.join(', ') || 'todos (desenvolvimento)'}`);
});
