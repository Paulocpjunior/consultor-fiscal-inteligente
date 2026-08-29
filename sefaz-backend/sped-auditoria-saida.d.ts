/**
 * Auditoria do arquivo QUE ACABOU DE SAIR — pega a CLASSE do erro (coluna de
 * valor zerada em 100% das linhas, total que não bate, bloco que se diz cheio
 * e está vazio), nunca a instância. Não substitui o PVA.
 *
 * O `.d.ts` entra no mesmo PR que o módulo (convenção do projeto).
 */

/** Registros de DETALHE vigiados → posições (1-based, REG = 1) dos campos de valor. */
export const DETALHES_VIGIADOS: Record<string, {
    rotulo: string;
    campos: Record<number, string>;
}>;

/** Totalizadores cujo valor deve bater com a soma dos detalhes. */
export const TOTAIS_VIGIADOS: Record<string, {
    campoTotal: number;
    rotuloTotal: string;
    detalhe: string;
    campoDetalhe: number;
    rotuloDetalhe: string;
}>;

/** Campo posicional da linha do SPED (1-based; o REG é 1). */
export function campo(linha: string, pos: number): string;

/** '1.234,56' → 1234.56. Vazio devolve **null**: ausência não é zero. */
export function valorSped(txt: unknown): number | null;

export interface SuspeitaSped {
    registro: string;
    tipo: 'coluna-vazia' | 'coluna-toda-zerada' | 'total-ausente' | 'total-nao-bate'
        | 'bloco-vazio-declarado-cheio' | 'linha-malformada' | 'valor-negativo'
        | 'bloco9-nao-fecha' | 'contador-de-bloco-nao-fecha';
    gravidade: 'bloqueia' | 'atencao';
    detalhe: string;
}

/** @param linhas o arquivo gerado, **linha a linha** (não a string inteira). */
export function auditarSaidaSped(linhas: string[] | null | undefined): {
    suspeitas: SuspeitaSped[];
    ok: boolean;
};

/**
 * RÉGUA ÚNICA da FORMA da linha (`|REG|…|`) — usada por esta auditoria (que
 * roda no EFD ICMS/IPI **e** no EFD-Contribuições) e pela R15 da prevalidação.
 * Devolve no máximo 5 suspeitas + 1 resumo do que sobrou.
 */
export function linhasMalformadas(linhas: string[] | null | undefined): SuspeitaSped[];

/**
 * O BLOCO 9 fecha com o ARQUIVO (9900 × tipos, 9990 × bloco 9, 9999 × total).
 * Arquivo SEM 9999 devolve `[]` — recorte não é arquivo errado.
 */
export function conferirBloco9(linhas: string[] | null | undefined): SuspeitaSped[];

/**
 * Cada `X990` fecha com o próprio BLOCO — o contador que o `conferirBloco9`
 * não vê (um 9900 correto convive com um G990 errado). O 9990 fica de fora:
 * ele já tem dono, e dois alarmes para o mesmo defeito desligam os dois.
 */
export function conferirContadoresDeBloco(linhas: string[] | null | undefined): SuspeitaSped[];

/** Frase pra tela — nunca diz "tudo certo" quando a auditoria não rodou. */
export function resumoAuditoria(r: { ok: boolean; suspeitas: SuspeitaSped[] } | null | undefined): string;
