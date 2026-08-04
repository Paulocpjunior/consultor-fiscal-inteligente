export function normalizarCodCliente(
    bruto: unknown,
): { ok: true; valor: string } | { ok: false; erro: string };
export function codClienteValido(v: unknown): boolean;
export function schemaDoCodCliente(v: unknown): string | null;
