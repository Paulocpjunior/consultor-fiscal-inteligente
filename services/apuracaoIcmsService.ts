/**
 * 📒 Registro de Apuração do ICMS (RAICMS) — leitura da rota
 * `/api/admin/sped-fiscal/apuracao-icms`.
 *
 * 14/09, Paulo, HYPE CAFÉ: *"crie um relatório conforme modelo acima … ou eu
 * tenho que gerar o SPED para conferir o valor do ICMS a pagar ou credor"*.
 *
 * ⚠️ A tela NÃO calcula nada: as 14 linhas, os itens da coluna auxiliar e o
 * imposto a recolher vêm do dono (`sefaz-backend/apuracao-icms-raicms.js`),
 * que é o MESMO que escreve o E110. Relatório nunca tem conta própria.
 */
import { getAuth } from 'firebase/auth';
import type { Raicms } from '../sefaz-backend/apuracao-icms-raicms.js';

export interface IdentificacaoDaApuracao {
    respLegalNome?: string | null; respLegalCpf?: string | null; respLegalCargo?: string | null;
    responsaveisLegais?: Array<{ nome?: string | null; cpf?: string | null; cargo?: string | null }> | null;
    contadorNome?: string | null; contadorCrc?: string | null; contadorCpf?: string | null;
}

export interface ApuracaoIcmsResposta extends Raicms {
    ok: boolean;
    error?: string;
    empresaId: string;
    empresaNome: string;
    cnpj: string;
    inscricaoEstadual: string;
    uf: string;
    competenciaInicio: string;
    competenciaFim: string;
    periodicidade: 'Mensal' | 'Trimestral';
    documentosLidos: number;
    identificacao: IdentificacaoDaApuracao;
    avisosDaColeta: string[];
}

export async function carregarApuracaoIcms(empresaId: string, competencia: string): Promise<ApuracaoIcmsResposta> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' } as any;
    const token = await u.getIdToken();
    const res = await fetch(
        `/api/admin/sped-fiscal/apuracao-icms?empresaId=${encodeURIComponent(empresaId)}&competencia=${encodeURIComponent(competencia)}`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` } as any;
    return data;
}
