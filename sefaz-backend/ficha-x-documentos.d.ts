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
    /**
     * A empresa captura por certificado **A3** (`tipoCert === 'A3'`), pelo
     * agente local `cfi-a3` — o cron em nuvem não a alcança. São 202 das 404
     * da carteira (medido em 23/08). Muda a CAUSA e a primeira parada, NÃO a
     * severidade: o agente escreve na mesma coleção, então zero documento ali
     * continua sendo lacuna.
     */
    capturaPorAgenteLocal?: boolean;
    /**
     * Receita da competência que NÃO GERA documento por natureza — hoje a
     * **locação** (a que vai ao F550). Sem isto a empresa de aluguel puro
     * acende "sem lastro" todo mês, sobre um número certo (caso AC MASON,
     * 27/08). Quem decide se a receita é INTEIRAMENTE de locação é o chamador.
     */
    receitaSemDocumento?: number;
}): {
    situacao: 'sem-valor' | 'sem-documento' | 'sem-documento-agente-local'
        | 'lastro-sem-documento' | 'com-lastro' | 'contagem-indisponivel';
    cor: 'ok' | 'atencao' | 'falha' | 'neutro';
    mensagem: string;
    acao: string | null;
};
