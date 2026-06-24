import { getAuth } from 'firebase/auth';
import type { User } from '../types';
import type { EmpresaPerfilOption, RegimeSugerido } from './xmlFiscalService';

const BASE = '/api/admin/empresas-perfil';

const REGIMES_VALIDOS = new Set<RegimeSugerido>([
    'LUCRO_REAL_INDUSTRIA',
    'LUCRO_REAL_SERVICOS',
    'LUCRO_REAL_COMERCIO',
    'LUCRO_PRESUMIDO',
    'SIMPLES',
]);

async function authHeaders(_user: User | null): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuario nao autenticado');
    const token = await u.getIdToken();
    return { Authorization: `Bearer ${token}` };
}

function texto(value: unknown): string {
    return String(value || '').trim();
}

function textoOpcional(value: unknown): string | undefined {
    const out = texto(value);
    return out || undefined;
}

function normalizarCnpj(value: unknown): string {
    return texto(value).replace(/\D/g, '');
}

function normalizarRegime(value: unknown, fonte: 'simples' | 'lucro'): RegimeSugerido {
    if (REGIMES_VALIDOS.has(value as RegimeSugerido)) return value as RegimeSugerido;
    return fonte === 'simples' ? 'SIMPLES' : 'LUCRO_PRESUMIDO';
}

export function normalizarEmpresasPerfilResponse(data: unknown): EmpresaPerfilOption[] {
    if (!Array.isArray(data)) return [];
    const map = new Map<string, EmpresaPerfilOption>();

    data.forEach((raw) => {
        if (!raw || typeof raw !== 'object') return;
        const item = raw as Record<string, unknown>;
        const fonte = item.fonte === 'simples' || item.fonte === 'lucro' ? item.fonte : null;
        if (!fonte) return;
        const id = texto(item.id);
        const nome = texto(item.nome);
        const cnpj = normalizarCnpj(item.cnpj);
        if (!id || !nome || cnpj.length !== 14) return;

        const empresa: EmpresaPerfilOption = {
            id,
            nome,
            cnpj,
            fonte,
            regimeSugerido: normalizarRegime(item.regimeSugerido, fonte),
            uf: textoOpcional(item.uf),
            inscricaoEstadual: textoOpcional(item.inscricaoEstadual),
            ccmSp: textoOpcional(item.ccmSp),
            createdBy: textoOpcional(item.createdBy),
        };
        const key = empresa.cnpj || empresa.id;
        if (!map.has(key)) map.set(key, empresa);
    });

    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
}

export async function listarEmpresasPerfilBackend(user: User | null): Promise<EmpresaPerfilOption[]> {
    if (!user) return [];
    const res = await fetch(BASE, { headers: await authHeaders(user) });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const msg = data && typeof data === 'object' && 'error' in data
            ? String((data as { error?: unknown }).error || '')
            : '';
        throw new Error(msg || `listarEmpresasPerfilBackend: ${res.status}`);
    }
    return normalizarEmpresasPerfilResponse(data);
}
