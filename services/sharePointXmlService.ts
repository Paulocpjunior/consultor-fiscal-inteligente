/**
 * sharePointXmlService.ts
 * Integração com SharePoint para captura de XMLs.
 *
 * Mockado nesta fase. A integração real exige Microsoft Graph + delegação
 * OAuth e deve passar por backend (não pelo front-end). A interface aqui
 * estabelece o contrato que o componente XmlSharePoint consumirá.
 */

import type { User, EmpresaXmlConfig } from '../types';

export interface SharePointSyncRequest {
    empresa: EmpresaXmlConfig;
    user: User;
    folderUrl: string;
}

export interface SharePointSyncResult {
    sucesso: boolean;
    motivo: string;
    arquivosLidos: number;
    arquivosImportados: number;
    arquivosDuplicados: number;
}

export async function syncFromSharePoint(_req: SharePointSyncRequest): Promise<SharePointSyncResult> {
    return {
        sucesso: false,
        motivo: 'Integração SharePoint ainda não disponível nesta fase.',
        arquivosLidos: 0,
        arquivosImportados: 0,
        arquivosDuplicados: 0,
    };
}

export function isSharePointAvailable(): boolean {
    return false;
}

export async function testSharePointConnection(_folderUrl: string): Promise<{ ok: boolean; mensagem: string }> {
    return { ok: false, mensagem: 'Conexão SharePoint disponível apenas em fase futura.' };
}
