/**
 * O nome do arquivo do SPED diz QUAL geração ele é (PWR, 25/08 — quatro dias
 * conferindo o arquivo errado porque todas as gerações tinham o mesmo nome).
 * O `.d.ts` entra no MESMO PR que o módulo — lição do deploy 634.
 */

/** Deslocamento de Brasília, em minutos (fixo desde 2019). */
export const OFFSET_BRASILIA_MIN: number;

/** `AAAAMMDD-HHMM` no fuso de Brasília; '' quando o instante é ilegível. */
export function carimboDaGeracao(agoraMs?: number): string;

/** `SPED_CONTRIB_<cnpj>_<periodo>_<AAAAMMDD-HHMM>.txt` */
export function nomeDoArquivoSped(p?: {
    familia: string;
    cnpj?: string | null;
    periodo: string;
    agoraMs?: number;
}): string;

/**
 * Liga a TELA ao ARQUIVO: nome da geração + as linhas-âncora copiadas do
 * arquivo que saiu, com a ação para o caso de o PVA mostrar outro número
 * (ele guarda a escrituração importada na base dele).
 */
export function avisoDeIdentidadeDoArquivo(p?: {
    filename?: string | null;
    linhas?: string[] | null;
    registros?: string[] | null;
}): string[];
