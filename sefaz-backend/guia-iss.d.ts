export function ehTipoIss(tipo: unknown): boolean;
export function ehTipoIssRetido(tipo: unknown): boolean;
export function guiaIssDoEnvio(
    envio: { tipo?: unknown } | null | undefined,
    devido?: { aRecolher?: number; tomado?: number },
): 'retido' | 'proprio' | null;
