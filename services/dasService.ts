/**
 * services/dasService.ts
 * Cliente HTTP pra /api/admin/das.
 */
import type { User, DasEmitido, DasResumo, DasStatusPagamento, DasPrevisaoResponse, DasPrevisaoIaResponse, DasEnvioCliente } from '../types';

import { getAuth } from 'firebase/auth';

const BASE = '/api/admin/das';

async function authHeaders(_user: User | null): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuario nao autenticado');
    const token = await u.getIdToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

export async function getResumoDas(user: User | null): Promise<DasResumo> {
    const res = await fetch(`${BASE}/resumo`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`getResumoDas: ${res.status}`);
    return res.json();
}

export async function listarDas(
    user: User | null,
    filters: { empresaId?: string; competencia?: string; status?: DasStatusPagamento } = {}
): Promise<DasEmitido[]> {
    const qs = new URLSearchParams();
    if (filters.empresaId) qs.set('empresaId', filters.empresaId);
    if (filters.competencia) qs.set('competencia', filters.competencia);
    if (filters.status) qs.set('status', filters.status);

    const res = await fetch(`${BASE}/listar?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`listarDas: ${res.status}`);
    return res.json();
}

export async function emitirDasRegular(user: User | null, payload: {
    empresaId: string; empresaCnpj: string; empresaNome: string;
    competencia: string; valor: number;
    dadosPgdas?: any;  // payload PGDAS-D montado pelo pgdasMapper
}): Promise<DasEmitido> {
    const res = await fetch(`${BASE}/emitir-regular`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `emitirDasRegular: ${res.status}`);
    }
    return res.json();
}

export async function emitirDasAvulso(user: User | null, payload: {
    empresaId: string; empresaCnpj: string; empresaNome: string;
    competencia: string; valor: number; descricao?: string;
}): Promise<DasEmitido> {
    const res = await fetch(`${BASE}/emitir-avulso`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `emitirDasAvulso: ${res.status}`);
    }
    return res.json();
}

export async function marcarDasPago(user: User | null, docId: string, dataPagamento?: string): Promise<{ ok: boolean }> {
    const res = await fetch(`${BASE}/marcar-pago`, {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify({ docId, dataPagamento }),
    });
    if (!res.ok) throw new Error(`marcarDasPago: ${res.status}`);
    return res.json();
}

// Helpers de display
export function parseValorMoedaBr(value: string | number | null | undefined): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value ?? '').trim();
    if (!raw) return 0;
    const cleaned = raw.replace(/[^\d,.-]/g, '');
    if (!cleaned) return 0;

    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
        const decimalSep = lastComma > lastDot ? ',' : '.';
        const thousandSep = decimalSep === ',' ? '.' : ',';
        const normalized = cleaned
            .replace(new RegExp(`\\${thousandSep}`, 'g'), '')
            .replace(decimalSep, '.');
        const n = Number(normalized);
        return Number.isFinite(n) ? n : 0;
    }

    if (lastComma >= 0) {
        const n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
        return Number.isFinite(n) ? n : 0;
    }

    const dotMatches = cleaned.match(/\./g) || [];
    if (dotMatches.length > 1) {
        const n = Number(cleaned.replace(/\./g, ''));
        return Number.isFinite(n) ? n : 0;
    }

    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
}

export function formatBRL(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatBarras(barras: string): string {
    if (!barras || barras.length !== 44) return barras;
    return `${barras.slice(0,5)}.${barras.slice(5,10)} ${barras.slice(10,15)}.${barras.slice(15,21)} ${barras.slice(21,26)}.${barras.slice(26,32)} ${barras.slice(32,33)} ${barras.slice(33)}`;
}

export function statusBadgeClass(status: string): string {
    const map: Record<string, string> = {
        pago: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
        pendente: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
        vencido: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    };
    return map[status] || 'bg-slate-100 text-slate-700';
}

export function statusLabel(status: string): string {
    const map: Record<string, string> = { pago: 'Pago', pendente: 'Pendente', vencido: 'Vencido' };
    return map[status] || status;
}


// ─── Previsão DAS (D4a) ────────────────────────────────────────────────────

export async function getPrevisaoDas(user: User | null, empresaId: string): Promise<DasPrevisaoResponse> {
    const res = await fetch(`/api/admin/das/previsao/${empresaId}`, { headers: await authHeaders(user) });
    if (!res.ok) throw new Error(`getPrevisaoDas: ${res.status}`);
    return res.json();
}

export async function getPrevisaoIa(user: User | null, dadosPrevisao: DasPrevisaoResponse): Promise<DasPrevisaoIaResponse> {
    const res = await fetch('/api/admin/das/previsao-ia', {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify({ dadosPrevisao }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `getPrevisaoIa: ${res.status}`);
    }
    return res.json();
}


// ─── Cobrança DAS via IA ───────────────────────────────────────────────────

export interface CobrancaIaRequest {
    empresaCnpj?: string;
    empresaNome: string;
    valor: number;
    competencia?: string;
    vencimento?: string;
    numeroDocumento?: string;
    codigoBarras?: string;
    hasPdf?: boolean;
    diasAtraso?: number;
    tom: 'firme' | 'amigavel';
    canal: 'email' | 'whatsapp';
    assinante: string;
}

export interface CobrancaIaResponse {
    assunto: string;
    mensagem: string;
    modelo: string;
    geradoEm: string;
}

export interface EnviarDasClienteRequest {
    dasId?: string;
    empresaCnpj: string;
    empresaNome: string;
    competencia?: string;
    valor: number;
    vencimento?: string;
    emailDest: string;
    assunto?: string;
    mensagem: string;
    pdfBase64?: string | null;
    pdfFileName?: string;
}

export async function getCobrancaIa(user: User | null, req: CobrancaIaRequest): Promise<CobrancaIaResponse> {
    const res = await fetch('/api/admin/das/cobranca-ia', {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(req),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `getCobrancaIa: ${res.status}`);
    }
    return res.json();
}

export async function enviarDasCliente(user: User | null, req: EnviarDasClienteRequest): Promise<{ ok: boolean; para: string; copiaPara?: string[]; anexouPdf: boolean }> {
    const res = await fetch('/api/admin/das/enviar-cliente', {
        method: 'POST',
        headers: await authHeaders(user),
        body: JSON.stringify(req),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `enviarDasCliente: ${res.status}`);
    }
    return res.json();
}

export async function listarEnviosDas(
    user: User | null,
    filters: { cnpj?: string; dasId?: string; limit?: number } = {}
): Promise<DasEnvioCliente[]> {
    const qs = new URLSearchParams();
    if (filters.cnpj) qs.set('cnpj', filters.cnpj);
    if (filters.dasId) qs.set('dasId', filters.dasId);
    if (filters.limit) qs.set('limit', String(filters.limit));

    const res = await fetch(`${BASE}/envios-cliente?${qs}`, { headers: await authHeaders(user) });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `listarEnviosDas: ${res.status}`);
    }
    const data = await res.json();
    return data.envios || [];
}
