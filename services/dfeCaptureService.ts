/**
 * dfeCaptureService.ts
 * Captura automática de DF-e (NF-e/NFC-e) na SEFAZ.
 *
 * IMPORTANTE: nesta primeira fase NÃO há captura real. O fluxo SEFAZ exige
 * certificado A1/A3 e assinatura digital de SOAP — operações que precisam
 * acontecer em backend seguro. Este módulo expõe a interface pública para
 * que a UI já possa ser construída e ligada quando o backend estiver pronto.
 */

import type { User, XmlCaptura, EmpresaXmlConfig } from '../types';

export interface DfeCaptureRequest {
    empresa: EmpresaXmlConfig;
    user: User;
    /** Janela de busca (ISO date) — opcional. */
    desde?: string;
    ate?: string;
}

export interface DfeCaptureResultItem {
    chave: string;
    capturado: boolean;
    motivo?: string;
}

export interface DfeCaptureResult {
    sucesso: boolean;
    motivo: string;
    itens: DfeCaptureResultItem[];
    registros?: XmlCaptura[];
}

/** Sempre retorna implementação pendente. */
export async function captureFromSefaz(_req: DfeCaptureRequest): Promise<DfeCaptureResult> {
    return {
        sucesso: false,
        motivo: 'Captura SEFAZ ainda não disponível. Será habilitada após a integração com o backend seguro de certificado digital.',
        itens: [],
    };
}

export function isSefazCaptureAvailable(): boolean {
    return false;
}

/**
 * Configura agendamento de captura. Hoje, apenas valida que o backend
 * ainda não foi habilitado.
 */
export async function scheduleAutoCapture(
    _empresaConfig: EmpresaXmlConfig,
): Promise<{ ok: boolean; motivo: string }> {
    return {
        ok: false,
        motivo: 'Agendamento de captura automática só estará disponível após o backend seguro entrar em produção.',
    };
}
