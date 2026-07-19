// ============================================================================
// sefaz-backend/cron-secret.js  (ESM)
//
// Comparação de segredo de cron em TEMPO CONSTANTE. Uma fonte só, em vez de
// `===`/`!==` diretos espalhados pelos routers (que vazam, por timing, o
// tamanho do prefixo correto). Buffers de tamanhos diferentes → false sem lançar
// (crypto.timingSafeEqual exige mesmo comprimento).
// ============================================================================

import { timingSafeEqual } from 'crypto';

export function secretsMatch(a, b) {
    if (!a || !b) return false;
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ba.length === bb.length && timingSafeEqual(ba, bb);
}
