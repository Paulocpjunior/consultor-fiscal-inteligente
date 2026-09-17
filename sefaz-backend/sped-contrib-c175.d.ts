/**
 * C175 — Registro Analítico da NFC-e (COD_MOD 65) no EFD-Contribuições.
 * Consolidação por CFOP + CST + alíquotas (Guia Prático 1.35, Registro C175).
 */
export const CST_PISCOFINS_COM_INCIDENCIA: readonly string[];
export function cstComIncidenciaNaSaida(cst: string | number | null | undefined): boolean;

export interface ItemParaC175 {
    cfop: string;
    vlItem: number;
    desconto: number;
    icms: number;
    /** Frete cobrado do adquirente: ACRESCE a base, nunca o VL_OPR. */
    frete?: number;
    cstPis: string;
    cstCofins: string;
    aliqPis: number;
    aliqCofins: number;
}

export interface RegistroC175 {
    cfop: string;
    vlOpr: number;
    vlDesc: number;
    cstPis: string;
    vlBcPis: number;
    aliqPis: number;
    vlPis: number;
    cstCofins: string;
    vlBcCofins: number;
    aliqCofins: number;
    vlCofins: number;
}

export function consolidarC175(itens: ItemParaC175[]): { registros: RegistroC175[]; avisos: string[] };
export function camposDoC175(r: RegistroC175, formatValue: (v: number, dec?: number) => string): string[];
