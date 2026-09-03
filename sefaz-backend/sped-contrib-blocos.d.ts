/**
 * Blocos A, C, D, F, M, 1 e 9 do EFD-Contribuições.
 * O `.d.ts` entra no mesmo PR que o módulo (convenção do projeto).
 */

/**
 * O VALOR do documento de serviço, nas formas em que ele chega
 * (`valor` · `valorTotal` · `valorServicos` · `totais.vNF` · `valores.*`).
 *
 * ⚠️ Devolve **NaN** quando nenhuma forma tem número — de propósito: quem chama
 * precisa distinguir "documento de R$ 0,00" de "não achei o valor". Zero
 * silencioso aqui foi o defeito de 17/08 (37 A100 zerados num arquivo entregue).
 */
export function valorDoDocumentoServico(nota: any): number;

export function buildBlocoA(dados: any): string[];
export function buildBlocoC_Contrib(dados: any): string[];
export function buildBlocoD_Contrib(dados: any): string[];
export function buildBlocoF(dados?: any): string[];
export function buildBlocoM(dados: any): string[];
export function buildBloco1_Contrib(dados?: any): string[];
export function buildBloco9_Contrib(linhasAnteriores: string[]): string[];

// 03/09 (auditoria): exportações que o .js já entregava e o .d.ts não declarava —
// importador TypeScript não enxergava o símbolo (erro de compilação).
export function coletarRetencoesF600(notas: unknown[], warnings?: string[]): { eventos: Array<{ data: string | null; base: number; pis: number; cofins: number; cnpjFonte: string; numero: string }> } | any;
export function filtrarNotasBlocoA(notas: unknown[]): unknown[];
export const COD_ITEM_SERVICO_GENERICO: string;
