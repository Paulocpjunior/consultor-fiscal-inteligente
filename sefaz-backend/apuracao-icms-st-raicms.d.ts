export interface LinhaDemonstrativoSt {
    codigo: string; historico: string; soma: number; secao?: string;
    itens: Array<{ codigo: string; historico: string; valor: number }>;
}
export interface SaidaStCfop { cfop: string; notas: number; vlCont: number; bcSt: number; icmsSt: number; fcpSt: number }
export interface RaicmsStUf {
    uf: string;
    saidas: SaidaStCfop[];
    totalSaidas: { vlCont: number; bcSt: number; icmsSt: number; fcpSt: number };
    demonstrativo: LinhaDemonstrativoSt[];
    devedor: boolean;
    impostoARecolher: number;
    saldoCredorATransportar: number;
    debitosEspeciais: number;
    obrigacoes: Array<{ codOr: string; valor: number; vencimento: string; codRec: string; mesRef: string }>;
    avisos: string[];
}
export function montarRaicmsSt(p: { linhas: Array<Array<string | number>>; notas: unknown[] }): RaicmsStUf[];
