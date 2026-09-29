export interface ConferenciaDataEntrada { ok: boolean; erros: string[]; dataEntrada: string; competencia: string; competenciaEmissao: string; mudaCompetencia: boolean }
export function dataEntradaDoDocumento(d: unknown): string;
export function competenciaDeEscrituracao(args: { direcao?: string; dhEmi?: unknown; dataEntrada?: unknown }): string;
export function conferirDataEntrada(args: { direcao?: string; dhEmi?: unknown; dataEntrada?: unknown }): ConferenciaDataEntrada;
export function patchDataEntrada(args: { doc: unknown; dataEntrada?: unknown; autor?: { email?: string; uid?: string } }): { ok: boolean; motivo?: string; patch: Record<string, string> | null; conf: ConferenciaDataEntrada };
export function brDe(iso: unknown): string;
