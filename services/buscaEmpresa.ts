/**
 * buscaEmpresa — régua ÚNICA da busca de empresa por texto.
 *
 * Paulo, 04-05/08: "todos os campos que contenham consulta nome e cnpj da
 * empresa agora devem aceitar código, nome, cnpj". O seletor das telas de
 * XML (EmpresaSearchSelect) ganhou o código primeiro; os painéis Simples e
 * Lucro têm busca própria e ficaram de fora — Paulo procurou "pelo número"
 * na lista do Simples e não achou (05/08). Regra única aqui, usada por todos.
 *
 * Código (Cod.Cliente do E-Fiscal): bate por igualdade com pad ("587" acha a
 * 0587), por prefixo e pelo valor sem zeros. NÃO bate "no meio" — código é
 * identidade, não substring.
 */

export interface EmpresaBuscavel {
    nome?: string | null;
    cnpj?: string | null;
    dadosFiscais?: { codCliente?: string | null } | null;
}

export function empresaBateBusca(termoBruto: string, e: EmpresaBuscavel): boolean {
    const termo = String(termoBruto || '').trim().toLowerCase();
    if (!termo) return true;
    const digitos = termo.replace(/\D/g, '');

    if ((e.nome || '').toLowerCase().includes(termo)) return true;

    const cnpj = String(e.cnpj || '').replace(/\D/g, '');
    if (digitos && cnpj.includes(digitos)) return true;

    const cod = String(e.dadosFiscais?.codCliente || '');
    if (cod && digitos && digitos.length <= 4) {
        if (cod === digitos.padStart(4, '0')) return true;
        if (cod.startsWith(digitos)) return true;
        if (String(parseInt(cod, 10)) === digitos) return true;
    }
    return false;
}

/** "0587 · " pra exibir antes do nome (como no E-Fiscal); '' sem código. */
export function prefixoCodCliente(e: EmpresaBuscavel): string {
    const cod = String(e.dadosFiscais?.codCliente || '');
    return cod ? `${cod} · ` : '';
}
