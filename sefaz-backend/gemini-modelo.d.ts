/**
 * Resolução do modelo Gemini — pina na família alvo PERGUNTANDO à conta.
 * O `.d.ts` entra no mesmo PR que o módulo — lição do deploy 487.
 */
export const FAMILIA_ALVO_GEMINI: string;
export const ALIAS_PRO: string;
export const ALIAS_FLASH: string;

export function normalizarNomeModelo(nome: string | null | undefined): string;

/** `gemini-3.8-flash` → 3.8 · sem versão no nome → null. */
export function versaoDoModelo(nome: string | null | undefined): number | null;

export function escolherModeloDaFamilia(
    modelos: Array<any> | null | undefined,
    alvo: { familia: string; tipo: 'pro' | 'flash' },
): {
    modelo: string | null; candidatos: string[]; motivo: string;
    versao: number | null;
    /** A linha chegou na família alvo? Pro e Flash não andam no mesmo número. */
    atingiuPiso: boolean;
};

export interface ModeloResolvido {
    modelo: string;
    /** 'env' = pino humano · 'familia-alvo' = a API listou · 'alias-*' = rede de baixo. */
    origem: 'env' | 'familia-alvo' | 'alias-fallback' | 'alias-sem-lista' | 'inicial';
    motivo: string;
    candidatos?: string[];
    versao?: number | null;
    atingiuPiso?: boolean;
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

/** "Estamos na família alvo?" — respondido pela SONDA, não pela listagem. */
export function vereditoDaFamilia(
    sondas: Array<{ modelo?: string; modelVersion: string | null; naFamiliaAlvo: boolean | null }>,
    listada: boolean,
    familia?: string,
    /** Sem isto, linha abaixo da família vira ⚠ mesmo sem ação possível. */
    atualizacao?: { situacao: 'atual' | 'atrasado' | 'indeterminado' } | null,
): {
    situacao: 'atendida' | 'fora' | 'parcial' | 'no-teto-da-conta' | 'indeterminado';
    cor: 'ok' | 'atencao' | 'neutro'; texto: string;
};

/** Qual BUILD está atendendo — `-preview` aparece nomeado, nunca escondido. */
export function conferirEstabilidade(
    sondas: Array<{ modelo?: string; modelVersion?: string | null }>,
): { instavel: boolean; modelos: string[]; cor: 'ok' | 'neutro'; texto: string | null };

/**
 * PRO e FLASH apontando pro mesmo modelo = roteador sem efeito.
 * NÃO é alarme desde 16/08 (decisão do Paulo: seguir no Flash) — é informação.
 */
export function conferirRoteador(p: {
    pro?: { modelo?: string } | string | null;
    flash?: { modelo?: string } | string | null;
}): { ok: boolean; colidiu: boolean; cor: 'ok' | 'neutro'; aviso: string | null };

export function linhaDoModelo(nome: unknown): 'flash' | 'pro' | null;

/** A condição do Paulo virou régua: *"desde que seja a última versão"*. */
export function conferirAtualizacao(
    sondas: Array<{ modelo?: string; modelVersion: string | null }>,
    modelos: unknown[] | null,
    familia?: string,
): {
    situacao: 'atual' | 'atrasado' | 'indeterminado';
    cor: 'ok' | 'erro' | 'neutro';
    texto: string;
    linhas: Array<{
        linha: 'flash' | 'pro';
        situacao: 'atual' | 'atrasado' | 'indeterminado';
        atual: string; maisNovo: string | null;
    }>;
};
