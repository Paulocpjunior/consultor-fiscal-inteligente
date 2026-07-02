export interface EmpresaComCnpj {
    cnpj?: string | null;
    [key: string]: unknown;
}

export function cnpjRaiz(cnpj: string | number | null | undefined): string;

export function umaPorRaizPorCiclo<T extends EmpresaComCnpj>(
    empresas: T[] | null | undefined,
    agoraMs?: number,
): {
    selecionadas: T[];
    puladas: T[];
};
