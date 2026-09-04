export type TributoRetencao = 'ir' | 'inss' | 'csll' | 'pis' | 'cofins';

export interface ParametroRetencao {
    id?: string;
    empresaId: string;
    cnpjPrestador: string;
    nomePrestador?: string | null;
    tributo: TributoRetencao;
    aliquota: number;
    fundamento: string;
    /** 'AAAA-MM' — não retroage. */
    vigenciaInicio: string;
    ativo?: boolean;
    criadoPor?: string;
    criadoEm?: string;
}

export interface SugestaoRetencao {
    valor: number;
    aliquota: number;
    fundamento: string;
    vigenciaInicio: string;
}

export declare const TRIBUTOS_RETENCAO: TributoRetencao[];
export declare const CAMPO_DO_TRIBUTO: Record<TributoRetencao, string>;
export declare const MIN_FUNDAMENTO: number;

export declare function validarParametroRetencao(p: Partial<ParametroRetencao>): string[];

export declare function parametrosAplicaveis(
    parametros: ParametroRetencao[] | null | undefined,
    args?: { cnpjPrestador?: string; competencia?: string },
): ParametroRetencao[];

export declare function sugerirRetencoes(
    parametros: ParametroRetencao[] | null | undefined,
    args?: { cnpjPrestador?: string; competencia?: string; base?: number | null },
): Partial<Record<TributoRetencao, SugestaoRetencao>>;

export declare function explicarSugestao(
    tributo: string,
    s: SugestaoRetencao | null | undefined,
): string | null;
