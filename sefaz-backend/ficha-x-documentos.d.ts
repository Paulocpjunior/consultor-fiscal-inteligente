/**
 * Farol ficha × documentos — imposto digitado precisa de documento por trás.
 * Confere EXISTÊNCIA, não valor (valor é do E510). O `.d.ts` entra no mesmo
 * PR que o módulo — lição do deploy 487.
 */
export function conferirFichaContraDocumentos(p: {
    ipiFicha: number;
    /** null = a contagem FALHOU (não é zero!). */
    documentos: number | null | undefined;
}): {
    situacao: 'sem-ipi' | 'sem-documento' | 'com-lastro' | 'contagem-indisponivel';
    cor: 'ok' | 'atencao' | 'falha' | 'neutro';
    mensagem: string;
    acao: string | null;
};
