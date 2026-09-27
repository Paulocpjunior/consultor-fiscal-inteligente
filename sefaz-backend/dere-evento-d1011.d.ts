import type { XsdDere } from './dere';
import type { ContaPgcc } from './dere-insumo-contabil';

export const XSD_D1011: XsdDere;
export const PLANOS_REFERENCIAIS: readonly { codigo: 1 | 2 | 3 | 4 | 5; rotulo: string; tabela: string }[];
export const FREQUENCIAS_ENCERRAMENTO: readonly { codigo: 'A' | 'S' | 'Q' | 'T' | 'B' | 'M'; rotulo: string; mesesZero: number[] }[];
export const CCTAREF_REGRAS: readonly { codigo: 'coluna' | 'segmento-1'; rotulo: string }[];

export interface InsumoD1011 {
    cnpj: string;
    contas: ContaPgcc[];
    planoCtaRef: number | string;
    freqEncerr: string;
    iniValid: string;
    fimValid?: string | null;
    cCtaRefRegra?: 'coluna' | 'segmento-1';
}

export interface EventoCondicionalAcionado { codigo: string; nome: string; codTribs: string[] }

export interface ResumoD1011 {
    evento: 'D-1011';
    xsd: string;
    namespace: string;
    tpAmb: string;
    tpOper: string;
    nrInsc: string;
    planoCtaRef: number;
    planoCtaRefRotulo: string;
    freqEncerr: string;
    iniValid: string;
    fimValid: string | null;
    cCtaRefRegra: string;
    codTribs: string[];
    condicionais: EventoCondicionalAcionado[];
    contas: number;
    analiticas: number;
    ctaRefPorHipotese: number;
    semCodTrib: number;
    iniVigDoPgcc: number;
}

export interface EventoD1011 {
    ok: boolean;
    xml: string | null;
    id: string | null;
    pendencias: string[];
    avisos: string[];
    resumo: ResumoD1011 | null;
}

export function sugerirPlanoCtaRef(codigoD1001: number | null | undefined): { codigo: number | null; motivo: string };
export function eventosCondicionaisPorCodTrib(codTribs: string[]): EventoCondicionalAcionado[];
export function validarInsumoD1011(insumo: InsumoD1011): { ok: boolean; pendencias: string[]; avisos: string[]; valores: unknown };
export function montarEventoD1011(
    insumo: InsumoD1011,
    opts?: { tpAmb?: 1 | 2 | '1' | '2'; tpOper?: 1 | '1'; data?: Date; sequencial?: number; verAplic?: string },
): EventoD1011;
