/**
 * VL_OPR do C190 — dono único (Guia Prático EFD ICMS/IPI 3.2.3, C190 campo 05).
 *
 * O `.d.ts` entra no MESMO PR que o teste que importa daqui: `.d.ts` à mão é a
 * armadilha das duas formas com outra roupa (20/08) — declarar só o que o `.js`
 * exporta, e tudo o que ele exporta.
 */

export const FONTE_VL_OPR: string;

export interface ItemDocumentoFiscal {
    vProd?: number | string | null;
    valor?: number | string | null;
    vFrete?: number | string | null;
    vSeg?: number | string | null;
    vOutro?: number | string | null;
    vICMSST?: number | string | null;
    vFCPST?: number | string | null;
    vIPI?: number | string | null;
    vDesc?: number | string | null;
    [k: string]: unknown;
}

export interface CampoDaReserva {
    /** nome do campo no ITEM (`documentos_fiscais.itens[]`) */
    item: string;
    /** nome do campo no TOTAL do documento (`totais.*`) */
    total: string;
    sinal: 1 | -1;
    rotulo: string;
}

export interface ReservaDosTotais {
    campos: Array<{ campo: string; total: string; rotulo: string; valor: number }>;
    /** já com o sinal (desconto negativo); zero quando não há reserva */
    valor: number;
}

/** VL_OPR a partir do ITEM completo (forma do banco). */
export function valorOperacaoDoItem(item?: ItemDocumentoFiscal | null): number;

/** Os sete campos do campo 05 do C190 que podem vir SÓ no total do documento. */
export const CAMPOS_DA_RESERVA: ReadonlyArray<CampoDaReserva>;

/** O que o TOTAL declara e NENHUM item carrega. */
export function reservaDosTotais(nota?: { itens?: ItemDocumentoFiscal[] | null; totais?: Record<string, unknown> | null } | null): ReservaDosTotais;

/**
 * VL_OPR por item, com a reserva dos totais distribuída: exata com um item,
 * rateada pelo vProd com vários (a sobra vai no último).
 */
export function valorOperacaoDosItens(nota?: { itens?: ItemDocumentoFiscal[] | null; totais?: Record<string, unknown> | null } | null): {
    porItem: number[];
    reserva: ReservaDosTotais;
    rateado: boolean;
};

/** Piso do VL_OPR derivado das colunas do C170 (campos 0-based, `campos[0] === 'C170'`). */
export function pisoDoValorOperacaoDoC170(campos?: string[] | null): number;

/** Frete + seguro + outras despesas do C100 (17/18/19, 0-based). */
export function acessoriasDoC100(campos?: string[] | null): number;

/** Faixa em que o VL_OPR declarado tem que cair. */
export function faixaDoValorOperacao(piso: number, acessorias: number): { piso: number; teto: number; exato: boolean };
