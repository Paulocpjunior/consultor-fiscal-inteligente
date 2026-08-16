// Tipos da sonda de chamada de voz/vídeo — o dono é o .js.
export interface SituacaoSonda {
    situacao: 'ligado' | 'desligado' | 'nao-declarado' | 'nao-reconhecido' | 'sem-permissao' | 'indeterminado';
    campo?: string;
    candidato?: string;
    motivo: string;
    acao?: string;
    bruto?: unknown;
}

export const CANDIDATOS_SONDA: {
    id: string; rotulo: string; caminho: (phoneNumberId: string) => string; hipotese: string;
}[];
export const ANTES_DE_LIGAR: { titulo: string; texto: string }[];

export function acharBlocoDeChamada(corpo: unknown): { caminho: string; valor: unknown }[];
export function interpretarSondaChamadas(status: number | null | undefined, corpo: unknown): SituacaoSonda;
export function concluirSonda(resultados?: SituacaoSonda[]): {
    veredito: SituacaoSonda['situacao'];
    motivo: string;
    acao?: string;
    respondeuPor?: string | null;
};
