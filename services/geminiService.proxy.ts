/**
 * geminiService.ts — VERSÃO PROXY SEGURA
 *
 * Em vez de chamar a API Gemini diretamente (expondo a chave no browser),
 * todas as chamadas vão para o backend proxy no Cloud Run.
 *
 * A variável VITE_API_PROXY_URL deve ser configurada em .env:
 *   Desenvolvimento:  VITE_API_PROXY_URL=http://localhost:8080
 *   Produção:         VITE_API_PROXY_URL=https://consultor-fiscal-proxy-xxx.a.run.app
 */

import { SearchType, type SearchResult, type ComparisonResult, type SimilarService, type CnaeSuggestion } from '../types';

// ─── URL do proxy (sem barra no final) ───────────────────────────────────────
const PROXY_URL = (import.meta.env.VITE_API_PROXY_URL || 'http://localhost:8080').replace(/\/$/, '');

// ─── Helper de chamada ao proxy ───────────────────────────────────────────────
async function callProxy(endpoint: string, prompt: string): Promise<string> {
    const response = await fetch(`${PROXY_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData.error || `Erro ${response.status}`;
        throw new Error(message);
    }

    const data = await response.json();
    return data.text || '';
}

// ─── Prompts fiscais (igual à versão original) ────────────────────────────────
function buildFiscalPrompt(
    searchType: SearchType,
    query: string,
    municipio?: string,
    alias?: string,
    responsavel?: string,
    reformaQuery?: string,
    regimeTributario?: string,
    cnae?: string,
    aliquotaIcms?: string,
    aliquotaPisCofins?: string,
    aliquotaIss?: string,
    userNotes?: string
): string {
    const contextParts: string[] = [];

    if (municipio) contextParts.push(`Município do prestador: ${municipio}`);
    if (alias) contextParts.push(`Tomador: ${alias}`);
    if (responsavel) contextParts.push(`Responsável: ${responsavel}`);
    if (regimeTributario) contextParts.push(`Regime tributário: ${regimeTributario}`);
    if (aliquotaIcms) contextParts.push(`Alíquota ICMS: ${aliquotaIcms}%`);
    if (aliquotaPisCofins) contextParts.push(`Alíquota PIS/COFINS: ${aliquotaPisCofins}%`);
    if (aliquotaIss) contextParts.push(`Alíquota ISS: ${aliquotaIss}%`);
    if (userNotes) contextParts.push(`Observações: ${userNotes}`);

    const context = contextParts.length > 0
        ? `\n\nCONTEXTO ADICIONAL:\n${contextParts.join('\n')}`
        : '';

    const baseInstructions = `Você é um consultor fiscal brasileiro especialista. Responda em português, de forma clara, objetiva e estruturada em Markdown. Inclua base legal quando relevante.`;

    switch (searchType) {
        case SearchType.CFOP:
            return `${baseInstructions}\n\nConsulta sobre CFOP: "${query}"${context}\n\nForneça: 1) Descrição do CFOP, 2) Quando usar, 3) Impostos envolvidos (ICMS, IPI, PIS/COFINS), 4) Exemplos práticos, 5) CFOPs relacionados.`;

        case SearchType.NCM:
            return `${baseInstructions}\n\nConsulta sobre NCM: "${query}"${context}\n\nForneça: 1) Descrição da mercadoria, 2) Alíquotas IPI, ICMS e PIS/COFINS, 3) Regras especiais (ST, monofásico, isento), 4) Cuidados na classificação.`;

        case SearchType.SERVICO:
            return `${baseInstructions}\n\nConsulta sobre serviço/ISS: "${query}"${context}\n\nForneça: 1) Enquadramento na LC 116/2003, 2) Item da lista de serviços, 3) Local de incidência, 4) Retenção na fonte, 5) Alíquotas típicas, 6) Reforma Tributária (IBS).`;

        case SearchType.REFORMA_TRIBUTARIA:
            return `${baseInstructions}\n\nAnálise de impacto da Reforma Tributária (EC 132/2023, IBS/CBS/IS) para: "${reformaQuery || query}"${context}\n\nForneça: 1) Regime atual, 2) Mudanças com IBS/CBS, 3) Impacto estimado na alíquota, 4) Período de transição, 5) Recomendações.`;

        default:
            return `${baseInstructions}\n\nConsulta fiscal: "${query}"${context}`;
    }
}

// ─── Funções públicas (mesma assinatura da versão original) ───────────────────

export async function fetchFiscalData(
    searchType: SearchType,
    query: string,
    municipio?: string,
    alias?: string,
    responsavel?: string,
    reformaQuery?: string,
    regimeTributario?: string,
    cnae?: string,
    aliquotaIcms?: string,
    aliquotaPisCofins?: string,
    aliquotaIss?: string,
    userNotes?: string
): Promise<SearchResult> {
    const prompt = buildFiscalPrompt(
        searchType, query, municipio, alias, responsavel,
        reformaQuery, regimeTributario, cnae,
        aliquotaIcms, aliquotaPisCofins, aliquotaIss, userNotes
    );

    const text = await callProxy('/api/fiscal/query', prompt);
    return { query, text, searchType };
}

export async function fetchComparison(
    searchType: SearchType,
    query1: string,
    query2: string
): Promise<ComparisonResult> {
    const prompt = `Você é um consultor fiscal brasileiro. Compare detalhadamente os seguintes termos fiscais no contexto de ${searchType}:\n\nTermo 1: "${query1}"\nTermo 2: "${query2}"\n\nEstruture a resposta em Markdown com: 1) Resumo executivo, 2) Tabela comparativa, 3) Quando usar cada um, 4) Riscos e cuidados.`;

    const text = await callProxy('/api/fiscal/compare', prompt);

    return {
        query1,
        query2,
        searchType,
        summary: text.split('\n')[0] || 'Comparação realizada',
        text,
    };
}

export async function fetchSimilarServices(serviceDescription: string): Promise<SimilarService[]> {
    const prompt = `Liste 5 serviços similares a "${serviceDescription}" no contexto do ISS brasileiro. Para cada um retorne em JSON: [{"code": "item LC116", "description": "...", "similarity": "alta|media|baixa"}]. Retorne APENAS o JSON, sem markdown.`;

    const text = await callProxy('/api/fiscal/similar', prompt);

    try {
        const clean = text.replace(/```json|```/g, '').trim();
        return JSON.parse(clean) as SimilarService[];
    } catch {
        return [];
    }
}

export async function fetchCnaeSuggestions(query: string): Promise<CnaeSuggestion[]> {
    const prompt = `Sugira 5 códigos CNAE relacionados a "${query}". Retorne APENAS JSON: [{"code": "0000-0/00", "description": "..."}]. Sem markdown.`;

    const text = await callProxy('/api/fiscal/query', prompt);

    try {
        const clean = text.replace(/```json|```/g, '').trim();
        return JSON.parse(clean) as CnaeSuggestion[];
    } catch {
        return [];
    }
}
