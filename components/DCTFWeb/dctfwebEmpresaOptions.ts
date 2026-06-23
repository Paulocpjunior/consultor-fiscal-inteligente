import type { DctfwebDeclaracao } from '../../types';
import type { DctfwebEmpresaOption } from '../../services/dctfwebService';

export function normalizarCnpjDctfweb(value?: string | null): string {
    return (value || '').replace(/\D/g, '');
}

export function buildDctfwebEmpresaOptions(
    empresas: DctfwebEmpresaOption[] = [],
    declaracoes: DctfwebDeclaracao[] = [],
): DctfwebEmpresaOption[] {
    const map = new Map<string, DctfwebEmpresaOption>();

    for (const emp of empresas) {
        const cnpj = normalizarCnpjDctfweb(emp.cnpj);
        if (cnpj.length !== 14) continue;
        map.set(cnpj, {
            ...emp,
            id: emp.id || cnpj,
            nome: emp.nome || cnpj,
            cnpj,
            fonte: 'lucro',
        });
    }

    for (const decl of declaracoes) {
        const cnpj = normalizarCnpjDctfweb(decl.empresaCnpj);
        if (cnpj.length !== 14 || map.has(cnpj)) continue;
        map.set(cnpj, {
            id: decl.empresaId || cnpj,
            nome: cnpj,
            cnpj,
            fonte: 'lucro',
        });
    }

    return Array.from(map.values())
        .sort((a, b) => (a.nome || a.cnpj).localeCompare(b.nome || b.cnpj));
}
