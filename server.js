import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20mb' }));
app.use('/api/', rateLimit({ windowMs: 60000, max: 120, message: { error: 'Aguarde.' } }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let ai = null;
if (GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    console.log('Gemini API configurada');
} else {
    console.warn('GEMINI_API_KEY nao configurada');
}

const requireAI = (req, res, next) => {
    if (!ai) return res.status(503).json({ error: 'IA indisponivel' });
    next();
};

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ai: !!ai, timestamp: new Date().toISOString() });
});

app.post('/api/fiscal/query', requireAI, async (req, res) => {
    const { prompt, model, temperature, googleSearch } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt obrigatorio' });
    try {
        const requestBody = { model: model || 'gemini-2.0-flash', contents: prompt };
        if (temperature !== undefined) requestBody.config = { temperature };
        if (googleSearch) {
            requestBody.config = requestBody.config || {};
            requestBody.config.tools = [{ googleSearch: {} }];
        }
        const response = await ai.models.generateContent(requestBody);
        return res.json({ text: response.text ?? '', candidates: response.candidates || [] });
    } catch (err) {
        console.error('Erro Gemini:', err?.message);
        return res.status(500).json({ error: err?.message || 'Erro IA' });
    }
});

app.post('/api/fiscal/multimodal', requireAI, async (req, res) => {
    const { prompt, base64Data, mimeType, model } = req.body;
    if (!prompt || !base64Data || !mimeType) return res.status(400).json({ error: 'campos obrigatorios' });
    try {
        const response = await ai.models.generateContent({
            model: model || 'gemini-2.0-flash',
            contents: [{ inlineData: { mimeType, data: base64Data } }, { text: prompt }],
        });
        return res.json({ text: response.text ?? '', candidates: response.candidates || [] });
    } catch (err) {
        return res.status(500).json({ error: err?.message || 'Erro' });
    }
});

app.use(express.static(join(__dirname, 'dist'), { maxAge: '1y', index: 'index.html' }));
app.get('/{*splat}', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
    res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
