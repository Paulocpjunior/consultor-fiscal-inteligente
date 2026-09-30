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
export function aliquotasDoRegime(regimeApuracao: string): { pis: number; cofins: number };
export function lerPisCofinsDosItens(nota: any, direcao: string, dados: any): {
    liquidosDosItens: number[]; descontosPorItem: number[]; fretesPorItem: number[];
    pisCofinsDosItens: Array<{ cstPis: string; cstCofins: string; basePis: number; baseCofins: number; aliqPis: number; aliqCofins: number; vlPis: number; vlCofins: number }>;
    aliquotas: { pis: number; cofins: number };
};
export function buildBlocoD_Contrib(dados: any): string[];
export function buildBlocoF(dados?: any): string[];
export function buildBlocoM(dados: any): string[];
export function buildBloco1_Contrib(dados?: any): string[];
export function buildBloco9_Contrib(linhasAnteriores: string[]): string[];

/**
 * A retenção SOFRIDA que vira F600 (nota de SAÍDA).
 *
 * `ajustes` é o mapa `chaveDoAjuste → ajuste declarado` da competência. O
 * ajuste VENCE o documento — sem ele, a nota que o cliente emitiu sem informar
 * a retenção sai do F600 e o M200/M600 declara a recolher A MAIOR (04/09,
 * FRONTINI). Ver `retencao-pj-ajuste.js`, que é o dono da pergunta.
 */
export function coletarRetencoesF600(
    notas: any[],
    warnings?: string[] | null,
    ajustes?: Record<string, any> | null,
): { eventos: any[]; totalPis: number; totalCofins: number };
