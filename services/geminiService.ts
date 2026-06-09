
import { SearchType, type SearchResult, type GroundingSource, type ComparisonResult, type NewsAlert, type SimilarService, type CnaeSuggestion, type SimplesNacionalEmpresa, type SimplesNacionalResumo, CnaeTaxDetail } from '../types';
import { auth } from './firebaseConfig';
import { classificarCfop, ehCfopDeEntrada } from './cfopClassifier';

interface ProxyResponse { text: string; candidates?: any[]; }

async function getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
        const token = await auth?.currentUser?.getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch { /* sem token — servidor decidirá */ }
    return headers;
}

const callProxy = async (prompt: string | any[], options?: { temperature?: number; googleSearch?: boolean; model?: string }): Promise<ProxyResponse> => {
    const headers = await getAuthHeaders();
    if (Array.isArray(prompt)) {
        const textPart = prompt.find((p: any) => p.text)?.text || '';
        const dataPart = prompt.find((p: any) => p.inlineData);
        if (dataPart?.inlineData) {
            const response = await fetch('/api/fiscal/multimodal', {
                method: 'POST', headers,
                body: JSON.stringify({ prompt: textPart, base64Data: dataPart.inlineData.data, mimeType: dataPart.inlineData.mimeType, model: options?.model }),
            });
            if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || `Erro ${response.status}`); }
            return await response.json();
        }
    }
    const response = await fetch('/api/fiscal/query', {
        method: 'POST', headers,
        body: JSON.stringify({ prompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt), model: options?.model, temperature: options?.temperature, googleSearch: options?.googleSearch }),
    });
    if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || `Erro ${response.status}`); }
    return await response.json();
};

const withRetry = async <T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> => {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
        try { return await fn(); } catch (error: any) {
            lastError = error;
            const msg = error?.message || '';
            const isRetryable = msg.includes('503') || msg.includes('429') || msg.includes('500')
                || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota');
            if (isRetryable && i < maxRetries - 1) {
                const baseMs = Math.min(Math.pow(2, i) * 4000, 30000);
                const waitMs = baseMs + Math.random() * 1000;
                console.warn('[Gemini retry] ' + (i+1) + '/' + maxRetries + ' em ' + Math.round(waitMs/1000) + 's');
                await new Promise(r => setTimeout(r, waitMs));
                continue;
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

const CFOP_CATEGORY_LABEL: Record<string, string> = {
    compra: 'Compra / entrada',
    venda: 'Venda / saída',
    servico_prestado: 'Serviço prestado',
    servico_tomado: 'Serviço tomado',
    devolucao: 'Devolução',
    transferencia: 'Transferência',
    remessa: 'Remessa / retorno',
    outro: 'Outra operação',
};

const CFOP_DESCRICOES: Record<string, string> = {
    '1924': 'Entrada para industrialização por conta e ordem do adquirente da mercadoria, quando esta não transitar pelo estabelecimento do adquirente.',
};

function consultaCfopLocal(query: string, context?: SearchResult['context']): SearchResult | null {
    const codigo = (query || '').replace(/\D/g, '');
    if (codigo.length !== 4) return null;
    if (!/^[123567]\d{3}$/.test(codigo)) {
        return {
            query,
            timestamp: Date.now(),
            context,
            text: [
                `## CFOP ${codigo}`,
                '',
                '**Status:** código inválido para CFOP.',
                '',
                'CFOP deve ter 4 dígitos e iniciar por 1, 2, 3, 5, 6 ou 7.',
            ].join('\n'),
        };
    }

    const categoria = classificarCfop(codigo) || (ehCfopDeEntrada(codigo) ? 'compra' : 'venda');
    const direcao = ehCfopDeEntrada(codigo) ? 'Entrada' : 'Saída';
    const descricao = CFOP_DESCRICOES[codigo]
        || 'Descrição específica não cadastrada no catálogo local. Use a categoria operacional abaixo como triagem e confirme a descrição oficial na tabela CFOP vigente.';
    const contexto = context && (context.aliquotaIcms || context.aliquotaPisCofins || context.aliquotaIss || context.userNotes)
        ? [
            '',
            '## Contexto informado',
            context.aliquotaIcms ? `- ICMS informado: ${context.aliquotaIcms}%` : '',
            context.aliquotaPisCofins ? `- PIS/COFINS informado: ${context.aliquotaPisCofins}%` : '',
            context.aliquotaIss ? `- ISS informado: ${context.aliquotaIss}%` : '',
            context.userNotes ? `- Observações: ${context.userNotes}` : '',
        ].filter(Boolean).join('\n')
        : '';

    return {
        query,
        timestamp: Date.now(),
        context,
        text: [
            `## CFOP ${codigo}`,
            '',
            `**Descrição:** ${descricao}`,
            '',
            `**Direção:** ${direcao}`,
            `**Categoria operacional:** ${CFOP_CATEGORY_LABEL[categoria] || categoria}`,
            '',
            '## Orientação fiscal',
            '- Use este retorno local para triagem imediata quando a IA estiver indisponível.',
            '- Confira CST, finalidade da NF-e, natureza da operação e regra estadual antes de escriturar.',
            '- Em operações de remessa/retorno ou industrialização, valide se há vínculo com nota de origem e se o CFOP está na perspectiva correta do emitente/destinatário.',
            contexto,
        ].filter(Boolean).join('\n'),
    };
}

export const fetchFiscalData = async (type: SearchType, query: string, municipio?: string, alias?: string, responsavel?: string, cnae?: string, regimeTributario?: string, reformaQuery?: string, aliquotaIcms?: string, aliquotaPisCofins?: string, aliquotaIss?: string, userNotes?: string): Promise<SearchResult> => {
    let ctx = [];
    if (municipio) ctx.push(`Município: ${municipio}`); if (alias) ctx.push(`Tomador: ${alias}`);
    if (regimeTributario) ctx.push(`Regime: ${regimeTributario}`); if (aliquotaIcms) ctx.push(`ICMS: ${aliquotaIcms}%`);
    if (aliquotaPisCofins) ctx.push(`PIS/COFINS: ${aliquotaPisCofins}%`); if (aliquotaIss) ctx.push(`ISS: ${aliquotaIss}%`);
    if (userNotes) ctx.push(`Notas: ${userNotes}`);
    const context = { aliquotaIcms, aliquotaPisCofins, aliquotaIss, userNotes };
    if (type === SearchType.CFOP) {
        const local = consultaCfopLocal(query, context);
        if (local) return local;
    }
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
        return { text, sources, query, timestamp: Date.now(), context, ibpt: ibptData };
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
    // FALLBACK: usado apenas quando o parser deterministico (pgdasPdfParser)
    // nao consegue extrair. Prompt corrigido (anterior pedia "RBT12" e o
    // Gemini retornava o acumulado de 12m em vez do faturamento mensal).
    try {
        const prompt = (
            'Voce e um extrator de dados estruturados do extrato PGDAS-D 2018 da Receita Federal.\n'
            + 'Localize a secao "2.2) Receitas Brutas Anteriores (R$)" e extraia o FATURAMENTO MENSAL\n'
            + 'INDIVIDUAL de cada mes (NAO o RBT12 acumulado, NAO a receita do ano-calendario).\n'
            + 'Some Mercado Interno (2.2.1) + Mercado Externo (2.2.2) por mes.\n'
            + 'Cada item da tabela tem o formato "MM/AAAA  VALOR" — sao os 13-14 meses anteriores.\n'
            + 'Valores esperados: faturamento mensal individual, geralmente entre R$ 0 e R$ 500.000\n'
            + 'pra empresa do Simples (limite anual R$ 4,8M). Se voce ver valores acima de R$ 1M\n'
            + 'em um unico mes, provavelmente esta lendo o RBT12 acumulado — refaca a extracao.\n\n'
            + 'Responda APENAS JSON valido no formato:\n'
            + '[{"periodo":"MM/AAAA","valor":number}, ...]'
        );
        const r = await withRetry(() => callProxy([
            { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
            { text: prompt },
        ]));
        return safeJsonParse(r.text || '[]');
    } catch { return []; }
};
