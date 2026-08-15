/**
 * Farol ficha × documentos — número digitado precisa de documento por trás.
 * Confere EXISTÊNCIA, não valor (valor é do E510). O `.d.ts` entra no mesmo
 * PR que o módulo — lição do deploy 487.
 */
export function conferirFichaContraDocumentos(p: {
    /** Valor apurado na ficha. 0/null = nada a cruzar ("sem movimento" é outro assunto). */
    valorApurado: number | null | undefined;
    /** null = a contagem FALHOU (não é zero!). */
    documentos: number | null | undefined;
    /** Como o número se chama na tela ('IPI', 'Imposto apurado', 'Receita lançada'). */
    rotulo?: string;
}): {
    situacao: 'sem-valor' | 'sem-documento' | 'com-lastro' | 'contagem-indisponivel';
    cor: 'ok' | 'atencao' | 'falha' | 'neutro';
    mensagem: string;
    acao: string | null;
};
