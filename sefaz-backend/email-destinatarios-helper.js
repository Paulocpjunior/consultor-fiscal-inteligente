/**
 * email-destinatarios-helper.js (PURO — testável em jest)
 *
 * As env vars de destinatário dos crons de notificação (CAPTURA_RESUMO_TO,
 * CERT_ALERT_TO, HEALTH_ALERT_TO) eram tratadas como e-mail ÚNICO — uma
 * lista com vírgula virava um endereço inválido no Graph. Este helper
 * aceita lista separada por vírgula/ponto-e-vírgula e valida cada item.
 * enviarEmail (graph-provider.js) já aceita string[] em `para`.
 *
 * Ex.: CAPTURA_RESUMO_TO="junior@sp.com.br, sandra@sp.com.br; alex@sp.com.br"
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {string|undefined} raw      valor da env var (lista com , ou ;)
 * @param {string} [fallback]         usado se a lista ficar vazia
 * @returns {string[]}                destinatários válidos, sem duplicatas
 */
export function parseDestinatarios(raw, fallback) {
    const vistos = new Set();
    const lista = String(raw || '')
        .split(/[,;]+/)
        .map(s => s.trim())
        .filter(s => {
            if (!EMAIL_RE.test(s)) return false;
            const k = s.toLowerCase();
            if (vistos.has(k)) return false;
            vistos.add(k);
            return true;
        });
    if (lista.length === 0 && fallback && EMAIL_RE.test(fallback)) return [fallback];
    return lista;
}
