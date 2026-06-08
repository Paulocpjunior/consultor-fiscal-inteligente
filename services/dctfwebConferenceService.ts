/**
 * dctfwebConferenceService.ts — orquestra o cruzamento DCTFWeb × apuração.
 *
 * Busca a apuração MIT normalizada no backend e cruza contra o detalhamento
 * de impostos já calculado pelo app (lucroService.calcularLucro).
 *
 * Lógica pura fica em dctfwebConference.ts (testável). Aqui só I/O + auth.
 */

import { getAuth } from 'firebase/auth';
import type { DetalheImposto } from '../types';
import {
    extrairTributosApp,
    cruzarTributos,
    type ConferenciaResultado,
    type TributosPorFamilia,
} from './dctfwebConference';

/** Resposta do GET /mit/apuracao-normalizada. */
export interface MitNormalizadaResposta {
    competencia: string;
    lido: boolean;
    motivo: string | null;
    tributos: TributosPorFamilia;
    outros: { codigo: string | null; descricao: string; valor: number }[];
    totalReconhecido: number;
}

export interface ConferenciaCompleta {
    /** null quando a DCTFWeb MIT não pôde ser lida — NÃO cruzamos com zeros falsos. */
    resultado: ConferenciaResultado | null;
    mitLido: boolean;
    motivoMit: string | null;
    outrosDctfweb: { codigo: string | null; descricao: string; valor: number }[];
    tributosApp: TributosPorFamilia;
}

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

/**
 * Busca a apuração MIT normalizada da DCTFWeb pra uma competência.
 */
export async function getApuracaoMitNormalizada(
    empresaCnpj: string,
    competencia: string, // YYYY-MM
): Promise<MitNormalizadaResposta> {
    const [ano, mes] = competencia.split('-');
    const headers = await authHeader();
    const qs = new URLSearchParams({ empresaCnpj: empresaCnpj.replace(/\D/g, ''), anoPA: ano || '', mesPA: String(Number(mes || '0')) });
    const res = await fetch(`/api/admin/dctfweb/mit/apuracao-normalizada?${qs}`, { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

/**
 * Conferência completa: cruza o detalhamento do app (já calculado) contra a
 * DCTFWeb MIT. Se a MIT não pôde ser lida, retorna resultado=null + motivo
 * (UI mostra "DCTFWeb não pôde ser lida" em vez de divergência falsa).
 *
 * @param empresaCnpj  CNPJ da empresa
 * @param competencia  YYYY-MM
 * @param detalhamentoApp  LucroResult.detalhamento (de calcularLucro)
 */
export async function conferirDctfweb(
    empresaCnpj: string,
    competencia: string,
    detalhamentoApp: DetalheImposto[],
): Promise<ConferenciaCompleta> {
    const tributosApp = extrairTributosApp(detalhamentoApp);
    const mit = await getApuracaoMitNormalizada(empresaCnpj, competencia);

    if (!mit.lido) {
        return {
            resultado: null,
            mitLido: false,
            motivoMit: mit.motivo,
            outrosDctfweb: mit.outros || [],
            tributosApp,
        };
    }

    const resultado = cruzarTributos(tributosApp, mit.tributos, competencia);
    return {
        resultado,
        mitLido: true,
        motivoMit: null,
        outrosDctfweb: mit.outros || [],
        tributosApp,
    };
}
