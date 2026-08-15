/**
 * Resolução do modelo Gemini — pina na família alvo PERGUNTANDO à conta.
 * O `.d.ts` entra no mesmo PR que o módulo — lição do deploy 487.
 */
export const FAMILIA_ALVO_GEMINI: string;
export const ALIAS_PRO: string;
export const ALIAS_FLASH: string;

export function normalizarNomeModelo(nome: string | null | undefined): string;

export function escolherModeloDaFamilia(
    modelos: Array<any> | null | undefined,
    alvo: { familia: string; tipo: 'pro' | 'flash' },
): { modelo: string | null; candidatos: string[]; motivo: string };

export interface ModeloResolvido {
    modelo: string;
    /** 'env' = pino humano · 'familia-alvo' = a API listou · 'alias-*' = rede de baixo. */
    origem: 'env' | 'familia-alvo' | 'alias-fallback' | 'alias-sem-lista' | 'inicial';
    motivo: string;
    candidatos?: string[];
}

export function resolverModelosGemini(p?: {
    /** null/[] = não foi possível perguntar; NUNCA vira ID inventado. */
    modelos?: Array<any> | null;
    envPro?: string;
    envFlash?: string;
    familia?: string;
}): {
    familiaAlvo: string;
    pro: ModeloResolvido;
    flash: ModeloResolvido;
    alvoEncontrado: boolean;
};

/** `null` quando a sonda não respondeu — não é "está atrasado". */
export function versaoAtendeAlvo(
    modelVersion: string | null | undefined,
    familia?: string,
): boolean | null;
