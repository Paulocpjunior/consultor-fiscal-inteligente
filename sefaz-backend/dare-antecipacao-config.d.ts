export const CODIGOS_JA_USADOS: string[];
export const AMBIENTES_ACEITOS: string[];

export function validarCodigoAntecipacao(
    codigo: unknown,
    ctx?: { receitasSefaz?: unknown[] },
): { ok: true; codigo: string } | { ok: false; erro: string };

export interface ServicoDareExtra {
    codigoServico: string;
    codigoReceita: string | null;
    sefaz: string | null;
    descricao: string;
    derivacao: string;
    regimes: string[];
}

export function servicoAntecipacao(cfg: unknown): ServicoDareExtra | null;
export function lerCodigoAntecipacao(db: unknown): Promise<any | null>;
export function gravarCodigoAntecipacao(db: unknown, p: {
    codigo: string; codigoReceita?: string | null; sefaz?: string | null;
    ambiente?: string | null; usuario?: string | null;
}): Promise<any>;
