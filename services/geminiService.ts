
import { SearchType, type SearchResult, type GroundingSource, type ComparisonResult, type NewsAlert, type SimilarService, type CnaeSuggestion, type SimplesNacionalEmpresa, type SimplesNacionalResumo, CnaeTaxDetail } from '../types';

interface ProxyResponse { text: string; candidates?: any[]; }

const callProxy = async (prompt: string | any[], options?: { temperature?: number; googleSearch?: boolean; model?: string }): Promise<ProxyResponse> => {
    if (Array.isArray(prompt)) {
        const textPart = prompt.find((p: any) => p.text)?.text || '';
        const dataPart = prompt.find((p: any) => p.inlineData);
        if (dataPart?.inlineData) {
            const response = await fetch('/api/fiscal/multimodal', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: textPart, base64Data: dataPart.inlineData.data, mimeType: dataPart.inlineData.mimeType, model: options?.model }),
            });
            if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || `Erro ${response.status}`); }
            return await response.json();
        }
    }
    const response = await fetch('/api/fiscal/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt), model: options?.model, temperature: options?.temperature, googleSearch: options?.googleSearch }),
    });
    if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || `Erro ${response.status}`); }
    return await response.json();
};

const withRetry = async <T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
        try { return await fn(); } catch (error: any) {
            lastError = error; const msg = error?.message || '';
            if (msg.includes('503') || msg.includes('429') || msg.includes('500')) {
                await new Promise(r => setTimeout(r, Math.pow(2, i) * 1500 + Math.random() * 1000)); continue;
            }
            throw error;
        }
    }
    throw lastError;
};

const safeJsonParse = (str: string) => {
    let s = str.trim();
    const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m?.[1]) { s = m[1].trim(); } else {
        const fb = s.indexOf('{'), fk = s.indexOf('['), lb = s.lastIndexOf('}'), lk = s.lastIndexOf(']');
        let si = -1, ei = -1;
        if (fb !== -1 && (fk === -1 || fb < fk)) { si = fb; ei = lb; } else if (fk !== -1) { si = fk; ei = lk; }
        if (si !== -1 && ei > si) s = s.substring(si, ei + 1);
    }
    return JSON.parse(s);
};

export const fetchFiscalData = async (type: SearchType, query: string, municipio?: string, alias?: string, responsavel?: string, cnae?: string, regimeTributario?: string, reformaQuery?: string, aliquotaIcms?: string, aliquotaPisCofins?: string, aliquotaIss?: string, userNotes?: string): Promise<SearchResult> => {
    let ctx = [];
    if (municipio) ctx.push(`Município: ${municipio}`); if (alias) ctx.push(`Tomador: ${alias}`);
    if (regimeTributario) ctx.push(`Regime: ${regimeTributario}`); if (aliquotaIcms) ctx.push(`ICMS: ${aliquotaIcms}%`);
    if (aliquotaPisCofins) ctx.push(`PIS/COFINS: ${aliquotaPisCofins}%`); if (aliquotaIss) ctx.push(`ISS: ${aliquotaIss}%`);
    if (userNotes) ctx.push(`Notas: ${userNotes}`);
    const ctxInfo = ctx.length > 0 ? `\nCONSIDERE: ${ctx.join('; ')}.` : '';
    const prompt = `Analise "${query}" no contexto de ${type}.${ctxInfo}\n1. Detalhes tributários, base legal, retenções.\n2. AO FINAL inclua JSON IBPT:\n\`\`\`json\n{"ibpt":{"nacional":0,"importado":0,"estadual":0,"municipal":0}}\n\`\`\``;
    const useSearch = [SearchType.REFORMA_TRIBUTARIA, SearchType.SERVICO, SearchType.CFOP, SearchType.NCM].includes(type);
    try {
        const response = await withRetry(() => callProxy(prompt, { temperature: 0.4, googleSearch: useSearch }));
        let text = response.text || 'Análise indisponível.'; let ibptData;
        const jm = text.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (jm?.[1]) { try { const p = JSON.parse(jm[1]); if (p.ibpt) { ibptData = p.ibpt; text = text.replace(jm[0], '').trim(); } } catch {} }
        let sources: GroundingSource[] = [];
        if (response.candidates?.[0]?.groundingMetadata?.groundingChunks) {
            sources = response.candidates[0].groundingMetadata.groundingChunks.filter((c: any) => c.web).map((c: any) => ({ web: { uri: c.web.uri, title: c.web.title } }));
        }
        return { text, sources, query, timestamp: Date.now(), context: { aliquotaIcms, aliquotaPisCofins, aliquotaIss, userNotes }, ibpt: ibptData };
    } catch (e: any) { throw e; }
};

export const fetchComparison = async (type: SearchType, q1: string, q2: string): Promise<ComparisonResult> => {
    const r = await withRetry(() => callProxy(`Compare ${type}: "${q1}" vs "${q2}".`, { googleSearch: true }));
    return { summary: r.text || 'Indisponível', result1: { text: 'Ver resumo', sources: [], query: q1 }, result2: { text: 'Ver resumo', sources: [], query: q2 } };
};

export const fetchSimilarServices = async (query: string): Promise<SimilarService[]> => {
    try { const r = await withRetry(() => callProxy(`Liste 4 códigos LC 116/03 similares a: "${query}". JSON: [{"code":"X.XX","description":"..."}]`)); return safeJsonParse(r.text || '[]'); } catch { return []; }
};

export const fetchCnaeSuggestions = async (query: string): Promise<CnaeSuggestion[]> => {
    try { const r = await withRetry(() => callProxy(`Sugira 5 CNAEs para: "${query}". JSON: [{"code":"XXXX-X/XX","description":"..."}]`, { googleSearch: true })); return safeJsonParse(r.text || '[]'); } catch { return []; }
};

export const fetchNewsAlerts = async (): Promise<NewsAlert[]> => {
    try {
        const r = await withRetry(() => callProxy(`Liste 3 notícias fiscais Brasil recentes. JSON: [{"title":"...","summary":"..."}]`, { googleSearch: true }));
        const alerts: NewsAlert[] = safeJsonParse(r.text || '[]');
        const urls: string[] = [];
        if (r.candidates?.[0]?.groundingMetadata?.groundingChunks) r.candidates[0].groundingMetadata.groundingChunks.filter((c: any) => c.web?.uri).forEach((c: any) => urls.push(c.web.uri));
        return alerts.map((a, i) => ({ ...a, source: a.source?.startsWith('https://') ? a.source : (urls[i] || urls[0] || '') }));
    } catch { return []; }
};

export const fetchReformaNews = async (): Promise<NewsAlert[]> => {
    try {
        const r = await withRetry(() => callProxy(`Liste 3 notícias Reforma Tributária Brasil (IBS,CBS,IS). JSON: [{"title":"...","summary":"..."}]`, { googleSearch: true }));
        const alerts: NewsAlert[] = safeJsonParse(r.text || '[]');
        const urls: string[] = [];
        if (r.candidates?.[0]?.groundingMetadata?.groundingChunks) r.candidates[0].groundingMetadata.groundingChunks.filter((c: any) => c.web?.uri).forEach((c: any) => urls.push(c.web.uri));
        return alerts.map((a, i) => ({ ...a, source: a.source?.startsWith('https://') ? a.source : (urls[i] || urls[0] || '') }));
    } catch { return []; }
};

export const fetchSimplesNacionalExplanation = async (empresa: SimplesNacionalEmpresa, resumo: SimplesNacionalResumo, question: string): Promise<SearchResult> => {
    const ctx = `Empresa: ${empresa.nome}, CNAE: ${empresa.cnae}, Anexo: ${empresa.anexo}, RBT12: ${resumo.rbt12}, Aliq: ${resumo.aliq_eff}%`;
    const r = await withRetry(() => callProxy(`Contexto: ${ctx}. Pergunta: "${question}"`));
    return { text: r.text || '', query: question, sources: [] };
};

export const fetchCnaeDescription = async (cnae: string): Promise<SearchResult> => {
    const r = await withRetry(() => callProxy(`Analise CNAE ${cnae} para Simples Nacional: Descrição, Anexo, Fator R, Atividades.`, { googleSearch: true }));
    return { text: r.text || '', query: cnae, sources: [] };
};

export const fetchCnaeTaxDetails = async (cnae: string, manualRates?: { icms: string; pisCofins: string; iss: string }): Promise<CnaeTaxDetail[]> => {
    try {
        let p = `CNAE ${cnae} impostos Regime Geral. JSON: [{"tributo":"...","incidencia":"...","aliquotaMedia":"...","baseLegal":"..."}]`;
        if (manualRates) p += `\nAlíquotas: ICMS:${manualRates.icms||'Padrão'}, PIS/COFINS:${manualRates.pisCofins||'Padrão'}, ISS:${manualRates.iss||'Padrão'}`;
        const r = await withRetry(() => callProxy(p, { googleSearch: true })); return safeJsonParse(r.text || '[]');
    } catch { return []; }
};

export const extractDocumentData = async (base64Data: string, mimeType: string = 'application/pdf'): Promise<any[]> => {
    const prompt = `Extraia dados financeiros deste documento. JSON: [{"data":"YYYY-MM-DD","valor":0.00,"descricao":"...","origem":"..."}]`;
    const r = await withRetry(() => callProxy([{ inlineData: { mimeType, data: base64Data } }, { text: prompt }]));
    return safeJsonParse(r.text || '[]');
};

export const extractInvoiceDataFromPdf = async (base64Pdf: string): Promise<any[]> => extractDocumentData(base64Pdf, 'application/pdf');

export const extractPgdasDataFromPdf = async (base64Pdf: string): Promise<any> => {
    try {
        const r = await withRetry(() => callProxy([{ inlineData: { mimeType: 'application/pdf', data: base64Pdf } }, { text: 'Extraia histórico RBT12 deste PGDAS-D. JSON: [{"periodo":"MM/AAAA","valor":number}]' }]));
        return safeJsonParse(r.text || '[]');
    } catch { return []; }
};

