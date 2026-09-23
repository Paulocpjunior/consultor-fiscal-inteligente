/** Serviço do diagnóstico de cadastros incompletos. */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

export type GravidadeCadastro = 'ok' | 'medio' | 'alto' | 'critico';

export interface Pendencia {
    campo: string;
    descricao: string;
    impacto: string;
}

export interface EmpresaCadastro {
    id: string;
    cnpj: string;
    nome: string;
    regime: 'simples' | 'lucro';
    gravidade: GravidadeCadastro;
    pendencias: Pendencia[];
}

/** Uma CAUSA e quantas empresas a têm — a fila de trabalho de verdade. */
export interface PendenciaPorCampo {
    campo: string;
    descricao: string;
    impacto: string;
    qtd: number;
    /** Amostra (teto de 50); a contagem em `qtd` é inteira. */
    empresas: string[];
}

export interface DiagnosticoCadastrosResposta {
    resumo: { total: number; criticos: number; altos: number; medios: number; ok: number };
    /** Pendências agrupadas por campo, da mais frequente para a menos. */
    porCampo?: PendenciaPorCampo[];
    empresas: EmpresaCadastro[];
    geradoEm: string;
}

export async function getDiagnosticoCadastros(): Promise<DiagnosticoCadastrosResposta> {
    const headers = await authHeader();
    const res = await fetch('/api/admin/diagnostico-cadastros', { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
