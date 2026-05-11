// ============================================================================
// sefaz-backend/sharepoint-provider.js
// Provider de leitura do SharePoint via Microsoft Graph API.
//
// Autentica via OAuth2 client_credentials usando:
//   - SHAREPOINT_TENANT_ID
//   - SHAREPOINT_CLIENT_ID
//   - SHAREPOINT_CLIENT_SECRET (do Google Secret Manager)
//   - SHAREPOINT_HOST          (ex: spassessoriacontabilcombr.sharepoint.com)
//   - SHAREPOINT_SITE_PATH     (ex: GestoFiscal-SPAssessoriaContabil)
//
// Permissoes Microsoft Graph (Application):
//   - Sites.Selected   (precisa de grant explicito por site - ver /grant-site)
//   - Files.Read.All
//
// Token cacheado em memoria 50min (TTL real 60min mas folga de 10).
// ============================================================================

const TENANT_ID = process.env.SHAREPOINT_TENANT_ID || '';
const CLIENT_ID = process.env.SHAREPOINT_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET || '';
const HOST = process.env.SHAREPOINT_HOST || '';
const SITE_PATH = process.env.SHAREPOINT_SITE_PATH || '';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// Cache em memoria
let _tokenCache = { value: null, expiresAt: 0 };
let _siteIdCache = null;

// ── Auth ──────────────────────────────────────────────────────────────────

/**
 * Obtem access token OAuth2 via client_credentials flow.
 * Cacheia 50 minutos (TTL real Microsoft eh 60 min).
 */
export async function getAccessToken() {
    if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
        throw new Error(
            'Credenciais SharePoint nao configuradas. Defina SHAREPOINT_TENANT_ID, ' +
            'SHAREPOINT_CLIENT_ID e SHAREPOINT_CLIENT_SECRET no Cloud Run.'
        );
    }

    // Retorna do cache se ainda valido
    const now = Date.now();
    if (_tokenCache.value && _tokenCache.expiresAt > now) {
        return _tokenCache.value;
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
        throw new Error(`OAuth2 token request failed: ${resp.status} ${txt}`);
    }

    const data = await resp.json();
    if (!data.access_token) {
        throw new Error(`Token response sem access_token: ${JSON.stringify(data)}`);
    }

    _tokenCache = {
        value: data.access_token,
        expiresAt: now + (50 * 60 * 1000),  // 50 min
    };
    return data.access_token;
}

/**
 * Wrapper de fetch que injeta Authorization automaticamente.
 */
async function graphFetch(path, opts = {}) {
    const token = await getAccessToken();
    const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
    const resp = await fetch(url, {
        ...opts,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            ...(opts.headers || {}),
        },
    });
    if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`Graph API ${resp.status} ${resp.statusText}: ${txt.slice(0, 500)}`);
    }
    return resp;
}

// ── Site Resolution ────────────────────────────────────────────────────────

/**
 * Resolve o site ID do SharePoint a partir do host + site path.
 * Resultado cacheado em memoria (sites raramente mudam).
 *
 * Formato Microsoft Graph: /sites/{host}:/sites/{path}
 *   GET https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/MeuSite
 *
 * Retorna { id, displayName, webUrl }
 */
export async function getSiteId() {
    if (_siteIdCache) return _siteIdCache;

    if (!HOST || !SITE_PATH) {
        throw new Error('SHAREPOINT_HOST e SHAREPOINT_SITE_PATH obrigatorios');
    }

    const path = `/sites/${HOST}:/sites/${SITE_PATH}`;
    const resp = await graphFetch(path);
    const data = await resp.json();

    _siteIdCache = {
        id: data.id,                 // formato: hostname,site-collection-guid,site-guid
        displayName: data.displayName,
        webUrl: data.webUrl,
    };
    return _siteIdCache;
}

// ── Permissions (Sites.Selected) ──────────────────────────────────────────

/**
 * Autoriza este app a ler o site especifico.
 * Necessario porque escolhemos Sites.Selected (ao inves de Sites.Read.All).
 * Roda 1 vez apos configurar o app no Azure.
 *
 * Microsoft Graph endpoint:
 *   POST /sites/{site-id}/permissions
 *   Body: { roles: ['read'], grantedToIdentities: [{ application: { id, displayName }}] }
 *
 * @returns { id (permission id), roles, app: { id, displayName } }
 */
export async function grantAppPermissionOnSite() {
    const site = await getSiteId();
    const path = `/sites/${site.id}/permissions`;

    const body = {
        roles: ['read'],
        grantedToIdentities: [
            {
                application: {
                    id: CLIENT_ID,
                    displayName: 'Consultor Fiscal Inteligente - SharePoint',
                },
            },
        ],
    };

    const resp = await graphFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return resp.json();
}

/**
 * Lista permissoes ativas do app no site.
 * Util pra debugar (confirmar que grantAppPermissionOnSite rodou OK).
 */
export async function listSitePermissions() {
    const site = await getSiteId();
    const resp = await graphFetch(`/sites/${site.id}/permissions`);
    return resp.json();
}

// ── Diagnostics ────────────────────────────────────────────────────────────

/**
 * Testa auth ponta a ponta:
 *  1. Gera token
 *  2. Resolve site ID
 * Retorna info pra debug. Nao expõe nenhum secret.
 */
export async function testAuth() {
    const start = Date.now();
    const info = {
        tenantIdConfigured: !!TENANT_ID,
        clientIdConfigured: !!CLIENT_ID,
        clientSecretConfigured: !!CLIENT_SECRET,
        hostConfigured: !!HOST,
        sitePathConfigured: !!SITE_PATH,
        clientSecretLength: CLIENT_SECRET.length,
    };

    if (!info.clientSecretConfigured || info.clientSecretLength < 20) {
        throw new Error(
            `SHAREPOINT_CLIENT_SECRET nao configurado ou muito curto (${info.clientSecretLength} chars). ` +
            'Verifique Secret Manager.'
        );
    }

    // 1. Token
    const token = await getAccessToken();
    info.tokenPrefix = token.slice(0, 20) + '...';
    info.tokenLength = token.length;

    // 2. Site ID
    const site = await getSiteId();
    info.site = site;

    info.elapsedMs = Date.now() - start;
    return info;
}

// ── Drives + Arquivos (teste de funcionalidade real) ─────────────────────

/**
 * Lista os drives (bibliotecas de documentos) do site.
 * Em SharePoint, cada site tem 1+ drive (geralmente 'Documents' por padrao).
 */
export async function listDrives() {
    const site = await getSiteId();
    const resp = await graphFetch(`/sites/${site.id}/drives`);
    const data = await resp.json();
    return data;
}

/**
 * Lista o conteudo (pastas + arquivos) da raiz do drive default.
 */
export async function listRootItems() {
    const site = await getSiteId();
    const resp = await graphFetch(`/sites/${site.id}/drive/root/children`);
    return resp.json();
}

/**
 * Lista items de uma pasta especifica (path estilo /Pasta1/Subpasta).
 */
export async function listFolderItems(folderPath) {
    const site = await getSiteId();
    // path eh relativo a raiz do drive default. URL-encoded.
    const clean = (folderPath || '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const path = clean
        ? `/sites/${site.id}/drive/root:/${encodeURIComponent(clean)}:/children`
        : `/sites/${site.id}/drive/root/children`;
    const resp = await graphFetch(path);
    return resp.json();
}

// ── Escrita (Files.ReadWrite.All) ──────────────────────────────────────────

/**
 * Garante que uma pasta exista no SharePoint (cria recursivamente se faltar).
 * @param {string} folderPath caminho relativo a raiz do drive (ex: "Empresas/12345/XMLs/2026-05")
 * @returns {object} metadata da pasta final
 */
export async function ensureFolder(folderPath) {
    const site = await getSiteId();
    const clean = (folderPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!clean) throw new Error('folderPath vazio');

    const segments = clean.split('/').filter(Boolean);
    let parentPath = '';

    for (const seg of segments) {
        const currentPath = parentPath ? `${parentPath}/${seg}` : seg;

        // Tenta GET no caminho
        try {
            const r = await graphFetch(`/sites/${site.id}/drive/root:/${encodeURIComponent(currentPath)}`);
            const data = await r.json();
            if (data.id) {
                parentPath = currentPath;
                continue;
            }
        } catch (e) {
            // Nao existe — cria
        }

        // Cria filho da pasta pai
        const createUrl = parentPath
            ? `/sites/${site.id}/drive/root:/${encodeURIComponent(parentPath)}:/children`
            : `/sites/${site.id}/drive/root/children`;

        const r = await graphFetch(createUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: seg,
                folder: {},
                '@microsoft.graph.conflictBehavior': 'replace',
            }),
        });
        await r.json();
        parentPath = currentPath;
    }

    // Retorna metadata final
    const final = await graphFetch(`/sites/${site.id}/drive/root:/${encodeURIComponent(clean)}`);
    return final.json();
}

/**
 * Upload de arquivo pequeno (<4MB) via PUT.
 * @param {string} filePath caminho completo (ex: "Empresas/12345/XMLs/2026-05/nota.xml")
 * @param {Buffer|string} content
 * @param {string} mimeType
 */
export async function uploadSmallFile(filePath, content, mimeType = 'application/octet-stream') {
    const site = await getSiteId();
    const clean = filePath.replace(/^\/+/, '');
    const url = `/sites/${site.id}/drive/root:/${encodeURIComponent(clean)}:/content`;

    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');

    const resp = await graphFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: buf,
    });
    return resp.json();
}

/**
 * Remove arquivo ou pasta vazia.
 */
export async function deleteItem(itemPath) {
    const site = await getSiteId();
    const clean = itemPath.replace(/^\/+/, '');
    const url = `/sites/${site.id}/drive/root:/${encodeURIComponent(clean)}`;
    await graphFetch(url, { method: 'DELETE' });
    return { deleted: true, path: clean };
}
