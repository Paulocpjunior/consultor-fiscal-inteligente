/**
 * toastTone.ts — o tom do toast sai da MENSAGEM.
 *
 * O componente era verde com ✓ sempre, então "Falha na análise: IA
 * indisponível…" chegava na colaboradora com cara de sucesso (print do
 * Paulo, 20/08). Farol honesto vale pro toast também: falha é vermelha.
 * Portado da Legalização (v1.0.34) a pedido do Paulo — mesmo defeito aqui.
 *
 * Classificar pelo texto (em vez de mudar as ~40 chamadas de onShowToast)
 * conserta todas as telas de uma vez e nunca fica pela metade quando
 * alguém adicionar uma chamada nova.
 */
export type TomToast = 'erro' | 'alerta' | 'sucesso';

// Radicais (não palavras inteiras): "inválid" cobre inválido/inválida/inválidos.
// Um teste de invariante garante que TODA saída de getFriendlyErrorMessage
// caia aqui — foi assim que se descobriu que "Os créditos da IA acabaram"
// sairia VERDE, que é exatamente o defeito que esta lista existe pra impedir.
const ERRO = [
    'falha', 'falhou', 'falharam', 'erro', 'não deu', 'nao deu', 'não consegui', 'nao consegui',
    'indisponível', 'indisponivel', 'inválid', 'invalid', 'negado', 'expirada', 'recusad',
    'sem resposta', 'sem permissão', 'sem permissao', 'não foi possível', 'nao foi possivel',
    'acabaram', 'excedido', 'excedida', 'bloquead', 'não foi configurad', 'nao foi configurad',
];
const ALERTA = ['⚠️', 'atenção', 'atencao', 'pausado', 'pausada', 'nenhum', 'parcial', 'pendente'];

export function tomDoToast(mensagem: string): TomToast {
    const m = String(mensagem || '').toLowerCase();
    if (ERRO.some(t => m.includes(t))) return 'erro';
    if (ALERTA.some(t => m.includes(t))) return 'alerta';
    return 'sucesso';
}

/** Erro fica MUITO mais tempo: o texto é longo e traz a ação a tomar. */
export function duracaoDoToast(tom: TomToast): number {
    if (tom === 'erro') return 15000;
    if (tom === 'alerta') return 8000;
    return 3500;
}

export const TOM_META: Record<TomToast, { emoji: string; corBorda: string; corFundo: string; rotulo: string }> = {
    erro: { emoji: '⛔', corBorda: '#DC2626', corFundo: 'rgba(220,38,38,0.12)', rotulo: 'Erro' },
    alerta: { emoji: '⚠️', corBorda: '#D97706', corFundo: 'rgba(217,119,6,0.12)', rotulo: 'Atenção' },
    sucesso: { emoji: '✓', corBorda: '#16A34A', corFundo: 'rgba(22,163,74,0.12)', rotulo: 'Pronto' },
};
