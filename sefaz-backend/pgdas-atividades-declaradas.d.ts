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
/**
 * Resposta crua com os textos longos trocados pelo TAMANHO — pra quando a
 * declaração não tem atividade nenhuma (sem movimento) e é a ESTRUTURA que
 * interessa, não o PDF em base64 que vem junto.
 */
export function podarBrutoDeclaracao(
    valor: unknown, profundidade?: number, limite?: number,
): unknown;
export interface LeituraConsultaAtividades {
    situacao: 'sem-declaracao' | 'sem-atividade-com-mensagem' | 'sem-atividade';
    mensagemDaReceita: Array<{ codigo: string | null; texto: string }>;
    titulo: string;
    explicacao: string;
    acao: string;
}
/** O que a Receita DISSE quando a consulta não trouxe atividade. */
export function interpretarConsultaAtividades(resposta: unknown): LeituraConsultaAtividades;
export const IDS_ATIVIDADE_CONHECIDOS: number[];
export const ROTULO_ATIVIDADE_CONHECIDA: Record<number, string>;
