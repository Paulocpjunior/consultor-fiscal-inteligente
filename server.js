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
import nfseNacRouter from './sefaz-backend/nfse-nacional-routes.js';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
app.use('/api/admin/sefaz', sefazCertRouter);
app.use('/api/admin/sefaz', sefazSyncRouter);
app.use('/api/admin/sefaz', sefazManifestoRouter);
app.use('/api/admin/sefaz', sefazNfseSpRouter);
app.use('/api/admin/sped-fiscal', spedFiscalRouter);
app.use('/api/admin/caixa-postal', caixaPostalRouter);
app.use('/api/admin/das', dasRouter);
app.use('/api/admin/nfse-nacional', nfseNacRouter);

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
        for (const e of empresasCxCriticas.values()) {
            acoes.push({
                tipo: 'caixa-postal',
                urgencia: e.categorias.has('intimacao') ? 'alta' : (e.categorias.has('exclusao') ? 'alta' : 'media'),
                empresaCnpj: e.cnpj,
                empresaId: e.empresaId,
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
            const g = parseXlsxExpense(req.file.buffer);
            if (g) return res.json(calcularCreditoExpense(g, regime));
            // fallback: tenta como planilha de notas fiscais (CFOP/CST/Valor)
            const notasXlsx = parseXlsxNotas(req.file.buffer);
            if (notasXlsx && notasXlsx.length > 0) {
                return res.json({ resultado: calcularResultado(notasXlsx, regime) });
            }
            return res.status(400).json({ erro: 'Planilha sem dados reconhecidos. Use colunas TIPO DE DESPESA/VALOR ou CFOP/CST/Valor Total.' });
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
app.use(express.static(join(__dirname, 'dist'), { maxAge: '1y', index: 'index.html' }));
app.get('/{*splat}', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
    res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
