/**
 * 📕 Registro de Apuração do ICMS — Substituição Tributária, por UF — leitura
 * da rota `/api/admin/sped-fiscal/apuracao-icms-st` (17/10, Paulo, modelo do
 * e-Fiscal da REALITY).
 *
 * ⚠️ A tela NÃO calcula nada: saídas por CFOP, demonstrativo 001–014 e guias
 * vêm do dono (`montarLinhasStBlocoE` + `apuracao-icms-st-raicms.js`), o MESMO
 * do E200/E210/E220/E250 do SPED.
 */
import { getAuth } from 'firebase/auth';
import type { RaicmsStUf } from '../sefaz-backend/apuracao-icms-st-raicms.js';
import type { IdentificacaoDaApuracao } from './apuracaoIcmsService';

export interface ApuracaoIcmsStResposta {
    ok: boolean;
    error?: string;
    empresaId: string;
    empresaNome: string;
    cnpj: string;
    inscricaoEstadual: string;
    ufEmpresa: string;
    competencia: string;
    periodoEncerrado: boolean;
    documentosLidos: number;
    identificacao: IdentificacaoDaApuracao;
    ufs: RaicmsStUf[];
    avisos: string[];
    avisosDaColeta: string[];
}

export async function carregarApuracaoIcmsSt(empresaId: string, competencia: string): Promise<ApuracaoIcmsStResposta> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' } as ApuracaoIcmsStResposta;
    const token = await u.getIdToken();
    const res = await fetch(
        `/api/admin/sped-fiscal/apuracao-icms-st?empresaId=${encodeURIComponent(empresaId)}&competencia=${encodeURIComponent(competencia)}`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` } as ApuracaoIcmsStResposta;
    return data;
}
