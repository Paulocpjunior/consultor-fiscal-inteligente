export const DEPARTAMENTO_DP: string;
export const LIMITE_ANEXOS_BYTES: number;
export interface AnexoEmailDp { name: string; contentType: string; contentBytes: string; bytes: number }
export type PedidoEmailDp =
    | { ok: false; status: number; error: string }
    | { ok: true; para: string[]; assunto: string; mensagem: string; titulo: string; empresaNome: string; competencia: string; anexos: AnexoEmailDp[] };
export function validarPedidoEmailDp(body: unknown): PedidoEmailDp;
export function montarEmailPacoteDp(p: { titulo: string; empresaNome?: string; competencia?: string; mensagem: string; anexos?: Array<{ name: string }>; geradoEm?: string }): string;
