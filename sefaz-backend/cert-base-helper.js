export function limparCnpj(value) {
    return String(value || '').replace(/\D/g, '');
}

export function cnpjBase(value) {
    const cnpj = limparCnpj(value);
    return cnpj.length === 14 ? cnpj.slice(0, 8) : '';
}

function toMillis(value) {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
        const ms = Date.parse(value);
        return Number.isNaN(ms) ? null : ms;
    }
    return null;
}

export function certA1MetadataValido(cert, nowMs = Date.now()) {
    const tipoCert = cert?.tipoCert || 'A1';
    if (tipoCert !== 'A1') return false;

    const base = cnpjBase(cert?.cnpj || cert?.cnpjCert);
    if (!base) return false;

    const hasStorage = !!(cert?.storagePath || cert?.hasStoragePath);
    const hasPassword = !!(cert?.passwordEnc || cert?.hasPasswordEnc);
    if (!hasStorage || !hasPassword) return false;

    const notAfterMs = toMillis(cert?.notAfter);
    if (!notAfterMs || notAfterMs <= nowMs) return false;

    return true;
}

export function selecionarCertA1PorBase(
    certs,
    empresaCnpj,
    nowMs = Date.now(),
    excludeEmpresaId = null,
) {
    const baseAlvo = cnpjBase(empresaCnpj);
    if (!baseAlvo) return null;

    return (certs || [])
        .filter(cert => {
            if (excludeEmpresaId && cert?.empresaId === excludeEmpresaId) return false;
            return certA1MetadataValido(cert, nowMs)
                && cnpjBase(cert?.cnpj || cert?.cnpjCert) === baseAlvo;
        })
        .sort((a, b) => (toMillis(b.notAfter) || 0) - (toMillis(a.notAfter) || 0))[0] || null;
}
