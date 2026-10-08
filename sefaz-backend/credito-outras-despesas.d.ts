export const MIN_MOTIVO_CREDITO: number;
export const CST_IPI_ENTRADA_COM_CREDITO: string;
export interface LinhaCreditoOutras { indice: number; ipi: number; st: number }
export function validarAjusteCreditoOutras(
    doc: any,
    ajuste: { itens: Array<{ indice: number; ipi?: number; st?: number }>; motivo: string },
): { ok: true; ajuste: { itens: LinhaCreditoOutras[]; motivo: string; total: number } } | { ok: false; erros: string[] };
export function aplicarCreditoOutrasDespesas<T = any>(doc: T): T;
export function sugereCreditoEmOutrasDespesas(doc: any): boolean;
