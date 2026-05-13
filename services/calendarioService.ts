/**
 * services/calendarioService.ts
 * Cliente HTTP do Calendario Fiscal.
 */
import { getAuth } from 'firebase/auth';
import type { User, CalendarioResponse } from '../types';

async function getIdToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuário não autenticado');
    return u.getIdToken();
}

export async function getCalendario(_user: User | null, ano: number, mes: number): Promise<CalendarioResponse> {
    const token = await getIdToken();
    const res = await fetch(`/api/admin/calendario/${ano}/${mes}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`getCalendario: ${res.status}`);
    return res.json();
}

// Helpers
export function formatBRL(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function tipoIcon(t: string): string {
    const map: Record<string, string> = {
        'DAS': '💸',
        'DEFIS': '📋',
        'DARF-IRPJ': '🏛️',
        'DARF-CSLL': '🏛️',
        'PIS-COFINS': '📑',
        'DCTF': '📤',
        'DCTFWEB': '🌐',
        'ESOCIAL': '👥',
    };
    return map[t] || '📌';
}

export function tipoCor(t: string): string {
    const map: Record<string, string> = {
        'DAS': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
        'DEFIS': 'bg-purple-100 text-purple-800',
        'DARF-IRPJ': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
        'DARF-CSLL': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
        'PIS-COFINS': 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
        'DCTF': 'bg-indigo-100 text-indigo-800',
        'DCTFWEB': 'bg-indigo-100 text-indigo-800',
        'ESOCIAL': 'bg-rose-100 text-rose-800',
    };
    return map[t] || 'bg-slate-100 text-slate-800';
}

export function diasAteVencimento(vencimento: string): number {
    const hoje = new Date(new Date().toISOString().slice(0, 10));
    const venc = new Date(vencimento);
    return Math.floor((venc.getTime() - hoje.getTime()) / 86400000);
}
