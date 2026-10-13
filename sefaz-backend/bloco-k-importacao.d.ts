export const REGISTROS_IMPORTADOS: string[];
export function dataSpedParaIso(v: unknown): string;
export function numeroSped(v: unknown): number | '';
export interface BlocoKImportado {
    ok: true;
    cnpj: string;
    competencia: string;
    estoques: Array<{ codItem: string; qtd: number | ''; indEst: string; codPart: string }>;
    movimentacoes: Array<{ dtMov: string; codItemOri: string; codItemDest: string; qtdOri: number | ''; qtdDest: number | '' }>;
    producao: Array<{
        dtIniOp: string; dtFinOp: string; codDocOp: string; codItem: string; qtdEnc: number | '';
        insumos: Array<{ dtSaida: string; codItem: string; qtd: number | ''; codInsSubst: string }>;
    }>;
    naoImportados: Record<string, number>;
    avisos: string[];
}
export function lerBlocoKDoSped(
    texto: string,
    alvo?: { cnpjEmpresa?: string; competencia?: string },
): BlocoKImportado | { ok: false; erro: string };
