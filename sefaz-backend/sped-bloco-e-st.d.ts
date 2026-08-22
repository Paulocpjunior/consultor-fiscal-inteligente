export interface GrupoStUf {
    uf: string;
    retencao: number;
    documentos: number;
}

export interface ApuracaoStUf {
    uf: string;
    saldoCredorAnterior: number;
    devolucoes: number;
    ressarcimentos: number;
    outrosCreditos: number;
    ajCreditos: number;
    retencao: number;
    outrosDebitos: number;
    ajDebitos: number;
    saldoDevedorAnterior: number;
    /** Campo 11 do E210: saldo devedor ANTES das deduções (débitos − créditos, quando > 0). */
    saldoDevedorApurado: number;
    deducoes: number;
    /** Dedução lançada que NÃO coube no saldo devedor — vira aviso, nunca crédito. */
    deducoesExcedentes: number;
    icmsRecolher: number;
    saldoCredorTransportar: number;
    debitosEspeciais: number;
    documentos?: number;
}

/**
 * ⚠️ Devolve TAMBÉM o que ficou de fora: documento com ST retido e sem UF de
 * destino legível não entra na UF da empresa (cada UF é uma GNRE) — ele sai
 * NOMEADO em `semUf`, e o `montarLinhasStBlocoE` o transforma em aviso.
 */
export function agruparStPorUf(
    notas: unknown[],
    ufEmpresa?: string,
): { grupos: GrupoStUf[]; semUf: string[] };
export function apurarStDaUf(p: {
    uf: string;
    retencao: number;
    ajustes?: Record<string, number>;
    saldoCredorAnterior?: number;
    saldoDevedorAnterior?: number;
    devolucoes?: number;
    ressarcimentos?: number;
    outrosCreditos?: number;
    outrosDebitos?: number;
}): ApuracaoStUf;
export function montarLinhasStBlocoE(p: {
    notas: unknown[];
    ufEmpresa?: string;
    ajustes?: Array<{ codigo: string; descricao?: string; valor: number }>;
    dtIni: string;
    dtFin: string;
    obrigacoesPorUf?: Record<string, { dtVcto?: string; codRec?: string }>;
}): { linhas: string[][]; apuracoes: ApuracaoStUf[]; avisos: string[] };
