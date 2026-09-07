/**
 * Tipos de `cfop-parametros-store.js` — a leitura do 🧠 cérebro do CFOP pelo
 * backend. O `.d.ts` entra no MESMO PR que o módulo (lição de 20/08).
 */
import type { ParametroCfop } from './cfop-cerebro.js';

export const COLECAO_CFOP_PARAMETROS: 'cfop_parametros';

/** Só os parâmetros ativos (`ativo !== false`); lixo e nulos ficam fora. */
export function parametrosAtivos(docs: unknown[] | null | undefined): ParametroCfop[];

/** Lê os parâmetros de UMA empresa. Falha devolve lista vazia + `erro` NOMEADO. */
export function lerParametrosCfopDaEmpresa(
    db: unknown,
    empresaId: string | null | undefined,
): Promise<{ parametros: ParametroCfop[]; erro: string | null }>;

/** O aviso da geração quando a leitura falhou — `null` sem erro. */
export function avisoParametrosCfop(erro: string | null | undefined): string | null;
