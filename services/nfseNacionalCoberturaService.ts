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
    // Elegibilidade real por certificado A1 (independente da flag). false =
    // captura vai falhar mesmo com a flag ligada; motivoBloqueio explica o porquê.
    certOk?: boolean;
    motivoBloqueio?: string | null;
    alteradoPor: string | null;
    alteradoEm: string | null;
    state: { ultNSU: string | null; ultimaSync: string | null; maxNSU: string | null } | null;
}

export interface CoberturaResposta {
    total: number;
    ativas: number;
    inativas: number;
    comCaptura: number;
    // Enriquecidos pela elegibilidade por certificado:
    capturando?: number;        // flag ligada E cert ok
    ativasBloqueadas?: number;  // flag ligada mas cert falha (falta A1 etc.)
    prontasParaLigar?: number;  // cert ok mas flag desligada
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

// ─── Municipios (Caminho A: acelerar uso do Padrao Nacional) ─────────────

export interface MunicipioCobertura {
    uf: string;
    municipio: string;
    codMunIBGE: string;
    qtdEmpresas: number;
    qtdAdnAtivo: number;
    qtdComCcm: number;
    qtdComIe: number;
    qtdComNfse: number;
    totalNfse: number;
}

export interface MunicipiosResposta {
    total: number;
    totalAdn: number;
    percentualAdn: number;
    municipiosDistintos: number;
    municipios: MunicipioCobertura[];
}

export async function getMunicipiosCarteira(): Promise<MunicipiosResposta> {
    const headers = await authHeader();
    const res = await fetch('/api/admin/nfse-nacional-dfe/municipios', { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

export async function toggleAdnPorMunicipio(
    uf: string, municipio: string, ativo: boolean
): Promise<ToggleBulkResposta> {
    const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
    const res = await fetch('/api/admin/nfse-nacional-dfe/toggle-bulk-por-municipio', {
        method: 'POST', headers, body: JSON.stringify({ uf, municipio, ativo }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
