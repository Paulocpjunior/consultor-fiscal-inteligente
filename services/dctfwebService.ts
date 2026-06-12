/**
 * services/dctfwebService.ts
 *
 * Cliente HTTP para o backend /api/admin/dctfweb.
 * Endpoints:
 *   GET  /status                        -> {mode, ok}
 *   GET  /resumo                        -> resumo agregado dashboard
 *   GET  /declaracoes?{filtros}         -> lista declaracoes
 *   POST /sincronizar                   -> sincroniza 1 empresa
 *   POST /transmitir                    -> transmite declaracao
 *   POST /gerar-darf                    -> gera DARF (ATIVA ou EM_ANDAMENTO)
 *   GET  /declaracao-completa           -> PDF declaracao ATIVA
 *   GET  /recibo                        -> PDF recibo transmissao
 *   POST /mit/encerrar                  -> encerra apuracao MIT
 *   GET  /mit/status                    -> status encerramento MIT
 *   GET  /mit/apuracao                  -> detalhes apuracao MIT
 *   GET  /mit/historico                 -> historico apuracoes do ano
 */
import type {
    User,
    DctfwebDeclaracao, DctfwebResumo, DctfwebSyncStats,
    DctfwebTransmissaoResult, DctfwebDarfResult, DctfwebPdfResult,
    DctfwebCategoria, DctfwebMitApuracao, DctfwebMitEncerramentoResult,
    DctfwebMitHistorico,
} from '../types';

import { getAuth } from 'firebase/auth';

const BASE = '/api/admin/dctfweb';

async function authHeaders(_user: User | null): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuario nao autenticado');
    const token = await u.getIdToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

export async function getStatus(user: User | null): Promise<{ mode: 'mock' | 'serpro'; ok: boolean }> {
    const res = await fetch(`${BASE}/status`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`getStatus: ${res.status}`);
    return res.json();
}

export async function getResumo(user: User | null): Promise<DctfwebResumo> {
    const res = await fetch(`${BASE}/resumo`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`getResumo: ${res.status}`);
    return res.json();
}

export interface ListarFilters {
    empresaCnpj?: string;
    situacao?: 'EM_ANDAMENTO' | 'ATIVA';
    anoPA?: number;
    mesPA?: number;
}

export async function listarDeclaracoes(user: User | null, filters: ListarFilters = {}): Promise<DctfwebDeclaracao[]> {
    const qs = new URLSearchParams();
    if (filters.empresaCnpj) qs.set('empresaCnpj', filters.empresaCnpj);
    if (filters.situacao) qs.set('situacao', filters.situacao);
    if (filters.anoPA) qs.set('anoPA', String(filters.anoPA));
    if (filters.mesPA) qs.set('mesPA', String(filters.mesPA));

    const res = await fetch(`${BASE}/declaracoes?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`listarDeclaracoes: ${res.status}`);
    return res.json();
}

export async function sincronizarEmpresa(user: User | null, payload: {
    empresaId: string; empresaCnpj: string;
    anoPA?: number; mesPA?: number; categoria?: DctfwebCategoria;
}): Promise<DctfwebSyncStats> {
    const res = await fetch(`${BASE}/sincronizar`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `sincronizarEmpresa: ${res.status}`);
    }
    return res.json();
}

export async function transmitirDeclaracao(user: User | null, payload: {
    empresaId: string; empresaCnpj: string;
    anoPA: number; mesPA: number; categoria?: DctfwebCategoria;
}): Promise<DctfwebTransmissaoResult> {
    const res = await fetch(`${BASE}/transmitir`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `transmitirDeclaracao: ${res.status}`);
    }
    return res.json();
}

export async function gerarDarf(user: User | null, payload: {
    empresaId?: string; empresaCnpj: string;
    anoPA: number; mesPA: number;
    categoria?: DctfwebCategoria;
    emAndamento?: boolean;
}): Promise<DctfwebDarfResult> {
    const res = await fetch(`${BASE}/gerar-darf`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `gerarDarf: ${res.status}`);
    }
    return res.json();
}

export async function consultarDeclaracaoCompleta(user: User | null, params: {
    empresaCnpj: string; anoPA: number; mesPA: number; categoria?: DctfwebCategoria;
}): Promise<DctfwebPdfResult> {
    const qs = new URLSearchParams({
        empresaCnpj: params.empresaCnpj,
        anoPA: String(params.anoPA),
        mesPA: String(params.mesPA),
    });
    if (params.categoria) qs.set('categoria', params.categoria);
    const res = await fetch(`${BASE}/declaracao-completa?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`consultarDeclaracaoCompleta: ${res.status}`);
    return res.json();
}

export async function consultarRecibo(user: User | null, params: {
    empresaCnpj: string; anoPA: number; mesPA: number; categoria?: DctfwebCategoria | number;
}): Promise<DctfwebPdfResult> {
    const qs = new URLSearchParams({
        empresaCnpj: params.empresaCnpj,
        anoPA: String(params.anoPA),
        mesPA: String(params.mesPA),
    });
    if (params.categoria !== undefined) qs.set('categoria', String(params.categoria));
    const res = await fetch(`${BASE}/recibo?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`consultarRecibo: ${res.status}`);
    return res.json();
}

// ── MIT ────────────────────────────────────────────────────────────────────

export async function encerrarApuracaoMit(user: User | null, payload: {
    empresaId?: string; empresaCnpj: string;
    anoPA: number; mesPA: number;
    dadosApuracaoMit?: any;
}): Promise<DctfwebMitEncerramentoResult> {
    const res = await fetch(`${BASE}/mit/encerrar`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `encerrarApuracaoMit: ${res.status}`);
    }
    return res.json();
}

export async function consultarStatusEncerramentoMit(user: User | null, params: {
    empresaCnpj: string; protocolo?: string; anoPA?: number; mesPA?: number;
}): Promise<{ statusEncerramento: string; protocolo: string; fonte: 'mock' | 'serpro'; _raw?: any }> {
    const qs = new URLSearchParams({ empresaCnpj: params.empresaCnpj });
    if (params.protocolo) qs.set('protocolo', params.protocolo);
    if (params.anoPA) qs.set('anoPA', String(params.anoPA));
    if (params.mesPA) qs.set('mesPA', String(params.mesPA));
    const res = await fetch(`${BASE}/mit/status?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`consultarStatusEncerramentoMit: ${res.status}`);
    return res.json();
}

export async function consultarApuracaoMit(user: User | null, params: {
    empresaCnpj: string; anoPA: number; mesPA: number;
}): Promise<DctfwebMitApuracao> {
    const qs = new URLSearchParams({
        empresaCnpj: params.empresaCnpj,
        anoPA: String(params.anoPA),
        mesPA: String(params.mesPA),
    });
    const res = await fetch(`${BASE}/mit/apuracao?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`consultarApuracaoMit: ${res.status}`);
    return res.json();
}

export async function consultarApuracoesAno(user: User | null, params: {
    empresaCnpj: string; anoPA: number;
}): Promise<DctfwebMitHistorico> {
    const qs = new URLSearchParams({
        empresaCnpj: params.empresaCnpj,
        anoPA: String(params.anoPA),
    });
    const res = await fetch(`${BASE}/mit/historico?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`consultarApuracoesAno: ${res.status}`);
    return res.json();
}

// ── Helpers de display ─────────────────────────────────────────────────────

function cleanBase64(base64: string): string {
    return base64.includes(',') ? base64.split(',').pop() || '' : base64;
}

export function pdfBlobFromBase64(base64: string): Blob {
    const byteChars = atob(cleanBase64(base64));
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
        bytes[i] = byteChars.charCodeAt(i);
    }
    return new Blob([bytes], { type: 'application/pdf' });
}

export function createPdfObjectUrlFromBase64(base64: string): string {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        return URL.createObjectURL(pdfBlobFromBase64(base64));
    }
    return `data:application/pdf;base64,${cleanBase64(base64)}`;
}

export function revokePdfObjectUrl(url: string): void {
    if (url.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
    }
}

export function downloadPdfFromBase64(base64: string, filename: string): void {
    if (!base64) return;
    const url = createPdfObjectUrlFromBase64(base64);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => revokePdfObjectUrl(url), 60000);
}

export function openPdfFromBase64(base64: string): void {
    if (!base64) return;
    const url = createPdfObjectUrlFromBase64(base64);
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => revokePdfObjectUrl(url), 60000);
}

export function formatPaLabel(anoPA: number, mesPA: number): string {
    return `${String(mesPA).padStart(2, '0')}/${anoPA}`;
}

export function situacaoLabel(s: string): string {
    const map: Record<string, string> = {
        EM_ANDAMENTO: 'Em andamento',
        ATIVA: 'Transmitida',
        ENCERRADA: 'Encerrada',
        DESCONHECIDA: 'Desconhecida',
    };
    return map[s] || s;
}

export function situacaoColorClass(s: string): string {
    const map: Record<string, string> = {
        EM_ANDAMENTO: 'bg-amber-100 text-amber-800',
        ATIVA: 'bg-emerald-100 text-emerald-800',
        ENCERRADA: 'bg-slate-100 text-slate-800',
        DESCONHECIDA: 'bg-slate-100 text-slate-500',
    };
    return map[s] || 'bg-slate-100 text-slate-700';
}
