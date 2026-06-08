/**
 * validadorDocumento — validação de DV de CNPJ (numérico e alfanumérico) e CPF.
 *
 * CNPJ alfanumérico: IN RFB 2.229/2024, vigência a partir de 07/2026.
 * Os 12 primeiros caracteres podem ser letras maiúsculas [A-Z] ou dígitos [0-9].
 * Os 2 últimos (DV) permanecem numéricos. O cálculo do DV usa o código ASCII
 * subtraído de 48 (ex: '0' → 0, '9' → 9, 'A' → 17, 'Z' → 42).
 */

const PESOS_CNPJ_DV1: ReadonlyArray<number> = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CNPJ_DV2: ReadonlyArray<number> = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CPF_DV1: ReadonlyArray<number> = [10, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CPF_DV2: ReadonlyArray<number> = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Limpa CNPJ aceitando letras maiúsculas (alfanumérico).
 * Remove qualquer caractere que não seja [A-Z0-9].
 */
export function limparCnpj(cnpj: string): string {
    return (cnpj || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function limparCpf(cpf: string): string {
    return (cpf || '').replace(/\D/g, '');
}

function caractereParaValor(c: string): number {
    // ASCII '0' = 48, então '0'..'9' → 0..9; 'A'..'Z' → 17..42
    return c.charCodeAt(0) - 48;
}

function calcularDvCnpj(base: string, pesos: ReadonlyArray<number>): number {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) {
        soma += caractereParaValor(base[i]) * pesos[i];
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
}

/**
 * Valida CNPJ numérico OU alfanumérico (IN RFB 2.229/2024).
 * Aceita formatação livre (pontos, barra, hífen, espaços).
 * Rejeita sequências repetidas como "00000000000000".
 */
export function validarCnpj(cnpj: string): boolean {
    const c = limparCnpj(cnpj);
    if (c.length !== 14) return false;
    // Os dois últimos (DV) devem ser numéricos
    if (!/^\d{2}$/.test(c.slice(12))) return false;
    // Rejeita sequência única ("00000000000000", "AAAAAAAAAAAAAA")
    if (/^(.)\1{13}$/.test(c)) return false;

    const dv1Esperado = calcularDvCnpj(c.slice(0, 12), PESOS_CNPJ_DV1);
    const dv2Esperado = calcularDvCnpj(c.slice(0, 13), PESOS_CNPJ_DV2);
    return dv1Esperado === parseInt(c[12], 10) && dv2Esperado === parseInt(c[13], 10);
}

/**
 * Valida CPF pelo algoritmo de módulo 11.
 * Aceita formatação livre. Rejeita sequências repetidas.
 */
export function validarCpf(cpf: string): boolean {
    const c = limparCpf(cpf);
    if (c.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(c)) return false;

    const calc = (base: string, pesos: ReadonlyArray<number>) => {
        let soma = 0;
        for (let i = 0; i < pesos.length; i++) soma += parseInt(base[i], 10) * pesos[i];
        const resto = soma % 11;
        return resto < 2 ? 0 : 11 - resto;
    };

    const dv1 = calc(c.slice(0, 9), PESOS_CPF_DV1);
    const dv2 = calc(c.slice(0, 10), PESOS_CPF_DV2);
    return dv1 === parseInt(c[9], 10) && dv2 === parseInt(c[10], 10);
}

/**
 * Formata CNPJ no padrão "XX.XXX.XXX/XXXX-XX" (funciona com alfanumérico).
 */
export function formatarCnpj(cnpj: string): string {
    const c = limparCnpj(cnpj);
    if (c.length !== 14) return cnpj;
    return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export function formatarCpf(cpf: string): string {
    const c = limparCpf(cpf);
    if (c.length !== 11) return cpf;
    return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}
