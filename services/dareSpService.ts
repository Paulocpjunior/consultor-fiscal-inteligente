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

// ── Web API oficial da SEFAZ-SP (credenciamento 27/07/2026) ────────────────
// Emissão direta: o número e o código de barras continuam vindo da SEFAZ, mas
// chegam ao app em vez de o colaborador digitar no portal.

export type AmbienteDare = 'homologacao' | 'producao';

export interface ReceitasApiResultado {
    ok: boolean;
    ambiente?: AmbienteDare;
    rotulo?: string;
    receitas?: unknown;
    error?: string;
}

/**
 * Teste de fumaça da credencial: lista as receitas do ambiente. É GET e NÃO
 * emite guia nenhuma — serve para confirmar que a chave do Secret Manager
 * chega à SEFAZ antes de arriscar uma emissão.
 */
export async function receitasApiDare(ambiente: AmbienteDare = 'homologacao'): Promise<ReceitasApiResultado> {
    const token = await getToken();
    const res = await fetch(`/api/admin/dare/api/receitas?ambiente=${ambiente}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ...data, ok: true };
}

export interface EmissaoApiResultado {
    ok: boolean;
    id?: string;
    ambiente?: AmbienteDare;
    retorno?: any;
    error?: string;
    camposInvalidos?: string[] | null;
    /** HTTP 428: produção pede confirmação explícita. */
    precisaConfirmar?: boolean;
}

export async function emitirDarePelaApi(
    input: DareInput & { ambiente: AmbienteDare; linha06?: string; linha08?: string; confirmoProducao?: boolean },
): Promise<EmissaoApiResultado> {
    const token = await getToken();
    const res = await fetch('/api/admin/dare/api/emitir', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        return {
            ok: false,
            error: data.error || `HTTP ${res.status}`,
            camposInvalidos: data.camposInvalidos || null,
            precisaConfirmar: res.status === 428,
        };
    }
    return { ...data, ok: true };
}
