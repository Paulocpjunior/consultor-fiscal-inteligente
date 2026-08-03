export interface AtividadeDeclarada {
    idAtividade: number;
    valorAtividade: number;
    ocorrencias: number;
    qualificacoes: Array<{ codigoTributo: number | null; id: number | null }>;
}

export interface ResumoAtividadesDeclaradas {
    total: number;
    conhecidas: Array<AtividadeDeclarada & { rotulo: string | null }>;
    novas: AtividadeDeclarada[];
    temNova: boolean;
}

export function extrairAtividadesDeclaradas(resposta: unknown): AtividadeDeclarada[];
export function resumirAtividadesDeclaradas(
    atividades: AtividadeDeclarada[] | undefined | null,
): ResumoAtividadesDeclaradas;
export const IDS_ATIVIDADE_CONHECIDOS: number[];
export const ROTULO_ATIVIDADE_CONHECIDA: Record<number, string>;
