import { getAuth } from 'firebase/auth';

const BASE = '/api/admin/sefaz';

async function authToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuário não autenticado');
    return u.getIdToken();
}

export interface NfseSpEmpresaElegivel {
    colecao: 'simples_empresas' | 'lucro_empresas';
    id: string;
    cnpj: string;
    nome: string;
    ccmSp: string;
    nfseSpAutorizadoEm: string;
}

export interface NfseSpPeriodo {
    dtInicio: { ano: number; mes: number };
    dtFim: { ano: number; mes: number };
}

export interface NfseSpResultadoEmpresa {
    empresaId: string;
    empresaNome: string;
    ccmSp: string;
    sucesso: boolean;
    statusCode?: number;
    totalNFes: number;
    criadas: number;
    atualizadas: number;
    erros: Array<{ codigo?: string; descricao?: string; erro?: string }>;
    alertas: Array<{ codigo?: string; descricao?: string }>;
    durationMs: number;
}

export interface NfseSpResultadoLote {
    executadoEm: string;
    tipo: string;
    dryRun: boolean;
    totalEmpresas: number;
    sucessos: number;
    falhas: number;
    totalNFes: number;
    criadas: number;
    atualizadas: number;
    durationMs: number;
    resultados: NfseSpResultadoEmpresa[];
}

export async function listarElegiveis(): Promise<{ total: number; empresas: NfseSpEmpresaElegivel[] }> {
    const token = await authToken();
    const r = await fetch(`${BASE}/nfsesp-elegiveis`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    return r.json();
}

export async function consultarUma(
    empresaId: string,
    colecao: 'simples_empresas' | 'lucro_empresas',
    periodo?: NfseSpPeriodo
): Promise<NfseSpResultadoEmpresa> {
    const token = await authToken();
    const r = await fetch(`${BASE}/nfsesp-consultar-uma`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId, colecao, periodo }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    return r.json();
}

export async function consultarTodas(dryRun = false): Promise<NfseSpResultadoLote> {
    const token = await authToken();
    const r = await fetch(`${BASE}/nfsesp-consultar-todas`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    return r.json();
}

// ─── Tipos para a consulta direta de NFS-e ──────────────────────────────────

export interface NfseSpItem {
    chave: string;
    inscricaoPrestador: string;
    numero: string;
    codigoVerificacao: string;

    cnpjPrestador: string;
    razaoSocialPrestador: string;
    emailPrestador: string;

    cnpjTomador: string;
    razaoSocialTomador: string;
    emailTomador: string;
    inscricaoMunicipalTomador: string;

    dhEmi: string;
    dataFatoGerador: string;
    competencia: string;
    cancelado: boolean;
    dataCancelamento: string;

    valorServicos: number | null;
    valorIss: number | null;
    valorPis: number | null;
    valorCofins: number | null;
    valorInss: number | null;
    valorIr: number | null;
    valorCsll: number | null;
    valorDeducoes: number | null;
    valorCredito: number | null;

    aliquotaServicos: number | null;
    codigoServico: string;
    issRetido: boolean;
    municipioPrestacao: string;
    discriminacao: string;
}

export interface NfseSpConsultaResult {
    sucesso: boolean;
    erros: Array<{ codigo?: string; descricao?: string }>;
    alertas: Array<{ codigo?: string; descricao?: string }>;
    totalNFes: number;
    nfes: NfseSpItem[];
}

export async function consultarNfseSp(params: {
    cnpj: string;
    inscricaoMunicipal: string;
    tipo: 'recebidas' | 'emitidas';
    mes: number;
    ano: number;
}): Promise<NfseSpConsultaResult> {
    const token = await authToken();
    const r = await fetch(`${BASE}/nfsesp-consultar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as any).erro || `HTTP ${r.status}`);
    }
    return r.json();
}
