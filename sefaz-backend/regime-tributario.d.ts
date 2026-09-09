/**
 * Tipos do dono do regime. ⚠️ Escritos À MÃO, então a regra de 20/08 vale:
 * export novo no `.js` entra AQUI no mesmo PR — `.d.ts` que promete o que o
 * `.js` não exporta compila feliz e estoura no primeiro clique em produção.
 */
export interface RegimeDescricao {
    rotulo: string;
    apuracao: boolean;
    ressalva?: string | null;
}

export const REGIMES: Record<string, RegimeDescricao>;
export const REGIMES_VALIDOS: string[];

export function normalizarRegime(bruto: unknown): string | null;

export interface RegimeDaEmpresaResposta {
    regime: string;
    /** 'cadastro' | 'regimePadrao' | 'colecao' — número derivado sai carimbado. */
    origem: string;
    apuracaoDefinida: boolean;
    motivo: string | null;
}

export function regimeDaEmpresa(empresa: unknown): RegimeDaEmpresaResposta;

export function rotuloRegime(regime: unknown): string;

export function semFinsLucrativos(empresa: unknown): boolean;

export function validarRegimeParaGravacao(
    bruto: unknown,
): { ok: boolean; regime?: string; motivo?: string };
