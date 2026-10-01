export function decidirEfdIcmsIpi(empresa: unknown): {
    obrigada: boolean;
    via: 'df' | 'ie' | 'isento' | 'sem-ie';
    motivo: string;
};
export function tarefaSpedParaCancelar(t: { obrigacao?: string; status?: string; origem?: string } | null | undefined, empresa: unknown): boolean;
