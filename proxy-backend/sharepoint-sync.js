// ─── SharePoint XML Sync via Microsoft Graph API ────────────────────────────
// Authenticates using Azure AD client_credentials flow (app-only).
// Uses native fetch (Node 20+). No extra npm dependencies.
// ─────────────────────────────────────────────────────────────────────────────

const TENANT_ID = process.env.SHAREPOINT_TENANT_ID || 'spassessoriacontabilcombr.onmicrosoft.com';
const CLIENT_ID = process.env.SHAREPOINT_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET || '';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SHAREPOINT_HOST = 'spassessoriacontabilcombr.sharepoint.com';
const SITE_PATH = '/sites/ClientesSP2';

// ─── Token cache (in-memory, single-process) ────────────────────────────────
let _tokenCache = { token: null, expiresAt: 0 };

/**
 * Acquire an access token via Azure AD client_credentials flow.
 * Caches the token until 60 s before expiry.
 */
export async function getAccessToken() {
    const now = Date.now();
    if (_tokenCache.token && _tokenCache.expiresAt > now) {
        return _tokenCache.token;
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
        throw new Error('SharePoint credentials not configured (SHAREPOINT_CLIENT_ID / GRAPH_CLIENT_SECRET)');
    }

    const tokenUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
    });

    const resp = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Azure AD token error (${resp.status}): ${err}`);
    }

    const data = await resp.json();
    _tokenCache = {
        token: data.access_token,
        expiresAt: now + (data.expires_in - 60) * 1000, // refresh 60 s early
    };

    return _tokenCache.token;
}

/**
 * Resolve the SharePoint site ID via Microsoft Graph.
 */
async function getSiteId(accessToken) {
    const url = `${GRAPH_BASE}/sites/${SHAREPOINT_HOST}:${SITE_PATH}`;
    const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Failed to resolve site ID (${resp.status}): ${err}`);
    }

    const data = await resp.json();
    return data.id; // e.g. "spassessoriacontabilcombr.sharepoint.com,guid1,guid2"
}

// Cache site ID for the lifetime of the process
let _siteIdCache = null;

async function cachedSiteId(accessToken) {
    if (!_siteIdCache) {
        _siteIdCache = await getSiteId(accessToken);
    }
    return _siteIdCache;
}

/**
 * List XML files inside a SharePoint folder via Microsoft Graph.
 *
 * @param {string} accessToken - Bearer token
 * @param {string} folderPath  - Path relative to the drive root, e.g.
 *   "Documentos Compartilhados/Empresas/GrupoX/DEPARTAMENTO FISCAL/2024/01-2024/EmpresaY/XML SAÍDA"
 * @returns {Promise<Array<{id,name,webUrl,size,lastModified}>>}
 */
export async function listXmlFiles(accessToken, folderPath) {
    const siteId = await cachedSiteId(accessToken);

    // Encode path for URL (Graph API expects `:` path syntax)
    const encodedPath = folderPath
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');

    // Get children of the folder, paging through all results
    const allItems = [];
    let nextUrl = `${GRAPH_BASE}/sites/${siteId}/drive/root:/${encodedPath}:/children?$top=200&$select=id,name,webUrl,size,lastModifiedDateTime,file`;

    while (nextUrl) {
        const resp = await fetch(nextUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`Failed to list folder (${resp.status}): ${err}`);
        }

        const data = await resp.json();
        const xmlFiles = (data.value || [])
            .filter(item => item.file && item.name.toLowerCase().endsWith('.xml'))
            .map(item => ({
                id: item.id,
                name: item.name,
                webUrl: item.webUrl,
                size: item.size,
                lastModified: item.lastModifiedDateTime,
            }));

        allItems.push(...xmlFiles);
        nextUrl = data['@odata.nextLink'] || null;
    }

    return allItems;
}

/**
 * Download the content of a single XML file by its driveItem ID.
 *
 * @param {string} accessToken
 * @param {string} driveItemId - The Graph driveItem id
 * @returns {Promise<string>} The XML content as text
 */
export async function downloadXmlContent(accessToken, driveItemId) {
    const siteId = await cachedSiteId(accessToken);

    const url = `${GRAPH_BASE}/sites/${siteId}/drive/items/${driveItemId}/content`;
    const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'follow', // Graph may 302 to a download URL
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Failed to download item ${driveItemId} (${resp.status}): ${err}`);
    }

    return await resp.text();
}

/**
 * Sync all XMLs from a folder: lists files and downloads each one.
 * Returns a summary with counts and the downloaded data.
 *
 * @param {string} accessToken
 * @param {string} folderPath
 * @param {number} [maxConcurrent=5] - concurrent downloads
 * @returns {Promise<{found,downloaded,errors,files}>}
 */
export async function syncXmlsFromFolder(accessToken, folderPath, maxConcurrent = 5) {
    const files = await listXmlFiles(accessToken, folderPath);

    const results = [];
    const errors = [];

    // Download in batches to avoid overwhelming the API
    for (let i = 0; i < files.length; i += maxConcurrent) {
        const batch = files.slice(i, i + maxConcurrent);

        const batchResults = await Promise.allSettled(
            batch.map(async (file) => {
                const content = await downloadXmlContent(accessToken, file.id);
                return { ...file, content };
            })
        );

        for (let j = 0; j < batchResults.length; j++) {
            const result = batchResults[j];
            if (result.status === 'fulfilled') {
                results.push(result.value);
            } else {
                errors.push({
                    file: batch[j].name,
                    id: batch[j].id,
                    error: result.reason?.message || 'Unknown error',
                });
            }
        }
    }

    return {
        found: files.length,
        downloaded: results.length,
        errors,
        files: results,
    };
}

// ─── Upload (arquivo → SharePoint) ──────────────────────────────────────────
// Sobe um XML capturado pelo CFI para a pasta do cliente no SharePoint (a mesma
// estrutura que o sync lê). Cria as pastas intermediárias se faltarem.

function encodePath(folderPath) {
    return folderPath.split('/').map(seg => encodeURIComponent(seg)).join('/');
}

/** Cria cada segmento da pasta idempotentemente (409 nameAlreadyExists = ok). */
async function ensureFolderPath(accessToken, siteId, folderPath) {
    const segments = folderPath.split('/').filter(Boolean);
    let current = '';
    for (const seg of segments) {
        const createUrl = current
            ? `${GRAPH_BASE}/sites/${siteId}/drive/root:/${encodePath(current)}:/children`
            : `${GRAPH_BASE}/sites/${siteId}/drive/root/children`;
        const resp = await fetch(createUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: seg, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
        });
        if (!resp.ok && resp.status !== 409) {
            const err = await resp.text();
            if (!/nameAlreadyExists/i.test(err)) {
                throw new Error(`ensureFolder "${seg}" (${resp.status}): ${err.slice(0, 150)}`);
            }
        }
        current = current ? `${current}/${seg}` : seg;
    }
}

/**
 * Sobe um arquivo (Buffer) para `folderPath/filename` no drive do site.
 * Tenta o PUT direto; se a pasta não existir (404), cria e repete.
 * @returns {Promise<{id,name,webUrl}>}
 */
export async function uploadXmlToFolder(accessToken, folderPath, filename, contentBuffer, mimeType = 'application/xml') {
    const siteId = await cachedSiteId(accessToken);
    const putUrl = `${GRAPH_BASE}/sites/${siteId}/drive/root:/${encodePath(folderPath)}/${encodeURIComponent(filename)}:/content`;
    const doPut = () => fetch(putUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': mimeType },
        body: contentBuffer,
    });

    let resp = await doPut();
    if (resp.status === 404) {
        await ensureFolderPath(accessToken, siteId, folderPath);
        resp = await doPut();
    }
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Upload falhou (${resp.status}): ${err.slice(0, 200)}`);
    }
    const data = await resp.json();
    return { id: data.id, name: data.name, webUrl: data.webUrl };
}

/**
 * Check whether the required SharePoint/Graph credentials are present.
 *
 * ⚠️ **`configured` responde "as variáveis estão preenchidas?", NÃO "funciona?"**
 * — e ele nem olha o TENANT. Foi essa a raiz do verde mentiroso de 28/08: o
 * tenant estava cravado errado no workflow do proxy, a Microsoft respondia
 * `AADSTS90002: Tenant not found`, e o card do CFI mostrava
 * `✓ Conectado` porque `CLIENT_ID` e `CLIENT_SECRET` estavam lá.
 *
 * Quem responde "funciona?" é `checkAuth()`, abaixo. Este campo fica, porque
 * distinguir "faltou preencher" de "preencheram errado" é justamente o que dá
 * a ação certa — mas ele deixou de ser o veredito.
 */
export function checkCredentials() {
    return {
        configured: Boolean(CLIENT_ID && CLIENT_SECRET),
        tenantId: TENANT_ID,
        clientIdSet: Boolean(CLIENT_ID),
        clientSecretSet: Boolean(CLIENT_SECRET),
        sharepointHost: SHAREPOINT_HOST,
        sitePath: SITE_PATH,
    };
}

/**
 * 🚦 A PERGUNTA HONESTA: **a Microsoft aceita este token?**
 *
 * Validação por RESULTADO, não por status — a primeira regra permanente deste
 * projeto. Ela TENTA o token de verdade; o `_tokenCache` faz a chamada seguinte
 * sair de graça, então o /health não vira custo por requisição.
 *
 * Nunca lança: health que explode é health que não responde, e aí a tela não
 * consegue nem dizer o que está errado.
 */
export async function checkAuth() {
    const base = checkCredentials();
    if (!base.configured) {
        return {
            ...base,
            tokenOk: false,
            tokenErro: 'Credenciais não configuradas (SHAREPOINT_CLIENT_ID / GRAPH_CLIENT_SECRET).',
        };
    }
    try {
        await getAccessToken();
        return { ...base, tokenOk: true, tokenErro: null };
    } catch (e) {
        // A mensagem da Microsoft vai INTEIRA: foi ela que resolveu o caso de
        // 28/08 (o `AADSTS90002` nomeia o tenant recusado na cara).
        return { ...base, tokenOk: false, tokenErro: String(e?.message || e).slice(0, 600) };
    }
}
