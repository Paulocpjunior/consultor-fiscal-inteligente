export interface CertA1Metadata {
    empresaId?: string;
    tipoCert?: string;
    cnpj?: string;
    cnpjCert?: string;
    notAfter?: string | number | Date | { toMillis?: () => number; toDate?: () => Date } | null;
    storagePath?: string | null;
    passwordEnc?: string | null;
    hasStoragePath?: boolean;
    hasPasswordEnc?: boolean;
}

export function limparCnpj(value: unknown): string;
export function cnpjBase(value: unknown): string;
export function certA1MetadataValido(cert: CertA1Metadata | null | undefined, nowMs?: number): boolean;
export function selecionarCertA1PorBase<T extends CertA1Metadata>(
    certs: T[],
    empresaCnpj: string,
    nowMs?: number,
    excludeEmpresaId?: string | null,
): T | null;
