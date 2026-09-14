import type { AjustesClassificados } from './sped-ajustes-apuracao.js';

export interface ApuracaoE110 {
    vlTotDebitos: number; vlTotAjDebitos: number; vlEstornosCred: number;
    vlTotCreditos: number; vlTotAjCreditos: number; vlEstornosDeb: number;
    vlSldCredorAnt: number; vlSldApurado: number; vlTotDed: number;
    vlIcmsRecolher: number; vlSldCredorTransportar: number; vlDebEsp: number;
    deducaoExcedente: number;
}

export function apurarIcmsProprio(dados: any): {
    ap: ApuracaoE110; cls: AjustesClassificados; uf: string; regime: string;
};

export const HISTORICOS_RAICMS: Record<string, string>;

export function historicoDoAjuste(a: { descricao?: string; codigo?: string } | null | undefined): string;

export interface ItemRaicms { historico: string; codigo: string; valor: number }
export interface LinhaRaicms { codigo: string; historico: string; itens: ItemRaicms[]; soma: number }
export interface Raicms {
    linhas: LinhaRaicms[];
    devedor: boolean;
    impostoARecolher: number;
    saldoCredorATransportar: number;
    debitosEspeciais: number;
    origemSaldoAnterior: string;
    avisos: string[];
}

export function montarRaicms(
    apuracao: { ap: ApuracaoE110; cls: AjustesClassificados },
    extra?: { origemSaldoAnterior?: string },
): Raicms;
