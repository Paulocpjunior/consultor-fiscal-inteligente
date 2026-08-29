// ============================================================================
// sefaz-backend/sped-fiscal-campos.js  (PURO — testável)
//
// 🚨 A CONTAGEM DE CAMPOS DO EFD ICMS/IPI — a trava que existia só na OUTRA
// família.
//
// `conferirContagemDeCampos` roda em todo arquivo do EFD-**Contribuições**
// desde 18/08. O EFD ICMS/IPI — o arquivo que a PWR fechou em 20/08, com 45
// registros de conteúdo — **não tinha NENHUMA**. É a "meia trava" do COD_MUN
// do 0150 (22/08) na sua forma mais cara: ela protege o cliente de uma família
// e deixa o da outra descoberto.
//
// ═══ A CLASSE QUE ELA PEGA JÁ CUSTOU RECIBO TRÊS VEZES ══════════════════════
//
//  · **1010** (17/08, MANTOAN) — 9 campos onde o leiaute tem 7, porque o 1010
//    do EFD-Contribuições é OUTRO registro (ação judicial). Mesmo número,
//    arquivo diferente, leiaute diferente.
//  · **C100/C170** (20/08, PWR) — 24 e 23 campos onde têm 29 e 37: **157
//    recusas de importação de uma vez**, todas consequência de UM defeito de
//    forma (a seção de ICMS/IPI pulada, e o CST_PIS caindo na casa do
//    CST_ICMS).
//  · **0500** (24/08, CF BANK) — saiu com o leiaute do arquivo VIZINHO, e quem
//    achou foi o Paulo **contando as barras na tela** (*"uma está com 4
//    barrinhas e a outra com 3"*).
//
// 🚨 **E ELA É CEGA PARA O TAMANHO**: conta CAMPOS. O FANTASIA do 0005 saindo
// com 91 caracteres num campo de 60 (29/08) tem a contagem CERTA — quem pega
// aquilo é a trava de tamanho, que é outra. As duas são necessárias e nenhuma
// substitui a outra.
//
// ⚠️ **REGISTRO INCERTO NÃO ENTRA.** A contagem vem de uma extração mecânica
// de .docx, e ela erra: onde o número de um campo se perdeu na conversão a
// contagem sai SUBESTIMADA, e acusar por ela seria alarme sobre registro
// CERTO — o jeito conhecido de a equipe desligar a trava. Esses ficam de fora,
// nomeados em `REGISTROS_INCERTOS_NO_GUIA_FISCAL`.
//
// 📌 **E O SILÊNCIO SAI DITO** (`naoConferidos`): registro que a tabela não
// cobre não é registro aprovado. Foi exatamente o silêncio da trava do
// Contribuições — que só acusava os onze registros provados por recibo — que
// deixou o 0500 passar.
// ============================================================================
import {
    CAMPOS_DO_GUIA_FISCAL,
    REGISTROS_INCERTOS_NO_GUIA_FISCAL,
} from './leiaute-fiscal-guia.js';

/**
 * Contagens PROVADAS por recibo do PVA ou arquivo aceito, que VENCEM o Guia.
 *
 * ⚠️ Nasce VAZIA de propósito, e isso é honestidade, não pendência esquecida:
 * recibo é a régua FALANDO, e não há nenhum recibo do EFD ICMS/IPI com
 * contagem de campo NOMEADA neste repo. A PWR fechou o arquivo em 20/08, mas
 * o que se tem dela é o "OK" — não a lista campo a campo.
 *
 * Entrada nova aqui vem COM a fonte (cliente, competência, data), como no
 * `CAMPOS_PROVADOS_POR_RECIBO` do EFD-Contribuições.
 */
export const CAMPOS_PROVADOS_POR_RECIBO_FISCAL = {};

/**
 * A tabela que a trava usa: **recibo VENCE, e o Guia cobre o resto**.
 *
 * Hoje são **250 registros** lidos por inteiro do Guia 3.2.3 — e os 45 que o
 * gerador de fato emite estão TODOS cobertos, medido contra o que ele produz.
 */
export const CAMPOS_POR_REGISTRO_FISCAL = (() => {
    const tabela = {};
    for (const [reg, campos] of Object.entries(CAMPOS_DO_GUIA_FISCAL)) {
        tabela[reg] = {
            campos,
            fonte: 'Guia Prático do EFD ICMS/IPI 3.2.3 — tabela de leiaute do registro '
                + `${reg} (extraída por scripts/extrair-leiaute-fiscal.mjs).`,
        };
    }
    for (const [reg, d] of Object.entries(CAMPOS_PROVADOS_POR_RECIBO_FISCAL)) tabela[reg] = d;
    return tabela;
})();

/** Registros que a tabela não cobre — a trava continua MUDA neles. */
export const REGISTROS_SEM_CONTAGEM_FISCAL = REGISTROS_INCERTOS_NO_GUIA_FISCAL;

/** `|C100|0|1|…|` → ['C100','0','1',…] (o REG na posição 0, como o PVA conta). */
function camposDaLinha(linha) {
    const t = String(linha || '').replace(/\r?\n$/, '');
    if (!t.startsWith('|') || !t.endsWith('|')) return [];
    return t.slice(1, -1).split('|');
}

/**
 * Confere as linhas do arquivo gerado contra o leiaute.
 *
 * Devolve `{ erros, naoConferidos, ok }`. **Nunca lança**: a geração não pode
 * morrer por causa da conferência — mas o erro sai NOMEADO, com o registro, as
 * duas contagens e a consequência.
 */
export function conferirContagemDeCamposFiscal(linhas) {
    const erros = [];
    const naoConferidosSet = new Set();

    (Array.isArray(linhas) ? linhas : []).forEach((linha, i) => {
        const campos = camposDaLinha(linha);
        if (!campos.length) return;
        const reg = String(campos[0] || '').trim();
        if (!reg) return;

        const esperado = CAMPOS_POR_REGISTRO_FISCAL[reg];
        if (!esperado) { naoConferidosSet.add(reg); return; }
        if (campos.length === esperado.campos) return;

        erros.push({
            registro: reg,
            linha: i + 1,
            esperado: esperado.campos,
            recebido: campos.length,
            fonte: esperado.fonte,
            mensagem: `${reg}: o leiaute tem ${esperado.campos} campos e a linha saiu com `
                + `${campos.length}. O PVA recusa o arquivo inteiro — e com campos faltando `
                + 'no meio, cada valor seguinte ocupa a casa do vizinho.',
        });
    });

    return {
        erros,
        // Registro emitido que a tabela não cobre — silêncio aqui NÃO é
        // aprovação, e dizer isso é o que impede a tabela de envelhecer calada.
        naoConferidos: [...naoConferidosSet].sort(),
        ok: erros.length === 0,
    };
}

/** Avisos prontos para entrar na lista que a geração já devolve. */
export function avisosDeContagemDeCamposFiscal(linhas) {
    return conferirContagemDeCamposFiscal(linhas).erros.map((e) => `🚨 ${e.mensagem}`);
}
