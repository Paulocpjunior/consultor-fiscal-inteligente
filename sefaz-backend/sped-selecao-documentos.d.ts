/**
 * Qual documento entra em qual bloco do SPED — o modelo vem da RÉGUA (chave),
 * nunca do campo cru `modelo`, que o importer principal não grava.
 * O `.d.ts` entra no mesmo PR que o módulo (convenção do projeto).
 */

/** Rótulo do documento num aviso: o número é o que a pessoa procura na tela. */
export function rotuloDoDoc(d: unknown): string;

/** É um RESUMO da SEFAZ (resNFe/resNFCe — sem itens por natureza)? */
export function ehResumoSefaz(d: unknown): boolean;

/** NF-e (55) ou NFC-e (65) — bloco C. O tipo é julgado ANTES do modelo. */
export function ehNotaDeMercadoria(d: unknown): boolean;

/** CT-e (57) / CT-e OS (67) — bloco D. */
export function ehConhecimentoDeTransporte(d: unknown): boolean;

export interface SelecaoBlocoC<T = any> {
    /** As que se escrituram (cancelada entra: C100 sem filhos). */
    notas: T[];
    /** Só o resumo na base — a ação é importar o XML completo / ♻️. */
    soResumo: string[];
    /** Válidas sem itens — produziriam C100 sem C190, que o PVA recusa. */
    semItens: string[];
    /** NFC-e marcadas como entrada — o Guia Prático proíbe escriturá-las. */
    nfceEmEntrada: string[];
}

export function selecionarNotasBlocoC<T = any>(notas: T[] | null | undefined): SelecaoBlocoC<T>;

export function selecionarCtesBlocoD<T = any>(notas: T[] | null | undefined): T[];

/** O que ficou de fora do arquivo, dito com a ação — nunca calado. */
export function avisosDaSelecao(p?: {
    soResumo?: string[]; semItens?: string[]; nfceEmEntrada?: string[];
}): string[];

/** NFS-e — o que vai ao bloco A do EFD-Contribuições (CT-e fica de fora: é do D). */
export function ehNotaDeServico(d: unknown): boolean;

/**
 * COD_SIT do documento (C100 e D100 — a tabela é a MESMA).
 *
 * Régua ÚNICA: havia duas, e o bloco D declarava '08' (regime especial) para
 * status desconhecido. O status ESPECÍFICO vem antes do `docCancelado`, senão
 * a nota DENEGADA sai como cancelada (02) em vez de 04.
 *
 * @param uf UF da empresa — no PARANÁ a nota em substituição ao cupom
 *   (CFOP 5929/6929) escritura por outra regra, ressalva do próprio manual.
 */
export function codSitDoDocumento(d: unknown, uf?: string): string;

/** Tabela 4.1.1 — Tipo do Item: 09 = Serviços. */
export const TIPO_ITEM_SERVICO: string;
/** Tabela 4.1.1 — Tipo do Item: 00 = Mercadoria para Revenda. */
export const TIPO_ITEM_MERCADORIA_REVENDA: string;

/**
 * TIPO_ITEM do item, pelo DOCUMENTO em que ele veio — serviço é 09, e o 0200
 * dele não leva NCM (Guia 3.2.3, 0200 campo 08: "Não existe COD-NCM para
 * serviços"). Mercadoria continua '00': a destinação real (01 matéria-prima,
 * 04 produto acabado) não está no XML e não se deduz.
 */
export function tipoItemDoDocumento(nota: unknown): string;

/** O item já classificado é de serviço? */
export function ehItemDeServico(item: unknown): boolean;

/**
 * SER — série do documento com as três posições que o PVA cobra, lida do campo
 * gravado ou, na falta dele, da CHAVE (posições 23-25). '000' quando não há
 * série; nunca o '1' que o bloco D inventava.
 */
export function serieDoDocumento(nota: unknown): string;

/**
 * COD_ITEM — a CHAVE que liga o item ao cadastro do 0200.
 *
 * O 0200 é a Tabela de Identificação do Item; C170 e A170 apontam para ela.
 * Tinha QUATRO cópias divergentes (22/08), e as duas consequências já foram
 * cobradas pelo PVA: "Campo obrigatório · COD_ITEM" (MANTOAN, 36 recusas) e o
 * item ÓRFÃO declarado e não referenciado (PWR). Nunca devolve vazio.
 */
export function codItemDoItem(item: unknown): string;
