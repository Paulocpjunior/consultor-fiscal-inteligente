/**
 * 🏭 Livro de Apuração do IPI (modelo 8) — leitura da rota
 * `/api/admin/sped-fiscal/apuracao-ipi` (16/10, Paulo, modelo do e-Fiscal).
 *
 * ⚠️ A tela NÃO calcula nada: linhas por CFOP, demonstrativo 001–012 e saldo
 * vêm do dono (`apurarIpi` + `apuracao-ipi-raipi.js`), o MESMO do E510/E520.
 */
import { getAuth } from 'firebase/auth';
import type { Raipi } from '../sefaz-backend/apuracao-ipi-raipi.js';
import type { IdentificacaoDaApuracao } from './apuracaoIcmsService';

export interface ApuracaoIpiResposta extends Raipi {
    ok: boolean;
    error?: string;
    empresaId: string;
    empresaNome: string;
    cnpj: string;
    inscricaoEstadual: string;
    competencia: string;
    periodoEncerrado: boolean;
    documentosLidos: number;
    identificacao: IdentificacaoDaApuracao;
    avisosDaColeta: string[];
}

export async function carregarApuracaoIpi(empresaId: string, competencia: string): Promise<ApuracaoIpiResposta> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' } as ApuracaoIpiResposta;
    const token = await u.getIdToken();
    const res = await fetch(
        `/api/admin/sped-fiscal/apuracao-ipi?empresaId=${encodeURIComponent(empresaId)}&competencia=${encodeURIComponent(competencia)}`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` } as ApuracaoIpiResposta;
    return data;
}
