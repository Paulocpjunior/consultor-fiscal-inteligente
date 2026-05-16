import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import multer from 'multer';
import * as XLSX from 'xlsx';
import sefazCertRouter from './sefaz-backend/cert-manager.js';
import sefazSyncRouter from './sefaz-backend/sync-routes.js';
import sefazManifestoRouter from './sefaz-backend/manifesto-routes.js';
import sefazNfseSpRouter from './sefaz-backend/nfse-sp-routes.js';
import spedFiscalRouter from './sefaz-backend/sped-fiscal-routes.js';
import caixaPostalRouter from './sefaz-backend/caixa-postal-routes.js';
import dasRouter from './sefaz-backend/das-routes.js';
import dctfwebRouter from './sefaz-backend/dctfweb-routes.js';
import nfseNacRouter from './sefaz-backend/nfse-nacional-routes.js';
import * as sharepoint from './sefaz-backend/sharepoint-provider.js';
import * as sharepointSync from './sefaz-backend/sharepoint-sync-orchestrator.js';
import certEmpresaRouter from './sefaz-backend/cert-empresa-routes.js';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
// Cloud Run roda atrás de 1 proxy (Google Front End)
// Necessário pra express-rate-limit ler X-Forwarded-For correto
app.set('trust proxy', 1);
app.use('/api/admin/sefaz', sefazCertRouter);
app.use('/api/admin/sefaz', sefazSyncRouter);
app.use('/api/admin/sefaz', sefazManifestoRouter);
app.use('/api/admin/sefaz', sefazNfseSpRouter);
app.use('/api/admin/sped-fiscal', spedFiscalRouter);
app.use('/api/admin/caixa-postal', caixaPostalRouter);
app.use('/api/admin/das', dasRouter);
app.use('/api/admin/dctfweb', dctfwebRouter);
app.use('/api/admin/nfse-nacional', nfseNacRouter);
app.use('/api/admin/cert-empresa', certEmpresaRouter);

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
    if (hasAttachment) return 'gemini-2.5-pro';
    // 3. Prompt longo -> Pro
    const len = typeof prompt === 'string' ? prompt.length : (prompt ? JSON.stringify(prompt).length : 0);
    if (len > 4000) return 'gemini-2.5-pro';
    // 4. Keywords analiticas -> Pro
    if (typeof prompt === 'string' && GEMINI_KEYWORDS_ANALITICAS.test(prompt)) {
        return 'gemini-2.5-pro';
    }
    // 5. Default: Flash (barato)
    return 'gemini-2.5-flash';
}

function logGeminiRoute(modelo, contexto) {
    const tag = modelo === 'gemini-2.5-flash' ? 'FLASH' : 'PRO  ';
    console.log(`[gemini-router] ${tag} ${JSON.stringify(contexto)}`);
}

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ai: !!ai, timestamp: new Date().toISOString() });
});

app.post('/api/fiscal/query', requireAI, async (req, res) => {
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
        return res.status(500).json({ error: err?.message || 'Erro IA' });
    }
});

app.post('/api/fiscal/multimodal', requireAI, async (req, res) => {
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
        return res.status(500).json({ error: err?.message || 'Erro' });
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

app.get('/api/admin/das/previsao/:empresaId', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const db = adminMod.firestore();

        const empresaId = req.params.empresaId;
        const empSnap = await db.collection('simples_empresas').doc(empresaId).get();
        if (!empSnap.exists) return res.status(404).json({ error: 'empresa nao encontrada' });
        const emp = empSnap.data();
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
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/das/previsao-ia', requireAI, async (req, res) => {
    try {
        const role = req.headers['x-user-res'] || req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        return res.status(500).json({ error: err.message });
    }
});

// ─── Empresa: contato (email + telefone) ──────────────────────────────────
app.get('/api/admin/empresa-contato/:cnpj', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

        const cnpjLimpo = (req.params.cnpj || '').replace(/\D/g, '');
        if (!cnpjLimpo) return res.json({ email: '', telefone: '' });

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
        return res.status(500).json({ error: err.message });
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

app.get('/api/admin/das/anomalias/:empresaId', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const db = adminMod.firestore();

        const snap = await db.collection('simples_empresas').doc(req.params.empresaId).get();
        if (!snap.exists) return res.status(404).json({ error: 'empresa nao encontrada' });

        const emp = { id: snap.id, ...snap.data() };
        const result = detectarAnomalias(emp);

        return res.json({
            empresa: { id: emp.id, nome: emp.nome, cnpj: emp.cnpj, anexo: emp.anexo },
            ...result,
            geradoEm: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[das/anomalias]', err);
        return res.status(500).json({ error: err.message });
    }
});

// Endpoint global: scaneia todas as empresas e retorna as que tem anomalias
app.get('/api/admin/das/anomalias-todas', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const db = adminMod.firestore();

        const snap = await db.collection('simples_empresas').get();
        const resultados = [];
        snap.forEach(d => {
            const emp = { id: d.id, ...d.data() };
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
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/das/anomalia-explicar', requireAI, async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        return res.status(500).json({ error: err.message });
    }
});

// ─── Cobranca DAS via IA ───────────────────────────────────────────────────
// POST /api/admin/das/cobranca-ia
// Gera draft de email/whatsapp pro cliente. NUNCA envia automaticamente.
app.post('/api/admin/das/cobranca-ia', requireAI, async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

        const { empresaNome, valor, competencia, vencimento, diasAtraso, tom, assinante, canal } = req.body;
        if (!empresaNome || !valor) {
            return res.status(400).json({ error: 'empresaNome e valor obrigatorios' });
        }

        const tomMsg = tom === 'firme'
            ? 'tom profissional, direto e firme. Sem rodeios. Mencione consequencias do atraso (juros 0,33% ao dia + multa 20% conforme legislacao).'
            : 'tom cordial, profissional e empatico. Reconheca que pode ter havido motivo. Convide a regularizacao sem ameacar.';

        const canalMsg = canal === 'whatsapp'
            ? 'mensagem de WhatsApp curta (200-400 caracteres). Use quebras de linha. Sem cumprimento formal de email. Sem assunto.'
            : 'corpo de email profissional (5-8 linhas). Comece com saudacao curta. Termine com a assinatura.';

        const valorBR = `R$ ${(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

        const prompt = `Voce eh o assistente fiscal de uma contabilidade brasileira (SP Assessoria Contabil).
Gere uma cobranca pro cliente cuja empresa esta com DAS Simples Nacional vencido.

Dados:
- Empresa: ${empresaNome}
- Valor: ${valorBR}
- Competencia (mes referencia): ${competencia || 'N/I'}
- Vencimento original: ${vencimento || 'N/I'}
- Dias em atraso: ${diasAtraso || 'N/I'} dias
- Assinante: ${assinante || 'Equipe SP Contabil'}

Tom: ${tomMsg}

Formato: ${canalMsg}

REGRAS IMPORTANTES:
- NAO invente prazos, multas ou juros especificos alem dos padroes legais (0,33% dia + 20%).
- NAO mencione bloqueios bancarios nem ameacas vagas.
- NAO use emojis (mensagem profissional).
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
        return res.status(500).json({ error: err.message });
    }
});

// ─── SharePoint (Microsoft Graph API) ─────────────────────────────────────
// Rotas administrativas pra configurar/testar acesso ao SharePoint.
// Permissao: apenas admin.

// GET /api/admin/sharepoint/test-auth
//   Valida credenciais OAuth2 + resolve site ID. Nao expoe secret.
app.get('/api/admin/sharepoint/test-auth', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
app.post('/api/admin/sharepoint/grant-site', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
app.get('/api/admin/sharepoint/list-drives', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });
        const drives = await sharepoint.listDrives();
        return res.json({ ok: true, drives });
    } catch (err) {
        console.error('[sharepoint/list-drives]', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/sharepoint/list-root
//   Lista raiz do drive default (pastas e arquivos no nivel raiz).
app.get('/api/admin/sharepoint/list-root', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });
        const items = await sharepoint.listRootItems();
        return res.json({ ok: true, items });
    } catch (err) {
        console.error('[sharepoint/list-root]', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/admin/sharepoint/test-write
//   Cria pasta /Empresas/_test/ + arquivo dentro pra validar escrita.
app.post('/api/admin/sharepoint/test-write', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
app.get('/api/admin/sharepoint/check-folder', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/sharepoint/empresa-folder?cnpj=...
//   Retorna URL clicavel pra pasta da empresa (pra UI).
app.get('/api/admin/sharepoint/empresa-folder', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/admin/sharepoint/upload-xml
//   Body: { cnpj, periodo: 'YYYY-MM', fileName: 'NFe123.xml', xmlContent: '<xml>...</xml>' }
//   Upload manual de XML pra empresa (usado depois pelo cron).
app.post('/api/admin/sharepoint/upload-xml', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/admin/sharepoint/upload-relatorio
//   Body: { cnpj, subPath: 'PGDAS/2026-05.pdf', content: base64, mimeType: 'application/pdf' }
//   Upload de relatorio pra empresa.
app.post('/api/admin/sharepoint/upload-relatorio', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/sharepoint/sync-dry-run?cnpj=&periodo=2026-05
//   Pre-visualizacao: lista o que SERIA sincronizado, sem subir nada.
app.get('/api/admin/sharepoint/sync-dry-run', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/admin/sharepoint/sync-empresa
//   Body: { cnpj, periodo: 'YYYY-MM', force: bool }
//   Sincroniza uma empresa+periodo. Idempotente (skipa o que ja foi).
//   force=true re-uploada tudo.
app.post('/api/admin/sharepoint/sync-empresa', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/admin/sharepoint/sync-all
//   Body: { periodo: 'YYYY-MM', force: bool, maxEmpresas: int }
//   Sincroniza TODAS as empresas (simples + lucro) pro periodo.
//   Usado pelo cron noturno + botao admin.
app.post('/api/admin/sharepoint/sync-all', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

        const { periodo, force = false, maxEmpresas = null } = req.body || {};
        if (!periodo) return res.status(400).json({ error: 'periodo obrigatorio' });

        const stats = await sharepointSync.syncAllEmpresas({
            periodo, force, maxEmpresas,
        });
        return res.json({ ok: true, ...stats });
    } catch (err) {
        console.error('[sharepoint/sync-all]', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/sharepoint/sync-log?limit=10
//   Retorna as N ultimas execucoes do cron (ou manual via sync-all).
app.get('/api/admin/sharepoint/sync-log', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// DELETE /api/admin/sharepoint/cleanup-test
//   Remove pasta de teste apos validacao.
app.delete('/api/admin/sharepoint/cleanup-test', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

        const result = await sharepoint.deleteItem('Empresas/_test_cfi');
        return res.json({ ok: true, ...result });
    } catch (err) {
        console.error('[sharepoint/cleanup-test]', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/sharepoint/list-folder?path=Pasta1/Subpasta
//   Lista items de pasta especifica.
app.get('/api/admin/sharepoint/list-folder', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });
        const path = req.query.path || '/';
        const items = await sharepoint.listFolderItems(path);
        return res.json({ ok: true, path, items });
    } catch (err) {
        console.error('[sharepoint/list-folder]', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/admin/sharepoint/list-permissions
//   Lista permissoes ativas do app no site (debug do grant-site).
app.get('/api/admin/sharepoint/list-permissions', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

        const perms = await sharepoint.listSitePermissions();
        return res.json({ ok: true, perms });
    } catch (err) {
        console.error('[sharepoint/list-permissions]', err);
        return res.status(500).json({ ok: false, error: err.message });
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

app.post('/api/admin/simulador-ibs-cbs', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/simulador-ibs-cbs-explicar', requireAI, async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        return res.status(500).json({ error: err.message });
    }
});

// ─── Conferencia PGDAS-D ───────────────────────────────────────────────────
// POST /api/admin/pgdas/conferir
// Recebe { empresaId, base64Pdf } e retorna comparacao PGDAS vs calculo proprio.
app.post('/api/admin/pgdas/conferir', requireAI, async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
                model: 'gemini-2.5-pro',
                contents: [
                    { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
                    { text: promptExtrator },
                ],
            });
            const txtExt = (respExt.text || '').trim().replace(/^```json|```$/g, '').trim();
            extraido = JSON.parse(txtExt);
        } catch (e) {
            return res.status(500).json({ error: 'Falha ao extrair PGDAS: ' + e.message });
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
        return res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/pgdas/conferir-explicar — IA contextualiza divergencias
app.post('/api/admin/pgdas/conferir-explicar', requireAI, async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        return res.status(500).json({ error: err.message });
    }
});

// ─── Calendario de Obrigacoes Fiscais ──────────────────────────────────────
// GET /api/admin/calendario/:ano/:mes
// Agrega obrigacoes de Simples + Lucro pro mes solicitado.

function ultimoDiaMes(ano, mes) {
    return new Date(ano, mes, 0).getDate();
}

function ajustarDiaUtil(ano, mes0, dia) {
    // mes0 = 0-indexed
    let d = new Date(ano, mes0, dia);
    while (d.getDay() === 0 || d.getDay() === 6) {
        d.setDate(d.getDate() + 1);
    }
    return d.toISOString().slice(0, 10);
}

function calcularObrigacoesEmpresa(empresa, regimeKind, ano, mes) {
    // ano: 4 digits; mes: 1-12
    // Retorna lista de obrigacoes pra essa empresa nesse mes
    const obrs = [];
    const mes0 = mes - 1;  // pro construtor Date

    if (regimeKind === 'simples') {
        // 1. DAS Simples - dia 20 do mes seguinte (referencia ao mes anterior)
        // Ex: DAS de janeiro vence em 20 de fevereiro.
        // Quando o usuario pede 'mes=2', mostramos DAS referente a janeiro.
        // Logo: o DAS daquele mes solicitado vence no dia 20 desse mes
        // (referencia eh o mes anterior).
        const venc = ajustarDiaUtil(ano, mes0, 20);
        const refMes = mes0 === 0 ? 12 : mes - 1;
        const refAno = mes0 === 0 ? ano - 1 : ano;
        obrs.push({
            tipo: 'DAS',
            descricao: `DAS Simples Nacional - ref. ${String(refMes).padStart(2,'0')}/${refAno}`,
            empresaId: empresa.id,
            empresaNome: empresa.nome,
            empresaCnpj: empresa.cnpj,
            anexo: empresa.anexo,
            vencimento: venc,
            regime: 'Simples',
            urgencia: 'mensal',
        });

        // 2. DEFIS - 31 de marco (anual)
        if (mes === 3) {
            obrs.push({
                tipo: 'DEFIS',
                descricao: `DEFIS - Declaracao anual ano-base ${ano - 1}`,
                empresaId: empresa.id,
                empresaNome: empresa.nome,
                empresaCnpj: empresa.cnpj,
                anexo: empresa.anexo,
                vencimento: ajustarDiaUtil(ano, mes0, 31),
                regime: 'Simples',
                urgencia: 'anual',
            });
        }
    }

    if (regimeKind === 'lucro') {
        const regime = empresa.regime || 'Presumido';

        // 3. DARF IRPJ + CSLL Lucro Presumido - ultimo dia util do mes
        //    seguinte ao trimestre (jan/abr/jul/out -> abril/julho/out/jan)
        if (regime === 'Presumido') {
            // Trimestres terminam em mar/jun/set/dez
            // DARF vence no ultimo dia util de abr/jul/out/jan
            const mesesDarf = { 4: 1, 7: 2, 10: 3, 1: 4 };  // mes -> trimestre encerrado
            if (mesesDarf[mes]) {
                const trimestre = mesesDarf[mes];
                const anoRef = mes === 1 ? ano - 1 : ano;
                const venc = ajustarDiaUtil(ano, mes0, ultimoDiaMes(ano, mes));
                obrs.push({
                    tipo: 'DARF-IRPJ',
                    descricao: `DARF IRPJ Lucro Presumido - T${trimestre}/${anoRef}`,
                    empresaId: empresa.id,
                    empresaNome: empresa.nome,
                    empresaCnpj: empresa.cnpj,
                    vencimento: venc,
                    regime: 'Lucro Presumido',
                    urgencia: 'trimestral',
                });
                obrs.push({
                    tipo: 'DARF-CSLL',
                    descricao: `DARF CSLL Lucro Presumido - T${trimestre}/${anoRef}`,
                    empresaId: empresa.id,
                    empresaNome: empresa.nome,
                    empresaCnpj: empresa.cnpj,
                    vencimento: venc,
                    regime: 'Lucro Presumido',
                    urgencia: 'trimestral',
                });
            }
        }

        // 4. PIS/COFINS - dia 25 do mes seguinte (Lucro)
        const refPisMes = mes0 === 0 ? 12 : mes - 1;
        const refPisAno = mes0 === 0 ? ano - 1 : ano;
        obrs.push({
            tipo: 'PIS-COFINS',
            descricao: `DARF PIS/COFINS - ref. ${String(refPisMes).padStart(2,'0')}/${refPisAno}`,
            empresaId: empresa.id,
            empresaNome: empresa.nome,
            empresaCnpj: empresa.cnpj,
            vencimento: ajustarDiaUtil(ano, mes0, 25),
            regime: regime === 'Real' ? 'Lucro Real' : 'Lucro Presumido',
            urgencia: 'mensal',
        });

        // 5. DCTF Mensal - dia 15 do 2o mes seguinte
        // DCTF de janeiro entrega ate 15 de marco. Logo, no mes solicitado,
        // mostramos a DCTF referente ao mes anterior ao anterior.
        const refDctfMes = mes0 <= 1 ? 12 + mes0 - 1 : mes - 2;
        const refDctfAno = mes0 <= 1 ? ano - 1 : ano;
        obrs.push({
            tipo: 'DCTF',
            descricao: `DCTF Mensal - ref. ${String(refDctfMes).padStart(2,'0')}/${refDctfAno}`,
            empresaId: empresa.id,
            empresaNome: empresa.nome,
            empresaCnpj: empresa.cnpj,
            vencimento: ajustarDiaUtil(ano, mes0, 15),
            regime: regime === 'Real' ? 'Lucro Real' : 'Lucro Presumido',
            urgencia: 'mensal',
        });
    }

    // 6. eSocial + GFIP/DCTFWeb - empresas com folha (folha12 > 0)
    const folha = empresa.folha12 || empresa.folha_12 || 0;
    if (folha > 0) {
        const refMes = mes0 === 0 ? 12 : mes - 1;
        const refAno = mes0 === 0 ? ano - 1 : ano;
        obrs.push({
            tipo: 'ESOCIAL',
            descricao: `eSocial / FGTS - ref. ${String(refMes).padStart(2,'0')}/${refAno}`,
            empresaId: empresa.id,
            empresaNome: empresa.nome,
            empresaCnpj: empresa.cnpj,
            vencimento: ajustarDiaUtil(ano, mes0, 7),
            regime: regimeKind === 'simples' ? 'Simples' : (empresa.regime === 'Real' ? 'Lucro Real' : 'Lucro Presumido'),
            urgencia: 'mensal',
        });
        obrs.push({
            tipo: 'DCTFWEB',
            descricao: `DCTFWeb - ref. ${String(refMes).padStart(2,'0')}/${refAno}`,
            empresaId: empresa.id,
            empresaNome: empresa.nome,
            empresaCnpj: empresa.cnpj,
            vencimento: ajustarDiaUtil(ano, mes0, 15),
            regime: regimeKind === 'simples' ? 'Simples' : (empresa.regime === 'Real' ? 'Lucro Real' : 'Lucro Presumido'),
            urgencia: 'mensal',
        });
    }

    return obrs;
}

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
            obrigacoes.push(...calcularObrigacoesEmpresa(e, 'simples', ano, mes));
        });
        lucroSnap.forEach(d => {
            const e = { id: d.id, ...d.data() };
            obrigacoes.push(...calcularObrigacoesEmpresa(e, 'lucro', ano, mes));
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
            limitacoes: 'Datas calculadas excluem apenas fins de semana. Feriados nacionais e municipais NAO sao considerados — verificar no calendario oficial.',
        });
    } catch (err) {
        console.error('[calendario]', err);
        return res.status(500).json({ error: err.message });
    }
});

// ─── Dashboard CEO — endpoint de KPIs + insights IA ─────────────────────────
app.get('/api/admin/dashboard-ceo/kpis', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        const totalEmpresas = simplesSnap.size + lucroSnap.size;

        // ── Caixa Postal
        const cxSnap = await db.collection('caixa_postal_mensagens').limit(2000).get();
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
        const dasSnap = await db.collection('das_emitidos').limit(2000).get();
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
        const nfseSnap = await db.collection('nfse_nacional_emitidas').limit(2000).get();
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
        });
    } catch (err) {
        console.error('[dashboard-ceo/kpis]', err);
        return res.status(500).json({ error: err.message });
    }
});

function getMesNome(yyyymm) {
    const [_, m] = yyyymm.split('-');
    const meses = { '01':'janeiro','02':'fevereiro','03':'marco','04':'abril','05':'maio','06':'junho','07':'julho','08':'agosto','09':'setembro','10':'outubro','11':'novembro','12':'dezembro' };
    return meses[m] || '';
}

app.get('/api/admin/dashboard-ceo/acoes', async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

        const adminMod = (await import('firebase-admin')).default;
        if (!adminMod.apps.length) {
            adminMod.initializeApp({ credential: adminMod.credential.applicationDefault() });
        }
        const db = adminMod.firestore();

        const acoes = [];
        const hoje = new Date().toISOString().slice(0, 10);
        const mesAtual = hoje.slice(0, 7);

        // ── 1. Mensagens criticas Caixa Postal (urgencia ALTA)
        const cxSnap = await db.collection('caixa_postal_mensagens').limit(2000).get();
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
                if (e.cnpj) nomePorCnpj.set(e.cnpj.replace(/\D/g, ''), e.nome);
            });
            lucAll.forEach(d => {
                const e = d.data();
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
        const dasSnap = await db.collection('das_emitidos').limit(2000).get();
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
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/dashboard-ceo/insights', requireAI, async (req, res) => {
    try {
        const role = req.headers['x-user-role'] || 'colaborador';
        if (role !== 'admin') return res.status(403).json({ error: 'apenas admin' });

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
        return res.status(500).json({ error: err.message });
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
app.post('/api/analise-creditos/manual', async (req, res) => {
    try {
        const { notas, perfilCliente } = req.body;
        if (!Array.isArray(notas)||!notas.length||!perfilCliente)
            return res.status(400).json({ erro:'Dados incompletos' });
        return res.json({ resultado: calcularResultado(notas, perfilCliente.regime) });
    } catch(err) { return res.status(500).json({ erro: err.message||'Erro interno' }); }
});
app.post('/api/analise-creditos/upload', upload.single('arquivo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ erro:'Arquivo não enviado' });
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
    } catch(err) { return res.status(500).json({ erro: err.message||'Erro ao processar arquivo' }); }
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

app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
