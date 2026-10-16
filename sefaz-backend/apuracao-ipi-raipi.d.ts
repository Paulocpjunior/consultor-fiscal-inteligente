export const CST_IPI_ISENTAS_NT: readonly string[];
export const FAMILIAS_CFOP_IPI: Readonly<Record<number, string>>;
export interface ColunasIpi { vlCont: number; bc: number; imposto: number; isentas: number; outras: number }
export interface LinhaCfopIpi extends ColunasIpi { cfop: string }
export interface FamiliaIpi { titulo: string; linhas: LinhaCfopIpi[]; subtotal: ColunasIpi }
export interface LadoRaipi { familias: FamiliaIpi[]; total: ColunasIpi }
export interface LinhaDemonstrativoIpi { codigo: string; secao?: string; historico: string; soma: number }
export interface Raipi {
    entradas: LadoRaipi;
    saidas: LadoRaipi;
    demonstrativo: LinhaDemonstrativoIpi[];
    devedor: boolean;
    impostoARecolher: number;
    saldoCredorATransportar: number;
    geraNoSped: boolean;
    avisos: string[];
}
export function colunasDoGrupoIpi(g: { cfop: string; cst: string; vlCont: number; vlBc: number; vlIpi: number }): ColunasIpi;
export function montarRaipi(ap: any): Raipi;
