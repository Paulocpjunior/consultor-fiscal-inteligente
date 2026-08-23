// ============================================================================
// sefaz-backend/teams-aviso.js — aviso NATIVO do Teams para mensagem nova
// ----------------------------------------------------------------------------
// Paulo (23/08): *"como ativar as notificacoes dentro do teams... ativar,
// popup de notificacoes e audio de msg"*. O webview do Teams NÃO deixa a
// página web mostrar popup do sistema — quem mostra popup + som (desktop e
// celular, mesmo com a aba fechada) é o PRÓPRIO Teams, pelo sino de
// Atividade: Graph `sendActivityNotification`.
//
// DECISÕES:
//  · A AUDIÊNCIA é a MESMA do push (destinatariosDoAvisoTeams em
//    whatsapp-push.js — filas, autor, Instagram por usuário, horário): o
//    Teams e o celular não podem avisar pessoas diferentes da mesma mensagem.
//  · Endereço é o E-MAIL do tenant (mesmo login do app). Sem app do SP
//    Connect instalado no Teams da pessoa, o aviso é impossível — volta
//    NOMEADO ('app-nao-instalado'), nunca engolido.
//  · Cache de userId/installationId por e-mail (45 min): duas consultas por
//    aviso em toda mensagem da Recepção seria pagar o Graph à toa.
//  · 🚧 NADA disto funciona sem DOIS atos do Paulo: a permissão
//    `TeamsActivity.Send` (application) com admin consent no app Graph do
//    tenant, e o manifest 1.1.0 (com `activities`) re-enviado ao Teams.
//    O botão 🧪 da ⚙️ é a PROVA — a recusa do Graph volta CRUA na tela.
// ============================================================================

import { getGraphToken, isGraphConfigured } from './graph-provider.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
// O MESMO id do teams-app/manifest.json — é por ele que se acha a instalação.
// GUID de manifest NUNCA muda entre versões (regra do pacote do Teams).
export const TEAMS_APP_EXTERNAL_ID = '957eb31d-719a-4ea5-adc6-de5f41be6219';
// Tem que existir com este NOME no manifest (activities.activityTypes[].type).
export const ACTIVITY_TYPE_MENSAGEM = 'mensagemNova';

const TTL_CACHE_MS = 45 * 60 * 1000;
const cache = new Map(); // email → { userId, installId, em }

async function graphGet(url, token, fetcher) {
    const r = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
    const corpo = await r.json().catch(() => ({}));
    return { status: r.status, corpo };
}

/** userId + installationId do SP Connect no Teams da pessoa (com cache). */
async function resolverDestino(email, token, fetcher) {
    const agora = Date.now();
    const c = cache.get(email);
    if (c && agora - c.em < TTL_CACHE_MS) return { ok: true, ...c };

    const u = await graphGet(`${GRAPH}/users/${encodeURIComponent(email)}?$select=id`, token, fetcher);
    if (u.status === 404) return { ok: false, etapa: 'usuario-nao-encontrado', erro: `"${email}" não existe no Microsoft 365 do escritório.` };
    if (u.status >= 400) return { ok: false, etapa: 'consulta-usuario', erro: u.corpo?.error?.message || `HTTP ${u.status}` };
    const userId = u.corpo?.id;
    if (!userId) return { ok: false, etapa: 'consulta-usuario', erro: 'o Graph respondeu sem id de usuário.' };

    const apps = await graphGet(
        `${GRAPH}/users/${userId}/teamwork/installedApps?$expand=teamsApp&$filter=teamsApp/externalId eq '${TEAMS_APP_EXTERNAL_ID}'`,
        token, fetcher,
    );
    if (apps.status >= 400) return { ok: false, etapa: 'consulta-instalacao', erro: apps.corpo?.error?.message || `HTTP ${apps.status}` };
    const installId = apps.corpo?.value?.[0]?.id;
    if (!installId) {
        return { ok: false, etapa: 'app-nao-instalado', erro: `o SP Connect não está instalado no Teams de ${email} — instale pelo zip (📗 guia) e tente de novo.` };
    }
    const destino = { userId, installId };
    cache.set(email, { ...destino, em: agora });
    return { ok: true, ...destino };
}

/**
 * Envia UM aviso nativo do Teams. Devolve {ok} ou {ok:false, etapa, erro} —
 * o erro do Graph volta CRU o bastante para a tela dizer o que falta
 * (permissão sem consent, manifest sem activities, app não instalado).
 */
export async function enviarAvisoTeams({ email, titulo, corpo }, deps = {}) {
    // globalThis.fetch (e não `fetch` cru): no jest o global não existe e a
    // referência solta explode ANTES das guardas — em produção (Node 18+) é
    // o mesmo fetch.
    const fetcher = deps.fetch || globalThis.fetch?.bind(globalThis);
    if (!(deps.configurado ?? isGraphConfigured())) {
        return { ok: false, etapa: 'graph-nao-configurado', erro: 'faltam GRAPH_CLIENT_ID/TENANT_ID/CLIENT_SECRET no ambiente.' };
    }
    let token;
    try { token = deps.token ?? await getGraphToken(); } catch (e) {
        return { ok: false, etapa: 'token', erro: e.message };
    }

    const destino = await resolverDestino(String(email || '').trim().toLowerCase(), token, fetcher);
    if (!destino.ok) return destino;

    const r = await fetcher(`${GRAPH}/users/${destino.userId}/teamwork/sendActivityNotification`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            topic: {
                source: 'entityUrl',
                value: `${GRAPH}/users/${destino.userId}/teamwork/installedApps/${destino.installId}`,
            },
            activityType: ACTIVITY_TYPE_MENSAGEM,
            previewText: { content: String(corpo || 'nova mensagem').slice(0, 150) },
            templateParameters: [{ name: 'resumo', value: String(titulo || 'SP Connect').slice(0, 100) }],
        }),
    });
    if (r.status === 204) return { ok: true };
    const corpoErro = await r.json().catch(() => ({}));
    // Instalação pode ter sido removida depois de cacheada — não reusar.
    if (r.status === 404) cache.delete(String(email || '').trim().toLowerCase());
    return {
        ok: false,
        etapa: 'envio',
        erro: corpoErro?.error?.message || `HTTP ${r.status}`,
        bruto: corpoErro,
    };
}

/** O que a ⚙️ mostra: pré-requisitos e o clientId que o manifest precisa. */
export function statusAvisoTeams(env = process.env) {
    return {
        graphConfigurado: Boolean(env.GRAPH_CLIENT_ID && env.GRAPH_TENANT_ID && env.GRAPH_CLIENT_SECRET),
        // O clientId NÃO é segredo (é identificador público do app AAD) e o
        // manifest do Teams precisa dele no webApplicationInfo — mostrar aqui
        // poupa uma ida ao portal do Azure.
        clientId: env.GRAPH_CLIENT_ID || null,
        teamsAppId: TEAMS_APP_EXTERNAL_ID,
    };
}

export const _internals = { cache, resolverDestino };
