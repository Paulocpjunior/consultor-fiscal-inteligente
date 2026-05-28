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
        // Federais — pagamento principal
        'DAS': '💸',
        'DAS-MEI': '💸',
        // Folha
        'INSS': '🏥',
        'FGTS': '💰',
        // Declarações federais via SPED/eSocial
        'DCTF': '🌐',
        'DCTFWEB': '🌐',
        'EFD-REINF': '🌐',
        'ESOCIAL': '👥',
        // IR / contribuições
        'IRRF': '📤',
        'PIS-COFINS': '📑',
        'DARF-IRPJ': '🏛️',
        'DARF-CSLL': '🏛️',
        // Anuais
        'DEFIS': '📋',
        'DASN-SIMEI': '📋',
        'ECD': '📚',
        'ECF': '📚',
        'DIRF': '📨',
        'DIRPF': '📨',
        // SPED
        'SPED-FISCAL': '📊',
        'SPED-CONTRIB': '📊',
        // Estaduais (ICMS)
        'GIA': '🏭',
        'ICMS': '🏭',
        'ICMS-ST': '🏭',
        'DESTDA': '🏭',
        // Municipais (ISS)
        'ISS': '🏪',
        'DMS': '🏪',
    };
    return map[t] || '📌';
}

export function tipoCor(t: string): string {
    const map: Record<string, string> = {
        // Federais — pagamento principal (verde)
        'DAS': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
        'DAS-MEI': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
        // Folha (rose/red)
        'INSS': 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
        'FGTS': 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
        // Declarações federais (indigo)
        'DCTF': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
        'DCTFWEB': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
        'EFD-REINF': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
        'ESOCIAL': 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
        // IR / contribuições (amber/sky)
        'IRRF': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
        'PIS-COFINS': 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
        'DARF-IRPJ': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
        'DARF-CSLL': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
        // Anuais (purple)
        'DEFIS': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
        'DASN-SIMEI': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
        'ECD': 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
        'ECF': 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
        'DIRF': 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-300',
        'DIRPF': 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-300',
        // SPED (teal)
        'SPED-FISCAL': 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
        'SPED-CONTRIB': 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
        // Estaduais ICMS (orange)
        'GIA': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
        'ICMS': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
        'ICMS-ST': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
        'DESTDA': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
        // Municipais ISS (lime/cyan)
        'ISS': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
        'DMS': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
    };
    return map[t] || 'bg-slate-100 text-slate-800';
}

export function diasAteVencimento(vencimento: string): number {
    const hoje = new Date(new Date().toISOString().slice(0, 10));
    const venc = new Date(vencimento);
    return Math.floor((venc.getTime() - hoje.getTime()) / 86400000);
}
