export function diaIsoDeVencimento(v: unknown): string;
export function decidirReaplicacao(p: { tarefa: any; regra: any | null }): {
    acao: 'alterar' | 'igual' | 'fechada' | 'manual' | 'sem-regra' | 'sem-data';
    de: string;
    para: string;
};
