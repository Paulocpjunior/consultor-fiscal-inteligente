/**
 * dareSpService.ts — cliente das rotas /api/admin/dare/* (DARE-SP ICMS).
 * Preview valida no backend (fonte única de regras); registrar grava a
 * auditoria em dare_solicitacoes antes de a equipe emitir no portal.
 */
import { getAuth } from 'firebase/auth';

export interface DarePayload {
    contribuinte: { cnpj: string; razaoSocial: string };
    codigoServico: string;
    codigoReceita: string;
    sefaz: string;
    descricao: string;
    derivacao: 'proprio' | 'st' | 'difal';
    referencia: string;      // MM/AAAA
    valor: number;
    vencimento: string;      // AAAA-MM-DD
    portalUrl: string;
}

export interface DareInput {
    cnpj: string;
    razaoSocial: string;
    codigoServico: string;
    referencia: string;      // MM/AAAA ou AAAA-MM
    valor: number;
    vencimento: string;      // AAAA-MM-DD
    empresaId?: string;
}

async function getToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return u.getIdToken();
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; payload?: DarePayload; linhaTxt?: string | null; id?: string; error?: string }> {
    const token = await getToken();
    const res = await fetch(path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}

export const previewDare = (input: DareInput) => post('/api/admin/dare/preview', input);
export const registrarDare = (input: DareInput) => post('/api/admin/dare/registrar', input);
