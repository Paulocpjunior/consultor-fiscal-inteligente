/**
 * services/prontidaoService.ts
 * Cliente HTTP do modulo Prontidao SERPRO.
 * Backend: /api/admin/prontidao (auth real via Bearer token Firebase).
 */
import { getAuth } from 'firebase/auth';
import type { User } from '../types';

export type CertStatus = 'valido' | 'vencendo' | 'vencido' | 'ausente';
export type ProcuracaoStatus = 'ok' | 'sem_procuracao' | 'erro' | 'nao_testado';

export interface ProntidaoEmpresa {
    empresaId: string;
    nome: string | null;
    cnpj: string | null;
    cert: {
        status: CertStatus;
        diasRestantes: number | null;
        notAfter: string | null;
        uploadedBy: string | null;
        uploadedAt: string | null;
    };
    procuracao: {
        status: ProcuracaoStatus;
    };
}

export interface ProntidaoResponse {
    ok: boolean;
    totalComCert: number;
    empresas: ProntidaoEmpresa[];
}

async function getIdToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuario nao autenticado');
    return u.getIdToken();
}

export async function getProntidao(_user: User | null): Promise<ProntidaoResponse> {
    const token = await getIdToken();
    const res = await fetch('/api/admin/prontidao', {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`getProntidao: ${res.status}`);
    return res.json();
}

// Helpers de apresentacao — cor + label, sem emoji (texto puro)
export function certBadge(status: CertStatus): { label: string; cls: string } {
    switch (status) {
        case 'valido':   return { label: 'Valido',   cls: 'bg-green-500/20 text-green-300' };
        case 'vencendo': return { label: 'Vencendo', cls: 'bg-yellow-500/20 text-yellow-300' };
        case 'vencido':  return { label: 'Vencido',  cls: 'bg-red-500/20 text-red-300' };
        default:         return { label: 'Ausente',  cls: 'bg-slate-500/20 text-slate-300' };
    }
}

export function procuracaoBadge(status: ProcuracaoStatus): { label: string; cls: string } {
    switch (status) {
        case 'ok':             return { label: 'OK',             cls: 'bg-green-500/20 text-green-300' };
        case 'sem_procuracao': return { label: 'Sem procuracao', cls: 'bg-red-500/20 text-red-300' };
        case 'erro':           return { label: 'Erro',           cls: 'bg-orange-500/20 text-orange-300' };
        default:               return { label: 'Nao testado',    cls: 'bg-slate-500/20 text-slate-300' };
    }
}
