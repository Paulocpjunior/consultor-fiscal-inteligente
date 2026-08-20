/**
 * O "PVA de bolso" — as recusas do validador conferidas sobre o ARQUIVO, antes
 * de alguém abrir o PVA. Cada regra carrega a recusa literal como fonte.
 * O `.d.ts` entra no mesmo PR que o módulo (convenção do projeto).
 */

export interface ErroPrevalidacao {
    /** Slug da regra ('cod-mod-x-chave', '0150-orfao'…). */
    regra: string;
    /** Registro do leiaute onde o PVA acusaria (C100, E110, 0150…). */
    registro: string;
    /** Campo, numerado como o PVA numera (REG = 1). */
    campo: string;
    valor: string;
    esperado: string;
    /** A linha do arquivo, quando o erro é de uma linha específica. */
    linha: string;
    mensagem: string;
    /** O que fazer — alarme sem ação é alarme ignorado. */
    acao: string;
    /** A recusa LITERAL do PVA, com cliente e data. Regra sem fonte é chute. */
    fonte: string;
}

export interface ResultadoPrevalidacao {
    erros: ErroPrevalidacao[];
    avisos: ErroPrevalidacao[];
    resumo: string;
}

export function prevalidarSpedFiscal(
    linhas: string[] | null | undefined,
    ctx?: { contribuinteIpi?: string },
): ResultadoPrevalidacao;

/** Linhas prontas para os warnings da geração (com a ação em cada uma). */
export function resumoPrevalidacao(r: ResultadoPrevalidacao | null | undefined): string[];
