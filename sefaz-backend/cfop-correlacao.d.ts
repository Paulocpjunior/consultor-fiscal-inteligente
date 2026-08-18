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

export function resolverNaturezaAtividade(dadosFiscais: unknown): {
    natureza: 'comercio' | 'industria' | 'servicos' | 'misto';
    origem: 'cadastro' | 'indicador' | 'padrao';
};

/**
 * As famílias de sufixo que a régua trata de forma especial.
 *
 * Exportadas porque a tela de conferência PRECISA delas para explicar o motivo
 * de cada linha — e copiá-las era a segunda régua. Ver `services/cfopConferencia.ts`.
 */
export const SUFIXOS_COMPRA_PRODUTO: string[];
export const SUFIXOS_ST_VENDA: string[];
/**
 * Transferência recebida (151/152/154) — o sufixo muda de significado ao
 * atravessar a operação, igual a 101/102: na saída descreve a ORIGEM de quem
 * envia, na entrada o DESTINO de quem recebe. 153 (energia elétrica) fica fora.
 */
export const SUFIXOS_TRANSFERENCIA_RECEBIDA: string[];

/**
 * O CFOP que vai para o LANÇAMENTO, com o documento na mão.
 * Precedência: `doc.cfopEscriturado` (por NF) > `ctx.cfopOverrides` (empresa)
 * > `correlacionarCfop` (régua automática).
 */
export function cfopDoLancamento(
    doc: any,
    cfopDoItem: string | undefined,
    direcao: DirecaoCfop,
    ctx?: CorrelacaoCtx,
): string;

/** De onde veio o CFOP do lançamento — número sem origem não se confere. */
export function origemDoCfopLancamento(
    doc: any,
    cfopDoItem: string | undefined,
    direcao: DirecaoCfop,
    ctx?: CorrelacaoCtx,
): { origem: 'nota' | 'empresa' | 'regra'; rotulo: string; por: string | null; em: string | null };

/** Os CFOPs distintos que a nota teria SEM o override — o que o carimbo colapsa. */
export function cfopsDistintosDaNota(doc: any, direcao: DirecaoCfop, ctx?: CorrelacaoCtx): string[];

/** O CFOP digitado é válido para a DIREÇÃO da nota? Vazio devolve à régua. */
export function validarCfopEscriturado(
    cfop: unknown, direcao: DirecaoCfop,
): { ok: true; cfop: string; motivo?: string } | { ok: false; motivo: string };
