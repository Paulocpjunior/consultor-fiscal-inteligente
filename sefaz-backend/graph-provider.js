import { lerPdfVencimentos } from './convites-pdf.js';
import { listaDeEnvio } from './email-destinatarios-helper.js';
import * as convites from './convites-vencimento.cjs';
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
 * Expõe um access token válido do Graph (client-credentials, cacheado).
 * Usado por leitores de caixa (ingestão de XML por e-mail) que precisam do
 * mesmo token app-only do envio.
 */
export async function getGraphToken() {
    return getAccessToken();
}

/**
 * Descarta o token cacheado — o próximo getGraphToken() emite um NOVO.
 * Existe por causa do consent (24/08, 🔔 do Teams): permissão concedida no
 * Azure só entra em token NOVO, e o cacheado vale ~55 min — sem isto, o
 * "Insufficient privileges" continuaria por até 1h DEPOIS do consent, e a
 * leitura de quem testa é "o consent não funcionou".
 */
export function invalidarTokenGraph() {
    _tokenCache = { value: null, expiraEm: 0 };
}

/** Teto do pedido do Graph sendMail com anexos no próprio JSON (acima disso, sessão de upload). */
export const LIMITE_PEDIDO_SENDMAIL = 4 * 1024 * 1024;

/**
 * Envia um e-mail pela caixa de `remetente` (UPN/e-mail de um usuário do tenant).
 * @param {object} p
 * @param {string} p.remetente  e-mail da caixa de origem (ex.: junior@spassessoriacontabil.com.br)
 * @param {string|string[]} p.para  destinatário(s)
 * @param {string|string[]} [p.cc]  destinatário(s) em cópia visível
 * @param {string|string[]} [p.bcc] destinatário(s) em cópia oculta
 * @param {string} p.assunto
 * @param {string} p.corpoHtml  corpo em HTML
 * @param {Array<{name: string, contentType: string, contentBytes: string}>} [p.anexos]
 * @returns {Promise<{ok: boolean, error?: string, tamanhoExcedido?: boolean, convites?: number, avisosConvites?: string[]}>}
 */
export async function enviarEmail({ remetente, para, cc = [], bcc = [], assunto, corpoHtml, anexos = [], vencimento, identidade = '' }) {
    try {
        const agenda = await convites.anexarConvites({ assunto, anexos, vencimento, identidade, lerPdf: lerPdfVencimentos });
        anexos = agenda.anexos;
        const token = await getAccessToken();

        // Todo campo passa pela MESMA régua (09/10, APATEL): "a@x b@y" num
        // campo só virava UM destinatário e o Graph recusava a mensagem
        // inteira. Endereço torto volta NOMEADO, nunca descartado calado.
        const lidoPara = listaDeEnvio(para);
        const lidoCc = listaDeEnvio(cc);
        const lidoBcc = listaDeEnvio(bcc);
        const tortos = [...lidoPara.invalidos, ...lidoCc.invalidos, ...lidoBcc.invalidos];
        if (tortos.length) {
            return {
                ok: false,
                error: `Destinatário inválido: ${tortos.map((i) => `"${i.valor}" (${i.motivo})`).join(' · ')} `
                    + 'Corrija o e-mail no cadastro e tente de novo.',
            };
        }
        const comoGraph = (lista) => lista.map((addr) => ({ emailAddress: { address: addr } }));
        const destinatarios = comoGraph(lidoPara.lista);

        if (destinatarios.length === 0) {
            return { ok: false, error: 'Nenhum destinatário informado' };
        }

        const copias = comoGraph(lidoCc.lista);
        const copiasOcultas = comoGraph(lidoBcc.lista);

        // Graph: POST /users/{remetente}/sendMail
        const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(remetente)}/sendMail`;
        const payload = {
            message: {
                subject: assunto,
                body: { contentType: 'HTML', content: corpoHtml },
                toRecipients: destinatarios,
                ...(copias.length > 0 ? { ccRecipients: copias } : {}),
                ...(copiasOcultas.length > 0 ? { bccRecipients: copiasOcultas } : {}),
                attachments: anexos
                    .filter(a => a?.contentBytes && a?.name)
                    .map(a => ({
                        '@odata.type': '#microsoft.graph.fileAttachment',
                        name: a.name,
                        contentType: a.contentType || 'application/octet-stream',
                        contentBytes: a.contentBytes,
                        // Anexo INLINE (logo do template): o corpo referencia
                        // cid:{contentId}. Sem isInline o cliente de e-mail
                        // lista a imagem como anexo comum.
                        ...(a.contentId ? { isInline: true, contentId: a.contentId } : {}),
                    })),
            },
            saveToSentItems: true,
        };

        // O sendMail com anexo no próprio JSON aceita até 4 MB de PEDIDO. Quem
        // chama confere os anexos antes, mas o vencimentos-sp.ics nasce aqui
        // (um evento por data lida nos PDFs): conferir o pedido FINAL é dizer o
        // tamanho e o caminho, em vez do 413 cru do Graph (Codex, CFI #1391).
        const corpo = JSON.stringify(payload);
        const tamanho = Buffer.byteLength(corpo);
        if (tamanho > LIMITE_PEDIDO_SENDMAIL) {
            return { ok: false, tamanhoExcedido: true, error: `E-mail com ${(tamanho / 1048576).toFixed(1).replace('.', ',')} MB com os anexos: o envio direto aceita até 4 MB. Envie os anexos em duas mensagens ou pelo Outlook.` };
        }
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: corpo,
        });

        // sendMail retorna 202 Accepted (sem corpo) quando dá certo.
        if (resp.status === 202) {
            return { ok: true, convites: agenda.quantidade, avisosConvites: agenda.avisos };
        }
        const txt = await resp.text();
        return { ok: false, error: `Graph sendMail ${resp.status}: ${txt.slice(0, 300)}` };
    } catch (err) {
        return { ok: false, error: err.message || 'Falha ao enviar e-mail' };
    }
}
