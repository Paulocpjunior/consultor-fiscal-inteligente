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

export interface CodigoDareIcms {
    codigoServico: string;
    codigoReceita: string;
    sefaz: string;
    descricao: string;
    derivacao: 'proprio' | 'st' | 'difal';
    regimes: string[];
}

/**
 * Códigos de serviço do DARE-SP — FONTE ÚNICA no backend (`CODIGOS_DARE_ICMS`).
 * A tela mantinha uma lista própria com 2 opções e o código do DIFAL do
 * Simples (04602) existia no backend sem aparecer pra ninguém: a apuração
 * mostrava o valor e não havia como gerar a guia (04/08). Lista duplicada
 * diverge — aqui ela vem de lá.
 */
export async function listarCodigosDare(regime?: string): Promise<CodigoDareIcms[]> {
    const token = await getToken();
    const qs = regime ? `?regime=${encodeURIComponent(regime)}` : '';
    const res = await fetch(`/api/admin/dare/codigos${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const j = await res.json().catch(() => ({}));
    return Array.isArray(j.codigos) ? j.codigos : [];
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

export interface ComprovanteDare {
    numeroControle: number | null;
    codigoBarra44: string | null;
    codigoBarra48: string | null;
    pixCopiaCola: string | null;
    valorTotal: number | null;
    valorJuros: number | null;
    valorMulta: number | null;
    temPdf: boolean;
}

export interface EmissaoApiResultado {
    ok: boolean;
    id?: string;
    ambiente?: AmbienteDare;
    /** Número, código de barras e Pix — tudo emitido pela SEFAZ. */
    comprovante?: ComprovanteDare;
    /** Caminho do PDF no Storage (o documento que vai ao cliente). */
    pdfPath?: string | null;
    /** PDF em base64 — segue pro rito de envio (cópia na pasta IMPOSTOS). */
    pdfBase64?: string | null;
    retorno?: any;
    error?: string;
    camposInvalidos?: string[] | null;
    /** HTTP 428: produção pede confirmação explícita. */
    precisaConfirmar?: boolean;
    /**
     * HTTP 504: a rede caiu no meio da emissão. NÃO significa que falhou — a
     * guia pode ter sido criada na SEFAZ. Conferir antes de emitir de novo.
     */
    indeterminado?: boolean;
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
            indeterminado: res.status === 504 || data.indeterminado === true,
        };
    }
    return { ...data, ok: true };
}
