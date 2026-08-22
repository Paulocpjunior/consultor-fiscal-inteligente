export const UF_POR_CUF: Record<string, string>;

export function ufDoMunicipioIBGE(codMunIBGE: unknown): string;
export function cnpjEmitente(d: unknown): string;
export function nomeEmitente(d: unknown): string;
export function ufEmitente(d: unknown): string;
export function modeloDoDoc(d: unknown): string;
export function cfopNaOticaDeEntrada(cfop: unknown): string;

/**
 * A CONTRAPARTE do documento (C100/0150) — régua única: saída = destinatário;
 * entrada = emitente, SALVO nota própria de entrada (tpNF=0 da empresa), cuja
 * contraparte é o destinatário. Devolve o que o documento TEM (importação
 * devolve a própria empresa — o exportador não vem no XML).
 */
export function participanteDoDocumento(
    d: unknown,
    empresaCnpj?: string,
): Record<string, unknown> | null;

/**
 * EM QUAL LADO está a contraparte — a MESMA régua acima, na forma que a TELA
 * precisa (escolher entre as duas colunas já normalizadas da view).
 *
 * ⚠️ NÃO se resolve pela direção EFETIVA: na nota própria de entrada a direção
 * é ENTRADA e a contraparte mora no DESTINATÁRIO — trocar por
 * `direcaoEfetivaDoc` faria a lista mostrar o nome do PRÓPRIO cliente.
 */
export function ladoDaContraparte(
    d: unknown,
    empresaCnpj?: string,
): 'emitente' | 'destinatario';

/**
 * Emissão PRÓPRIA (IND_EMIT = 0) — saída OU nota própria de entrada (tpNF=0).
 * Régua única do IND_EMIT do C100, da existência do C170 (Guia 3.2.3, Exceção
 * 2) e da coleta de itens do 0200: os três têm que concordar.
 */
export function ehEmissaoPropriaDoc(d: unknown, empresaCnpj?: string): boolean;

/**
 * UF do destinatário nas DUAS formas (aninhada × `ufDest` achatado). Campo de
 * decisão do ICMS-ST: cada UF do E200/E210 é uma GNRE. Devolve '' quando o
 * documento não a traz — UF de destino não se inventa.
 */
export function ufDoDestinatarioDoc(d: unknown): string;
