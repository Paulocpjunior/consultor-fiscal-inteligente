// ============================================================================
// sefaz-backend/graph-provider.js
// Integração com o Microsoft Graph API (Microsoft 365 da SP).
// Autentica via OAuth client-credentials e envia e-mail pela caixa de um
// usuário do tenant. Credenciais vêm de env vars / Secret Manager:
//   GRAPH_CLIENT_ID, GRAPH_TENANT_ID, GRAPH_CLIENT_SECRET
// ============================================================================

const CLIENT_ID = process.env.GRAPH_CLIENT_ID || '';
const TENANT_ID = process.env.GRAPH_TENANT_ID || '';
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET || '';

/** true se as 3 credenciais do Graph estão presentes. */
export function isGraphConfigured() {
    return Boolean(CLIENT_ID && TENANT_ID && CLIENT_SECRET);
}

// Cache simples do token (vale ~1h; guardamos com margem de segurança).
let _tokenCache = { value: null, expiraEm: 0 };

/**
 * Obtém um access token do Graph via fluxo client-credentials.
 * Reaproveita o token em cache enquanto válido.
 */
async function getAccessToken() {
    const agora = Date.now();
    if (_tokenCache.value && agora < _tokenCache.expiraEm) {
        return _tokenCache.value;
    }
    if (!isGraphConfigured()) {
        throw new Error('Graph não configurado (faltam GRAPH_CLIENT_ID/TENANT_ID/CLIENT_SECRET)');
    }

    const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
    });

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Falha ao obter token Graph (${resp.status}): ${txt.slice(0, 300)}`);
    }

    const data = await resp.json();
    const expiresInMs = (data.expires_in || 3600) * 1000;
    _tokenCache = {
        value: data.access_token,
        // margem de 5 min antes de expirar de verdade
        expiraEm: agora + expiresInMs - 5 * 60 * 1000,
    };
    return _tokenCache.value;
}

/**
 * Envia um e-mail pela caixa de `remetente` (UPN/e-mail de um usuário do tenant).
 * @param {object} p
 * @param {string} p.remetente  e-mail da caixa de origem (ex.: junior@spassessoriacontabil.com.br)
 * @param {string|string[]} p.para  destinatário(s)
 * @param {string} p.assunto
 * @param {string} p.corpoHtml  corpo em HTML
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function enviarEmail({ remetente, para, assunto, corpoHtml }) {
    try {
        const token = await getAccessToken();

        const destinatarios = (Array.isArray(para) ? para : [para])
            .filter(Boolean)
            .map(addr => ({ emailAddress: { address: addr } }));

        if (destinatarios.length === 0) {
            return { ok: false, error: 'Nenhum destinatário informado' };
        }

        // Graph: POST /users/{remetente}/sendMail
        const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(remetente)}/sendMail`;
        const payload = {
            message: {
                subject: assunto,
                body: { contentType: 'HTML', content: corpoHtml },
                toRecipients: destinatarios,
            },
            saveToSentItems: true,
        };

        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        // sendMail retorna 202 Accepted (sem corpo) quando dá certo.
        if (resp.status === 202) {
            return { ok: true };
        }
        const txt = await resp.text();
        return { ok: false, error: `Graph sendMail ${resp.status}: ${txt.slice(0, 300)}` };
    } catch (err) {
        return { ok: false, error: err.message || 'Falha ao enviar e-mail' };
    }
}
