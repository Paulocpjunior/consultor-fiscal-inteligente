export interface CarteiraScope {
    uid: string;
    empresaIds: Set<string>;
    empresaCnpjs: Set<string>;
}

export interface CarteiraVinculoLike {
    empresaId?: string | null;
    empresaCnpj?: string | null;
    colaboradorUid?: string | null;
    colaboradorNome?: string | null;
    colaboradorEmail?: string | null;
}

export function normalizaCnpj(value?: string | null): string {
    return (value || '').replace(/\D/g, '');
}

export function normalizaTexto(value?: string | null): string {
    return (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

export function vinculoPertenceAoUsuario(
    vinculo: CarteiraVinculoLike,
    user: { id?: string | null; name?: string | null; email?: string | null },
    uid = user.id || '',
): boolean {
    const uidAtual = uid || user.id || '';
    if (uidAtual && vinculo.colaboradorUid === uidAtual) return true;

    const emailUser = normalizaTexto(user.email);
    const emailVinculo = normalizaTexto(vinculo.colaboradorEmail);
    if (emailUser && emailVinculo && emailUser === emailVinculo) return true;

    const nomeUser = normalizaTexto(user.name);
    const nomeVinculo = normalizaTexto(vinculo.colaboradorNome);
    return !!nomeUser && !!nomeVinculo && nomeUser === nomeVinculo;
}

export function montaCarteiraScope(
    uid: string,
    vinculosDoUsuario: CarteiraVinculoLike[],
    existeAlgumVinculo: boolean,
): CarteiraScope | null {
    if (!existeAlgumVinculo || vinculosDoUsuario.length === 0) return null;
    return {
        uid,
        empresaIds: new Set(vinculosDoUsuario.map(v => String(v.empresaId || '')).filter(Boolean)),
        empresaCnpjs: new Set(vinculosDoUsuario.map(v => normalizaCnpj(v.empresaCnpj)).filter(Boolean)),
    };
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
