/**
 * Serviço do alerta de sublimite/teto do Simples.
 * Reusa lógica pura do backend (simples-sublimite-helper.js).
 */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

export type FaixaLimite = 'ok' | 'alerta' | 'critico' | 'ultrapassou';

export interface ClassificacaoLimite {
    limite: number;
    pct: number;
    faixa: FaixaLimite;
    restante: number;
}

export interface EmpresaSublimite {
    id: string;
    cnpj: string;
    nome: string;
    rbt12: number;
    mesesComDado: number;
    mesesSemDado: number;
    teto: ClassificacaoLimite;
    sublimite: ClassificacaoLimite;
    piorFaixa: FaixaLimite;
}

export interface SublimiteResposta {
    mesReferencia: string | null;
    limites: { teto: number; sublimite: number };
    resumo: {
        totalEmpresas: number;
        ultrapassouTeto: number;
        ultrapassouSublimite: number;
        criticosTeto: number;
        criticosSublimite: number;
        alertasTeto: number;
        alertasSublimite: number;
    };
    empresas: EmpresaSublimite[];
    geradoEm: string;
}

export async function getAlertaSublimite(mesReferencia?: string): Promise<SublimiteResposta> {
    const headers = await authHeader();
    const qs = mesReferencia ? `?mesReferencia=${encodeURIComponent(mesReferencia)}` : '';
    const res = await fetch(`/api/admin/simples-sublimite${qs}`, { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
