/**
 * reconferirCancelamentoService — I/O da pergunta "esta nota foi cancelada?".
 *
 * A régua está no backend (`sefaz-backend/reconferir-cancelamento.js`); aqui só
 * tem fetch. Nenhuma leitura de resposta da SEFAZ acontece do lado do
 * navegador: duas leituras do mesmo retorno divergem sem ninguém ver.
 */
import { getAuth } from 'firebase/auth';

export interface ResultadoReconferencia {
    id: string;
    chave: string;
    numero: number | null;
    valorTotal: number;
    situacao: 'cancelada' | 'nao-cancelada' | 'indeterminado';
    motivo: string;
    cStat?: string;
}

export interface RespostaReconferencia {
    ok?: boolean;
    error?: string;
    simulado?: boolean;
    cnpj?: string;
    competencia?: string;
    selecao?: {
        aConsultar: number;
        total: number;
        cortadas: number;
        jaCanceladas: number;
        semChave: number;
        naoSaida: number;
    };
    resultados?: ResultadoReconferencia[];
    resumo?: {
        consultadas: number;
        canceladas: number;
        naoCanceladas: number;
        indeterminadas: number;
        valorRemovido: number;
        avisos: string[];
    };
    abortou656?: boolean;
}

export async function reconferirCancelamento(
    { cnpj, competencia, simular }: { cnpj: string; competencia: string; simular: boolean },
): Promise<RespostaReconferencia> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' };
    const token = await u.getIdToken();
    const res = await fetch('/api/admin/sefaz/reconferir-cancelamento', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj, competencia, simular }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}
