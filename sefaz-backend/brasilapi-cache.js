// ============================================================================
// sefaz-backend/brasilapi-cache.js
// Lookup de CNPJ via BrasilAPI com cache em memoria.
//
// API: https://brasilapi.com.br/api/cnpj/v1/{cnpj}
// Sem auth, gratuita, mas rate-limited. Por isso o cache e o failedSet —
// notas legadas tem participantes repetidos entre arquivos.
//
// Usado pra enriquecer participantes legados que nao tem codMunIBGE/endereco
// (notas processadas pelo parser antigo). Notas novas ja vem completas do
// xmlParserService.
// ============================================================================

const cache = new Map();       // cnpj -> dados
const failedSet = new Set();   // cnpjs que falharam no fetch (nao tenta de novo)
const TIMEOUT_MS = 8000;
const MAX_CACHE_SIZE = 5000;

async function fetchCnpjData(cnpj) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(
            `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
            {
                signal: ctrl.signal,
                headers: {
                    'Accept': 'application/json',
                    // BrasilAPI bloqueia User-Agent bot-like do Node.
                    // Sem isso, retorna HTTP 403 silenciosamente.
                    'User-Agent': 'Mozilla/5.0 (consultor-fiscal-inteligente)',
                },
            },
        );
        clearTimeout(timer);
        if (!res.ok) {
            console.warn(`[brasilapi] CNPJ ${cnpj}: HTTP ${res.status}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        clearTimeout(timer);
        console.warn(`[brasilapi] CNPJ ${cnpj}: ${err.message}`);
        return null;
    }
}

/**
 * Lookup público: busca dados de um CNPJ na BrasilAPI (com cache).
 * Retorna o objeto bruto da API ou null se falhar.
 */
export async function lookupCnpj(cnpj) {
    const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
    if (cnpjLimpo.length !== 14) return null;
    if (cache.has(cnpjLimpo)) return cache.get(cnpjLimpo);
    if (failedSet.has(cnpjLimpo)) return null;
    const data = await fetchCnpjData(cnpjLimpo);
    if (!data) {
        failedSet.add(cnpjLimpo);
        return null;
    }
    if (cache.size >= MAX_CACHE_SIZE) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
    cache.set(cnpjLimpo, data);
    return data;
}

/**
 * Enriquece em-place uma lista de participantes preenchendo apenas os
 * campos vazios (nao sobrescreve dados que ja vieram do XML/Firestore).
 *
 * @param {Array<{cnpj: string, codMunIBGE?: string, logradouro?: string, ...}>} participantes
 * @returns {Promise<{enriched: number, skipped: number, failed: number}>}
 */
export async function enrichParticipantesViaBrasilApi(participantes) {
    let enriched = 0, skipped = 0, failed = 0;

    for (const p of participantes) {
        // Se ja tem o minimo critico (codMunIBGE + logradouro), pula
        if (p.codMunIBGE && p.logradouro) { skipped++; continue; }

        const cnpj = String(p.cnpj || '').replace(/\D/g, '');
        if (cnpj.length !== 14) { skipped++; continue; }  // ignora CPF

        if (failedSet.has(cnpj)) { failed++; continue; }

        let data = cache.get(cnpj);
        if (!data) {
            data = await fetchCnpjData(cnpj);
            if (!data) {
                if (failedSet.size >= MAX_CACHE_SIZE) {
                    const oldestKey = failedSet.values().next().value;
                    failedSet.delete(oldestKey);
                }
                failedSet.add(cnpj);
                failed++;
                continue;
            }
            if (cache.size >= MAX_CACHE_SIZE) {
                const oldestKey = cache.keys().next().value;
                cache.delete(oldestKey);
            }
            cache.set(cnpj, data);
        }

        // Preenche so campos vazios
        if (!p.codMunIBGE && data.codigo_municipio_ibge) {
            p.codMunIBGE = String(data.codigo_municipio_ibge).padStart(7, '0');
        }
        if (!p.logradouro && data.logradouro) p.logradouro = String(data.logradouro);
        if (!p.numero && data.numero) p.numero = String(data.numero);
        if (!p.complemento && data.complemento) p.complemento = String(data.complemento);
        if (!p.bairro && data.bairro) p.bairro = String(data.bairro);
        if (!p.cep && data.cep) p.cep = String(data.cep).replace(/\D/g, '');
        enriched++;
    }

    return { enriched, skipped, failed };
}

export function clearBrasilApiCache() {
    cache.clear();
    failedSet.clear();
}
