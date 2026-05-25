/**
 * sharePointXmlService.ts
 * Conecta o frontend ao proxy-backend SharePoint.
 * O proxy autentica via Microsoft Graph e acessa as pastas de XMLs.
 */

const PROXY_URL = 'https://consultor-fiscal-proxy-631239634290.us-west1.run.app';

export interface SharePointFile {
    id: string;
    name: string;
    webUrl: string;
    size: number;
    lastModified: string;
}

export interface SharePointSyncResult {
    found: number;
    downloaded: number;
    errors: number;
    files: { name: string; content?: string; error?: string }[];
}

export interface SharePointHealthStatus {
    configured: boolean;
    tenantId?: string;
    clientIdSet?: boolean;
    sharepointHost?: string;
    sitePath?: string;
}

async function proxyFetch(path: string, body?: object): Promise<Response> {
    const opts: RequestInit = body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : { method: 'GET' };
    return fetch(`${PROXY_URL}${path}`, opts);
}

export async function checkSharePointHealth(): Promise<SharePointHealthStatus> {
    try {
        const resp = await proxyFetch('/api/sharepoint/health');
        if (!resp.ok) return { configured: false };
        return resp.json();
    } catch {
        return { configured: false };
    }
}

export function isSharePointAvailable(): boolean {
    return true;
}

export async function listSharePointXmls(folderPath: string): Promise<SharePointFile[]> {
    const resp = await proxyFetch('/api/sharepoint/list-xmls', { folderPath });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Erro ao listar XMLs (${resp.status})`);
    }
    return resp.json();
}

export async function downloadSharePointXml(driveItemId: string): Promise<string> {
    const resp = await proxyFetch('/api/sharepoint/download-xml', { driveItemId });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Erro ao baixar XML (${resp.status})`);
    }
    const data = await resp.json();
    return data.content;
}

export async function syncSharePointFolder(folderPath: string): Promise<SharePointSyncResult> {
    const resp = await proxyFetch('/api/sharepoint/sync', { folderPath });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Erro no sync (${resp.status})`);
    }
    return resp.json();
}

export function buildFolderPath(
    grupo: string, ano: string, mes: string, empresa: string, direcao: 'SAÍDA' | 'ENTRADA' = 'SAÍDA'
): string {
    return `Empresas/${grupo}/DEPARTAMENTO FISCAL/${ano}/${mes}-${ano}/${empresa}/XML ${direcao}`;
}

export async function testSharePointConnection(folderUrl: string): Promise<{ ok: boolean; mensagem: string }> {
    try {
        const health = await checkSharePointHealth();
        if (!health.configured) return { ok: false, mensagem: 'Credenciais SharePoint não configuradas no proxy.' };
        const files = await listSharePointXmls(folderUrl);
        return { ok: true, mensagem: `Conectado. ${files.length} arquivo(s) encontrado(s).` };
    } catch (err: any) {
        return { ok: false, mensagem: err?.message || 'Falha na conexão.' };
    }
}
