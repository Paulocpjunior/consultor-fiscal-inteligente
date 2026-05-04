/**
 * dfeCaptureService.ts
 * Cliente HTTP do backend cfi-sefaz-proxy.
 *
 * Quando VITE_SEFAZ_BACKEND_URL nao esta definido (ou aponta para vazio),
 * o servico opera em modo "indisponivel" e devolve respostas que indicam
 * que o backend ainda nao foi configurado. Isto permite que o front rode
 * sem backend (modo local/teste) sem quebrar a UI.
 *
 * Quando VITE_SEFAZ_BACKEND_URL esta setado, faz POST autenticado com
 * Firebase ID token e devolve a lista de status atualizados por chave.
 */

import { auth } from './firebaseConfig';
import type { User, XmlStatusDocumento } from '../types';

const BACKEND_URL = (import.meta.env.VITE_SEFAZ_BACKEND_URL || '').replace(/\/+$/, '');

export interface DfeCaptureRequest {
    cnpjTitular: string;
    chaves: string[];
    user: User;
}

export interface DfeCaptureResultItem {
    chave: string;
    cStat: string;
    xMotivo: string;
    status: XmlStatusDocumento;
    consultadoEm: string;
    canceladaEm?: string;
}

export interface DfeCaptureResult {
    sucesso: boolean;
    motivo?: string;
    itens: DfeCaptureResultItem[];
}

export function isSefazCaptureAvailable(): boolean {
    return !!BACKEND_URL;
}

async function getAuthToken(): Promise<string | null> {
    if (!auth?.currentUser) return null;
    try {
        return await auth.currentUser.getIdToken(/* forceRefresh */ false);
    } catch {
        return null;
    }
}

export async function captureFromSefaz(req: DfeCaptureRequest): Promise<DfeCaptureResult> {
    if (!BACKEND_URL) {
        return {
            sucesso: false,
            motivo: 'Backend SEFAZ nao configurado (VITE_SEFAZ_BACKEND_URL ausente).',
            itens: [],
        };
    }
    if (!req.chaves.length) {
        return { sucesso: false, motivo: 'Nenhuma chave informada.', itens: [] };
    }
    if (req.chaves.length > 50) {
        return { sucesso: false, motivo: 'Maximo 50 chaves por chamada.', itens: [] };
    }

    const token = await getAuthToken();
    if (!token) {
        return { sucesso: false, motivo: 'Usuario nao autenticado.', itens: [] };
    }

    try {
        const resp = await fetch(`${BACKEND_URL}/api/sefaz/consulta-status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ cnpjTitular: req.cnpjTitular, chaves: req.chaves }),
        });

        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            return {
                sucesso: false,
                motivo: `Backend retornou ${resp.status}: ${txt.slice(0, 200)}`,
                itens: [],
            };
        }
        const data = await resp.json();
        return {
            sucesso: !!data.ok,
            itens: Array.isArray(data.resultados) ? data.resultados : [],
        };
    } catch (err: any) {
        return {
            sucesso: false,
            motivo: `Falha de rede: ${err?.message || err}`,
            itens: [],
        };
    }
}

export async function pingBackend(): Promise<{ ok: boolean; mode?: string; version?: string; motivo?: string }> {
    if (!BACKEND_URL) return { ok: false, motivo: 'Backend nao configurado.' };
    try {
        const resp = await fetch(`${BACKEND_URL}/api/health`);
        if (!resp.ok) return { ok: false, motivo: `HTTP ${resp.status}` };
        const data = await resp.json();
        return { ok: !!data.ok, mode: data.mode, version: data.version };
    } catch (err: any) {
        return { ok: false, motivo: `Falha de rede: ${err?.message || err}` };
    }
}

// ─── Cadastro de certificado (placeholder) ────────────────────────────────
// Sera implementado na Fase B junto com o backend USE_MOCKS=false.

export async function scheduleAutoCapture(_empresaConfig: unknown): Promise<{ ok: boolean; motivo: string }> {
    return {
        ok: false,
        motivo: 'Agendamento automatico ainda nao disponivel.',
    };
}
