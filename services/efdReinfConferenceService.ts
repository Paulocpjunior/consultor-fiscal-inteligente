/**
 * efdReinfConferenceService.ts — orquestra o cruzamento EFD-Reinf × DCTFWeb.
 *
 * Espelha o dctfwebConferenceService: I/O + auth aqui; lógica pura no
 * efdReinfConference.ts (testável). Dois lados:
 *   - EFD-Reinf: POST /api/admin/efd-reinf/analisar (parseia os XMLs enviados)
 *   - DCTFWeb:   GET  /api/admin/dctfweb/retencao-normalizada (retenção real)
 * e cruza por família de retenção.
 *
 * Honesto: se a DCTFWeb não pôde ser lida (lido=false), retorna resultado=null
 * + motivo — a UI mostra "DCTFWeb não pôde ser lida" em vez de divergência falsa.
 */

import { getAuth } from 'firebase/auth';
import {
    extrairRetencoesReinf,
    cruzarRetencoes,
    type ConferenciaReinfResultado,
    type RetencoesPorFamilia,
} from './efdReinfConference';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

/** Resposta do POST /efd-reinf/analisar (campos usados aqui). */
export interface ReinfAnaliseResposta {
    qtd: number;
    eventos: Array<{
        ok: boolean; codigo: string | null; tipoRetorno: string;
        perApur: string; contribuinte: { tpInsc: string; nrInsc: string };
        totais: { inssRetPrinc: number; inssRetAdic: number; irrf: number; csll: number; pis: number; cofins: number };
        validacao: { valido: boolean; erros: string[]; avisos: string[] };
        observacoes: string[];
    }>;
    consolidacao: {
        competencia: string; contribuinte: string;
        totais: { inssRetPrinc: number; inssRetAdic: number; baseRet: number; bruto: number; irrf: number; csll: number; pis: number; cofins: number };
        retInssTotal: number; qtdEventos: number;
        fechamentos: Array<{ codigo: string; fechRet: string | null }>;
        alertas: string[];
    };
}

/** Resposta do GET /dctfweb/retencao-normalizada. */
export interface RetencaoDctfwebResposta {
    competencia: string;
    fonte?: string;
    lido: boolean;
    motivo: string | null;
    retencoes: RetencoesPorFamilia;
    camposUsados: { tag: string; familia: string; valor: number }[];
    totalReconhecido: number;
}

export interface ConferenciaReinfCompleta {
    /** null quando a DCTFWeb não pôde ser lida — NÃO cruzamos com zeros falsos. */
    resultado: ConferenciaReinfResultado | null;
    dctfwebLido: boolean;
    motivoDctfweb: string | null;
    retencoesReinf: RetencoesPorFamilia;
    consolidacaoReinf: ReinfAnaliseResposta['consolidacao'];
    eventos: ReinfAnaliseResposta['eventos'];
    camposUsadosDctfweb: { tag: string; familia: string; valor: number }[];
}

/** Parseia os XMLs de eventos EFD-Reinf no backend. */
export async function analisarReinf(xmls: string[]): Promise<ReinfAnaliseResposta> {
    const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
    const res = await fetch('/api/admin/efd-reinf/analisar', {
        method: 'POST', headers, body: JSON.stringify({ xmls }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

/** Busca a retenção consolidada (real) da DCTFWeb pra uma competência. */
export async function getRetencaoDctfweb(
    empresaCnpj: string,
    competencia: string, // YYYY-MM
): Promise<RetencaoDctfwebResposta> {
    const [ano, mes] = competencia.split('-');
    const headers = await authHeader();
    const qs = new URLSearchParams({ empresaCnpj: empresaCnpj.replace(/\D/g, ''), anoPA: ano, mesPA: String(Number(mes)) });
    const res = await fetch(`/api/admin/dctfweb/retencao-normalizada?${qs}`, { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

/**
 * Conferência completa: parseia os eventos EFD-Reinf, busca a retenção real da
 * DCTFWeb e cruza por família. A competência sai da consolidação dos eventos
 * (todos da mesma competência); o CNPJ é o do contribuinte.
 */
export async function conferirReinfDctfweb(
    xmls: string[],
    empresaCnpjOverride?: string,
): Promise<ConferenciaReinfCompleta> {
    const analise = await analisarReinf(xmls);
    const consolidacao = analise.consolidacao;
    const retencoesReinf = extrairRetencoesReinf(consolidacao.totais);

    const competencia = consolidacao.competencia;
    // CNPJ: override (empresa selecionada) ou base do contribuinte do evento.
    const cnpj = (empresaCnpjOverride || consolidacao.contribuinte || '').replace(/\D/g, '');

    if (!competencia || cnpj.length < 8) {
        return {
            resultado: null,
            dctfwebLido: false,
            motivoDctfweb: 'Sem competência/CNPJ válidos nos eventos para consultar a DCTFWeb.',
            retencoesReinf, consolidacaoReinf: consolidacao, eventos: analise.eventos,
            camposUsadosDctfweb: [],
        };
    }

    const dctfweb = await getRetencaoDctfweb(cnpj, competencia);
    if (!dctfweb.lido) {
        return {
            resultado: null,
            dctfwebLido: false,
            motivoDctfweb: dctfweb.motivo,
            retencoesReinf, consolidacaoReinf: consolidacao, eventos: analise.eventos,
            camposUsadosDctfweb: dctfweb.camposUsados || [],
        };
    }

    const resultado = cruzarRetencoes(retencoesReinf, dctfweb.retencoes, competencia);
    return {
        resultado,
        dctfwebLido: true,
        motivoDctfweb: null,
        retencoesReinf, consolidacaoReinf: consolidacao, eventos: analise.eventos,
        camposUsadosDctfweb: dctfweb.camposUsados || [],
    };
}
