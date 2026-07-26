// ============================================================================
// sefaz-backend/jotform-provider.js
// Integração com a API REST do Jotform (fonte de dados do departamento de
// Legalização). Somente LEITURA de submissions — os formulários continuam
// sendo o ponto de coleta; o CFI consome, analisa e alerta.
//
// Credencial em env var / Secret Manager:
//   JOTFORM_API_KEY   (obrigatória — sem ela o sync avisa e não roda)
//   JOTFORM_API_BASE  (opcional; default https://api.jotform.com — contas EU
//                      usam https://eu-api.jotform.com)
// ============================================================================

const API_BASE = (process.env.JOTFORM_API_BASE || 'https://api.jotform.com').replace(/\/+$/, '');
const API_KEY = process.env.JOTFORM_API_KEY || '';

const PAGE_SIZE = 200;      // teto aceito pela API por request é 1000; 200 mantém payloads leves
const TIMEOUT_MS = 20000;

/** true se a API key do Jotform está presente. */
export function isJotformConfigured() {
    return Boolean(API_KEY);
}

async function getJson(path) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${API_BASE}${path}${sep}apiKey=${encodeURIComponent(API_KEY)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const resp = await fetch(url, { signal: ctrl.signal });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok || (body.responseCode && body.responseCode >= 400)) {
            const motivo = body.message || `HTTP ${resp.status}`;
            throw new Error(`Jotform ${motivo}`.slice(0, 300));
        }
        return body;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Todas as submissions ATIVAS de um formulário, paginadas.
 * @param {string} formId
 * @param {{max?: number}} [opts]  teto de segurança (default 5000)
 * @returns {Promise<Array<object>>}  submissions cruas da API
 */
export async function listarSubmissions(formId, { max = 5000 } = {}) {
    if (!isJotformConfigured()) {
        throw new Error('JOTFORM_API_KEY não configurada — cadastre o secret e redeploye');
    }
    const out = [];
    let offset = 0;
    while (out.length < max) {
        const body = await getJson(
            `/form/${encodeURIComponent(formId)}/submissions?limit=${PAGE_SIZE}&offset=${offset}&orderby=created_at`
        );
        const page = Array.isArray(body.content) ? body.content : [];
        out.push(...page);
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }
    if (out.length >= max) {
        console.warn(`[jotform] form ${formId}: teto de ${max} submissions atingido — pode haver mais`);
    }
    return out;
}

/** Metadados de um formulário (título, status, contagem) — pro painel Config. */
export async function obterForm(formId) {
    const body = await getJson(`/form/${encodeURIComponent(formId)}`);
    return body.content || null;
}
