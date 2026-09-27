import type { XsdDere } from './dere';
import type { BalanceteLido, ContaPgcc, ContaForaDoPgcc } from './dere-insumo-contabil';

export const XSD_D1101: XsdDere;

export interface InsumoD1101 {
    cnpj: string;
    perApur: string;
    balancete: BalanceteLido;
    contasPgcc: ContaPgcc[];
    foraDoPgcc?: ContaForaDoPgcc[];
    freqEncerr: string;
    hoje?: Date;
}

export interface ResumoD1101 {
    evento: 'D-1101';
    xsd: string;
    namespace: string;
    tpAmb: string;
    tpOper: string;
    nrInsc: string;
    perApur: string;
    freqEncerr: string;
    contas: number;
    sinteticasFora: number;
    foraDoPgcc: number;
    comCodTrib: number;
    semCodTrib: number;
    competenciaDoTitulo: string | null;
}

export interface EventoD1101 {
    ok: boolean;
    xml: string | null;
    id: string | null;
    pendencias: string[];
    avisos: string[];
    resumo: ResumoD1101 | null;
}

export function formatarValorDere(valor: number): string | null;
export function validarInsumoD1101(insumo: InsumoD1101): { ok: boolean; pendencias: string[]; avisos: string[]; valores: unknown };
export function montarEventoD1101(
    insumo: InsumoD1101,
    opts?: { tpAmb?: 1 | 2 | '1' | '2'; tpOper?: 1 | '1'; data?: Date; sequencial?: number; verAplic?: string },
): EventoD1101;
