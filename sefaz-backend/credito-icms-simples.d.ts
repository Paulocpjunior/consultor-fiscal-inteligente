export interface CreditoSimplesDoItem {
    tem: boolean; aplica: boolean; vBC: number; aliq: number; vICMS: number;
    por: 'informado' | 'xml' | null; motivo: string;
}
export const CSOSN: ReadonlySet<string>;
export const CSOSN_COM_ST: ReadonlySet<string>;
export const SUFIXOS_COMERCIALIZACAO_INDUSTRIALIZACAO: ReadonlySet<string>;
export function ehItemCsosn(item: unknown): boolean;
export function cfopDeComercializacaoOuIndustrializacao(cfop: unknown): boolean;
export function creditoSimplesDoItem(item: unknown, ctx?: { doc?: unknown; cfopLancado?: string }): CreditoSimplesDoItem;
export function cstDeEntradaDoCsosn(item: unknown, opts?: { creditoAplicado?: boolean }): string | null;
export function creditoSimplesDoTexto(texto: unknown): { aliq: number | null; valor: number | null } | null;
export function conferirAliquotaCreditoSimples(valor: unknown): { ok: boolean; aliq: number | null; motivo?: string };
export function avisosDoCreditoSimples(decisoes: Array<{ numero: string; r: CreditoSimplesDoItem; credita: boolean }>): string[];
