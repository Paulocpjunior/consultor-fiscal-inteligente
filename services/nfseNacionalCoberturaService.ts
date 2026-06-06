/**
 * Serviço de cobertura NFS-e Nacional (ADN — Ambiente de Dados Nacional).
 *
 * A captura ADN só percorre empresas com nfseNacionalDfeAtivo=true (default
 * false). Resultado: a maioria dos clientes não está sendo capturada
 * nacionalmente. Este serviço expõe quem está/não está, e permite habilitar
 * em massa pra resolver o gargalo de uma vez.
 */

import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

export interface EmpresaCobertura {
    id: string;
    cnpj: string;
    nome: string;
    fonte: 'simples' | 'lucro';
    ativo: boolean;
    alteradoPor: string | null;
    alteradoEm: string | null;
    state: { ultNSU: string | null; ultimaSync: string | null; maxNSU: string | null } | null;
}

export interface CoberturaResposta {
    total: number;
    ativas: number;
    inativas: number;
    comCaptura: number;
    percentualAtivas: number;
    percentualCaptura: number;
    empresas: EmpresaCobertura[];
}

export interface ToggleBulkResposta {
    ativo: boolean;
    total: number;
    atualizados: number;
    naoEncontrados: number;
    falhas: number;
}

export async function getCoberturaAdn(): Promise<CoberturaResposta> {
    const headers = await authHeader();
    const res = await fetch('/api/admin/nfse-nacional-dfe/cobertura', { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

export async function toggleAdnEmpresa(cnpj: string, ativo: boolean): Promise<void> {
    const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
    const res = await fetch(`/api/admin/nfse-nacional-dfe/toggle/${cnpj.replace(/\D/g, '')}`, {
        method: 'POST', headers, body: JSON.stringify({ ativo }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
}

export async function toggleAdnBulk(cnpjs: string[], ativo: boolean): Promise<ToggleBulkResposta> {
    const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
    const res = await fetch('/api/admin/nfse-nacional-dfe/toggle-bulk', {
        method: 'POST', headers, body: JSON.stringify({ cnpjs, ativo }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
