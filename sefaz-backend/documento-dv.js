// ============================================================================
// documento-dv.js  (PURO — sem Express, sem Firebase)
// ----------------------------------------------------------------------------
// O DÍGITO VERIFICADOR de CPF e CNPJ, num lugar só.
//
// ═══ POR QUE ISTO VIROU NÚCLEO ══════════════════════════════════════════════
//
// A régua existia só em `services/validadorDocumento.ts` — ou seja, só no
// FRONTEND. O backend não podia importar TypeScript, então quem gravava
// documento no banco conferia... o COMPRIMENTO. Onze dígitos passavam.
//
// O caso que expôs isso: o `cpfTitular` do produtor rural (VINCENZO ×
// ANTONIO DIAS DA SILVA). Esse CPF é o que o R-2055 declara no `ideProdutor`,
// e declaração ao Reinf NÃO SE DESFAZ. Um dígito trocado na digitação vira
// declaração em nome de OUTRA PESSOA — e não existe nada depois disso que
// perceba: o número tem 11 dígitos, o app grava, o evento sai, a Receita
// aceita (o CPF pode ser de alguém real) e ninguém desconfia.
//
// Comprimento não é validação. O DV é justamente o mecanismo que a Receita
// pôs no número para pegar erro de digitação — não usá-lo é jogar fora a
// única rede que existe ANTES da declaração.
//
// ═══ O QUE O DV PEGA E O QUE ELE NÃO PEGA ═══════════════════════════════════
//
// Pega: dígito trocado, dígitos transpostos, número inventado. É ~99% dos
// erros de digitação, e são justamente os que passariam despercebidos.
// NÃO pega: o CPF de outra pessoa, digitado corretamente. Contra isso não há
// algoritmo — o que há é o carimbo de ORIGEM (`origemDoCpf`) e o registro de
// quem digitou, que já existem no cadastro do produtor.
//
// CNPJ alfanumérico: IN RFB 2.229/2024, vigência a partir de 07/2026. Os 12
// primeiros caracteres podem ser [A-Z0-9]; os 2 últimos (DV) continuam
// numéricos. O cálculo usa o ASCII menos 48 ('0'→0, '9'→9, 'A'→17, 'Z'→42).
// ============================================================================

const PESOS_CNPJ_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CNPJ_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CPF_DV1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CPF_DV2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

export function limparCnpj(cnpj) {
    return String(cnpj || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function limparCpf(cpf) {
    return String(cpf || '').replace(/\D/g, '');
}

/** Módulo 11: resto < 2 ⇒ DV 0. Vale para CPF e CNPJ. */
function dvModulo11(soma) {
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
}

function calcularDvCnpj(base, pesos) {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) {
        const ch = base[i];
        if (ch === undefined) continue;
        // ASCII '0' = 48
        soma += (ch.charCodeAt(0) - 48) * pesos[i];
    }
    return dvModulo11(soma);
}

function calcularDvCpf(base, pesos) {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) {
        const ch = base[i];
        if (ch === undefined) continue;
        soma += parseInt(ch, 10) * pesos[i];
    }
    return dvModulo11(soma);
}

/** Valida CNPJ numérico OU alfanumérico. Rejeita sequência única. */
export function validarCnpj(cnpj) {
    const c = limparCnpj(cnpj);
    if (c.length !== 14) return false;
    if (!/^\d{2}$/.test(c.slice(12))) return false;
    if (/^(.)\1{13}$/.test(c)) return false;
    return calcularDvCnpj(c.slice(0, 12), PESOS_CNPJ_DV1) === parseInt(c[12], 10)
        && calcularDvCnpj(c.slice(0, 13), PESOS_CNPJ_DV2) === parseInt(c[13], 10);
}

/** Valida CPF pelo módulo 11. Rejeita sequência única ("111.111.111-11"). */
export function validarCpf(cpf) {
    const c = limparCpf(cpf);
    if (c.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(c)) return false;
    return calcularDvCpf(c.slice(0, 9), PESOS_CPF_DV1) === parseInt(c[9], 10)
        && calcularDvCpf(c.slice(0, 10), PESOS_CPF_DV2) === parseInt(c[10], 10);
}

export function formatarCnpj(cnpj) {
    const c = limparCnpj(cnpj);
    if (c.length !== 14) return String(cnpj || '');
    return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export function formatarCpf(cpf) {
    const c = limparCpf(cpf);
    if (c.length !== 11) return String(cpf || '');
    return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}
