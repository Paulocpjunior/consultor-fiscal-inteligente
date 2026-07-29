/**
 * Tipos do módulo puro `cfop-correlacao.js` — permite que o FRONT use a MESMA
 * regra de correlação do backend, sem copiar lógica fiscal (duas cópias da
 * mesma conta é a origem de metade das divergências que já corrigimos).
 */
export type DirecaoCfop = 'entrada' | 'saida';

export interface CorrelacaoCtx {
    /** 'comercio' | 'industria' | 'servicos' | 'misto' */
    naturezaAtividade?: string | null;
    /** Overrides manuais por CFOP de origem. Sempre vencem. */
    cfopOverrides?: Record<string, string> | null;
}

/**
 * CFOP para ESCRITURAR. Na entrada, converte o CFOP do emitente (5/6/7) no
 * correspondente de entrada (1/2/3). Na saída, devolve o original.
 */
export function correlacionarCfop(
    cfopOrigem: string | null | undefined,
    direcao: DirecaoCfop | string,
    ctx?: CorrelacaoCtx,
): string;

/** Deriva a natureza da atividade a partir do cadastro da empresa. */
export function derivarNaturezaAtividade(empresa: unknown): string | null;
