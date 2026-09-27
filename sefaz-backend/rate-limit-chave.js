// ============================================================================
// sefaz-backend/rate-limit-chave.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🔑 A CHAVE DO LIMITE DE REQUISIÇÕES.
//
// Auditoria de 26/09: a chave era o FIM do header Authorization
// (`auth.slice(-48)`). Qualquer Bearer inventado ganhava um balde novo a cada
// requisição — o limite só protegia contra quem não tentava furá-lo.
//
// A régua: a chave é o `uid` de um token QUE VERIFICOU; token ausente,
// inválido ou expirado cai no IP. Verificar a cada requisição custa uma
// assinatura JWT local (chaves públicas do Google em cache no firebase-admin);
// mesmo assim o resultado fica em cache por token, com teto de tamanho, para
// a rajada de uma tela não virar rajada de verificações.
// ============================================================================

export const CACHE_TOKEN_TTL_MS = 5 * 60 * 1000;
export const CACHE_TOKEN_MAX = 5000;

/** Cache token → uid com validade e teto (LRU simples por ordem de inserção). */
export class CacheDeToken {
    constructor({ ttlMs = CACHE_TOKEN_TTL_MS, max = CACHE_TOKEN_MAX, agora = () => Date.now() } = {}) {
        this.ttlMs = ttlMs; this.max = max; this.agora = agora; this.mapa = new Map();
    }
    get(token) {
        const hit = this.mapa.get(token);
        if (!hit) return null;
        if (hit.ate <= this.agora()) { this.mapa.delete(token); return null; }
        return hit.uid;
    }
    set(token, uid) {
        this.mapa.delete(token);
        this.mapa.set(token, { uid, ate: this.agora() + this.ttlMs });
        while (this.mapa.size > this.max) this.mapa.delete(this.mapa.keys().next().value);
    }
    get size() { return this.mapa.size; }
}

/** Extrai o token de um header Authorization "Bearer …"; null se não há. */
export function tokenDoHeader(authorization) {
    const m = /^Bearer\s+(.+)$/i.exec(String(authorization || '').trim());
    return m ? m[1].trim() : null;
}

/**
 * Monta o gerador de chave. `verificar(token)` devolve o uid ou lança/devolve
 * null — é o `verifyIdToken` em produção e um dublê no teste.
 */
export function criarGeradorDeChave({ verificar, cache = new CacheDeToken() }) {
    return async function chaveDoLimite(req) {
        const token = tokenDoHeader(req?.headers?.authorization);
        const ip = `ip:${req?.ip || 'sem-ip'}`;
        if (!token) return ip;
        const emCache = cache.get(token);
        if (emCache) return `u:${emCache}`;
        try {
            const uid = await verificar(token);
            if (!uid) return ip;
            cache.set(token, uid);
            return `u:${uid}`;
        } catch {
            // Token forjado, expirado ou ilegível: NÃO ganha balde próprio.
            return ip;
        }
    };
}
