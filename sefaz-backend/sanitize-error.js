// sefaz-backend/sanitize-error.js
// Sanitizador de erro pra evitar vazamento de paths, secrets, stacks e
// IDs internos no body de resposta HTTP 5xx.
//
// Em prod, err.message cru pode conter:
//   - paths absolutos do filesystem ("ENOENT: /opt/credentials/...")
//   - nomes de secrets ("Secret 'sefaz-cert-key' nao encontrado")
//   - IDs internos GCP (projectId, kid de chave)
//   - stack traces serializados
//
// Esta funcao deixa passar mensagens "fiscais" (curtas, sem path, sem id
// tecnico) e substitui as outras por uma mensagem generica com requestId
// pra correlacao com logs do servidor.

import { randomBytes } from 'crypto';

const PADROES_PERIGOSOS = [
    /\/(?:opt|home|root|var|tmp|usr)\/[\w./\-]+/,    // paths abs
    /\b[A-Za-z0-9_-]{20,}\b/,                         // tokens longos
    /\bSecret\b/i,                                     // nomes de secret
    /\bENOENT|EACCES|EISDIR|EPERM\b/,                 // erros nodejs filesystem
    /\bprojects\/[\w-]+\/secrets\//,                  // GCP Secret Manager path
    /\b(?:gcp|gcloud|google)\b.*\b(?:project|sa|key)/i,
];

const TAMANHO_MAX = 200;

/**
 * @param err {Error|string|unknown}
 * @returns {{ error: string, requestId: string }}
 */
export function sanitizeError(err) {
    const requestId = randomBytes(4).toString('hex');
    let raw = '';
    if (err instanceof Error) raw = err.message || '';
    else if (typeof err === 'string') raw = err;
    else raw = '';

    // Mensagem vazia ou muito longa -> generica
    if (!raw || raw.length > TAMANHO_MAX) {
        return { error: `Erro interno (ref ${requestId})`, requestId };
    }

    // Contem padrao perigoso -> generica
    for (const padrao of PADROES_PERIGOSOS) {
        if (padrao.test(raw)) {
            return { error: `Erro interno (ref ${requestId})`, requestId };
        }
    }

    return { error: raw, requestId };
}

/**
 * Helper pra Express: responde 500 com erro sanitizado e loga o original.
 * Aceita formato { error } (default) ou { ok: false, error } (varias rotas
 * do sefaz-backend usam esse formato).
 *
 * @example
 *   } catch (err) {
 *       return respondeErro(res, err, 'analise-creditos');
 *   }
 */
export function respondeErro(res, err, contexto = 'erro', opts = {}) {
    const { error, requestId } = sanitizeError(err);
    const original = err instanceof Error ? err.stack || err.message : String(err);
    console.error(`[${contexto}] ${requestId}:`, original);
    const body = opts.formatoOk
        ? { ok: false, error, requestId }
        : { error, requestId };
    return res.status(opts.status || 500).json(body);
}

/**
 * Middleware Express global que captura erros nao tratados (next(err))
 * e responde sanitizado. Plugar como ULTIMO middleware do app:
 *
 *   app.use(errorMiddleware);
 *
 * Captura tambem erros sincronos lancados em handlers (Express 5+).
 */
export function errorMiddleware(err, req, res, next) {
    if (res.headersSent) return next(err);
    return respondeErro(res, err, `${req.method} ${req.path}`);
}
