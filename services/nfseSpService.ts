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
