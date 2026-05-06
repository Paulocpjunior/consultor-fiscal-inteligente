/**
 * dfeCaptureService.ts (Fase 2 — captura real via backend)
 */

import { getAuth } from 'firebase/auth';
import type { User, XmlCaptura, EmpresaXmlConfig } from '../types';

export interface DfeCaptureRequest {
    empresa: EmpresaXmlConfig;
    user: User;
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
    novosXmls?: number;
    duplicados?: number;
    erros?: number;
    ultNSU?: string;
    rateLimited?: boolean;
    foraDeJanela?: boolean;
}

export interface SefazWindow {
    dentro: boolean;
    agoraBRT: string;
    diaSemana: number;
    motivo?: string;
}

export interface SefazState {
    cnpj: string;
    state: {
        ultNSU?: string;
        ultimaSync?: { _seconds: number } | string;
        ultimoColaborador?: string;
        cStatUltimaSync?: string;
        xMotivoUltimaSync?: string;
        paginas?: number;
    } | null;
    lock: {
        startedAt?: any;
        expiresAt?: any;
        lockedBy?: string;
        ativo?: boolean;
    } | null;
}

async function getToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return u.getIdToken();
}

export async function captureFromSefaz(req: DfeCaptureRequest): Promise<DfeCaptureResult> {
    try {
        const token = await getToken();
        const res = await fetch('/api/admin/sefaz/sync-one', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ empresaId: req.empresa.id, empresaCnpj: req.empresa.cnpj }),
        });
        const data = await res.json();
        if (res.status === 403) {
            return { sucesso: false, motivo: data.motivo || 'Fora da janela operacional', itens: [], foraDeJanela: true };
        }
        if (res.status === 409) {
            return { sucesso: false, motivo: data.motivo || 'Já sincronizado recentemente', itens: [], ultNSU: data.ultNSU };
        }
        if (res.status === 429) {
            return { sucesso: false, motivo: data.motivo || 'SEFAZ rate limit (cStat 656)', itens: [], rateLimited: true };
        }
        if (!res.ok) {
            return { sucesso: false, motivo: data.error || data.motivo || `Falha HTTP ${res.status}`, itens: [] };
        }
        return {
            sucesso: true,
            motivo: `${data.novosXmls || 0} novos · ${data.duplicados || 0} dup · ${data.erros || 0} erros`,
            itens: [],
            novosXmls: data.novosXmls,
            duplicados: data.duplicados,
            erros: data.erros,
            ultNSU: data.ultNSU,
        };
    } catch (err: any) {
        return { sucesso: false, motivo: err.message || 'Erro de rede', itens: [] };
    }
}

export function isSefazCaptureAvailable(): boolean {
    return true;
}

export async function scheduleAutoCapture(_e: EmpresaXmlConfig): Promise<{ ok: boolean; motivo: string }> {
    return {
        ok: true,
        motivo: 'Captura automática roda 02:00 BRT seg-sex via Cloud Scheduler. Configure capturarSefaz=true na empresa.',
    };
}

export async function getSefazState(cnpj: string): Promise<SefazState | null> {
    try {
        const token = await getToken();
        const res = await fetch(`/api/admin/sefaz/state/${encodeURIComponent(cnpj)}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

export async function getSefazWindow(): Promise<SefazWindow | null> {
    try {
        const token = await getToken();
        const res = await fetch('/api/admin/sefaz/window', {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}
