export interface CarteiraScope {
    uid: string;
    empresaIds: Set<string>;
    empresaCnpjs: Set<string>;
}

export function normalizaCnpj(value?: string | null): string {
    return (value || '').replace(/\D/g, '');
}

export function podeVerEmpresaPorCarteira(
    empresa: { id?: string; cnpj?: string | null; createdBy?: string | null },
    scope: CarteiraScope,
): boolean {
    if (!scope.uid) return false;
    if (empresa.createdBy && empresa.createdBy === scope.uid) return true;
    if (empresa.id && scope.empresaIds.has(empresa.id)) return true;
    const cnpj = normalizaCnpj(empresa.cnpj);
    return !!cnpj && scope.empresaCnpjs.has(cnpj);
}

export function podeVerDocumentoPorCarteira(
    doc: {
        empresaId?: string | null;
        empresaCnpj?: string | null;
        createdBy?: string | null;
        importadoPor?: string | null;
    },
    scope: CarteiraScope,
): boolean {
    if (!scope.uid) return false;
    if (doc.createdBy && doc.createdBy === scope.uid) return true;
    if (doc.importadoPor && doc.importadoPor === scope.uid) return true;
    if (doc.empresaId && scope.empresaIds.has(doc.empresaId)) return true;
    const cnpj = normalizaCnpj(doc.empresaCnpj);
    return !!cnpj && scope.empresaCnpjs.has(cnpj);
}
