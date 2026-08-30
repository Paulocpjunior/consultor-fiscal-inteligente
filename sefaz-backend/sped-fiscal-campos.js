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
// CERTO — o jeito conhecido de a equipe desligar a trava.
//
// 🚨 **E TRÊS DOS INCERTOS SÃO EMITIDOS PELO GERADOR** (9999, E210, D100), o
// que faria a lista de "não conferidos" aparecer em produção — e o **9999 em
// TODO arquivo**, porque a seção dele é a última do Guia e a varredura engole
// o que vem depois. Os três foram LIDOS CAMPO A CAMPO na mesma fonte
// (`CAMPOS_LIDOS_A_MAO_NO_GUIA_FISCAL`), e isso apareceu **medindo o arquivo
// real**, não lendo o código.
//
// 📌 **E O SILÊNCIO SAI DITO** (`naoConferidos`): registro que a tabela não
// cobre não é registro aprovado. Foi exatamente o silêncio da trava do
// Contribuições — que só acusava os onze registros provados por recibo — que
// deixou o 0500 passar.
// ============================================================================
import {
    CAMPOS_DO_GUIA_FISCAL,
    REGISTROS_INCERTOS_NO_GUIA_FISCAL,
    TAMANHOS_DO_GUIA_FISCAL,
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
 * Registros cuja tabela do Guia foi lida **CAMPO A CAMPO por uma pessoa**,
 * porque a extração mecânica não fechou neles.
 *
 * ⚠️ Entram ACIMA da extração e ABAIXO do recibo: é leitura da MESMA fonte
 * oficial, feita à mão porque a máquina falhou — não é prova de arquivo aceito.
 * Cada entrada nomeia os campos lidos, para a conferência ser refazível.
 *
 * 🚨 **E OS TRÊS SÃO EMITIDOS PELO GERADOR** — sem eles a lista de "não
 * conferidos" apareceria em produção, e o **9999 sairia em TODO arquivo**.
 * Alarme que nasce em toda geração é o jeito conhecido de a equipe desligar a
 * trava; foi medindo o arquivo real que isso apareceu, não lendo o código.
 */
export const CAMPOS_LIDOS_A_MAO_NO_GUIA_FISCAL = {
    // A seção do 9999 é a ÚLTIMA do Guia, então a varredura vai até o fim do
    // documento e engole a "Seção 5 – Obrigatoriedade dos Registros" inteira:
    // a extração devolvia **67** campos com dezenas de buracos.
    9999: {
        campos: 2,
        fonte: 'Guia Prático do EFD ICMS/IPI 3.2.3, tabela do registro 9999, lida campo a campo: '
            + 'REG · QTD_LIN. (A extração lê 67 porque a seção é a última do documento.)',
    },
    // 📌 Buraco no MEIO não subestima o total — o que subestima é o buraco no
    // FIM. Nos dois abaixo o ÚLTIMO número está legível, e é ele que dá a
    // contagem; o que se perdeu foi o NOME de um campo do meio.
    E210: {
        campos: 15,
        fonte: 'Guia Prático do EFD ICMS/IPI 3.2.3, tabela do registro E210, lida campo a campo: '
            + 'REG · IND_MOV_ST · VL_SLD_CRED_ANT_ST · VL_DEVOL_ST · VL_RESSARC_ST · VL_OUT_CRED_ST · '
            + 'VL_AJ_CREDITOS_ST · VL_RETENÇAO_ST · VL_OUT_DEB_ST · VL_AJ_DEBITOS_ST · '
            + 'VL_SLD_DEV_ANT_ST · VL_DEDUÇÕES_ST · VL_ICMS_RECOL_ST · (campo 14, nome perdido na '
            + 'conversão) · DEB_ESP_ST.',
    },
    // ⚠️ E ele tem **25** campos aqui contra **23** no EFD-Contribuições — a
    // prova, de novo, de que leiaute é por FAMÍLIA (o 0500 e o 1010 já tinham
    // custado recibo por essa mesma confusão).
    D100: {
        campos: 25,
        fonte: 'Guia Prático do EFD ICMS/IPI 3.2.3, tabela do registro D100, lida campo a campo: '
            + 'REG · IND_OPER · IND_EMIT · COD_PART · COD_MOD · COD_SIT · SER · SUB · NUM_DOC · '
            + 'CHV_CTE · DT_DOC · DT_A_P · (campo 13, nome perdido na conversão) · CHV_CTE_REF · '
            + 'VL_DOC · VL_DESC · IND_FRT · VL_SERV · VL_BC_ICMS · VL_ICMS · VL_NT · COD_INF · '
            + 'COD_CTA · COD_MUN_ORIG · COD_MUN_DEST.',
    },
};

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
    // A leitura humana do MESMO Guia entra por cima da extração que falhou…
    for (const [reg, d] of Object.entries(CAMPOS_LIDOS_A_MAO_NO_GUIA_FISCAL)) tabela[reg] = d;
    // …e o provado por recibo/arquivo aceito entra POR CIMA de tudo.
    for (const [reg, d] of Object.entries(CAMPOS_PROVADOS_POR_RECIBO_FISCAL)) tabela[reg] = d;
    return tabela;
})();

/** Registros que a tabela não cobre — a trava continua MUDA neles. */
export const REGISTROS_SEM_CONTAGEM_FISCAL = Object.freeze(
    REGISTROS_INCERTOS_NO_GUIA_FISCAL.filter((r) => !CAMPOS_LIDOS_A_MAO_NO_GUIA_FISCAL[r]),
);

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

/**
 * 🚨 O TAMANHO DE CADA CAMPO — a trava que a de CONTAGEM não faz.
 *
 * `conferirContagemDeCamposFiscal` conta CAMPOS. O FANTASIA do 0005 saindo com
 * 91 caracteres num campo de 60 (29/08) tem a contagem CERTA — quem pega
 * aquilo é esta. As duas são necessárias e nenhuma substitui a outra; é a
 * mesma cegueira que deixou o M210 da MANTOAN passar com as casas trocadas.
 *
 * ═══ POR QUE ELA MEDE A SAÍDA, E NÃO O CÓDIGO ═══════════════════════════════
 *
 * Varredura de `sanitizeString(x, N)` no fonte provaria que a constante está
 * certa; esta prova que o **ARQUIVO** está — e é o arquivo que o PVA lê (a
 * lição do C100 com modelo 55 e chave 65, que passou meses porque a
 * conferência auditava a INTENÇÃO).
 *
 * 🚨 **E foi medindo que ela achou dois defeitos vivos** (30/08), os dois da
 * mesma classe — campo que escapou do corte enquanto os vizinhos cortavam:
 *
 *   · **H010 campo 08 (COD_PART)** — saía CRU com os três vizinhos cortando;
 *   · **K200 campos 03 e 06 (COD_ITEM, COD_PART)** — o bloco K devolve ARRAYS
 *     DE CAMPOS e a casca formata, mas o `buildLine` formata NÚMERO, não corta
 *     TEXTO. Ninguém cortava.
 *
 * ⚠️ **CAMPO DE TAMANHO LIVRE NÃO É CONFERIDO** (`null` na tabela): todo campo
 * de valor é livre no Guia, e cravar limite ali seria inventar regra.
 */
export function conferirTamanhoDeCamposFiscal(linhas) {
    const erros = [];

    (Array.isArray(linhas) ? linhas : []).forEach((linha, i) => {
        const t = String(linha || '').replace(/\r?\n$/, '');
        if (!t.startsWith('|') || !t.endsWith('|')) return;
        const campos = t.slice(1, -1).split('|');
        const reg = String(campos[0] || '').trim();
        const tabela = TAMANHOS_DO_GUIA_FISCAL[reg];
        if (!tabela) return;

        campos.forEach((valor, pos) => {
            if (pos === 0) return;                    // o REG é o campo 01
            const max = tabela[pos];                  // tabela[0] = campo 01
            if (max == null) return;                  // livre ou não lido
            if (String(valor).length <= max) return;
            erros.push({
                registro: reg,
                linha: i + 1,
                campo: pos + 1,
                tamanho: String(valor).length,
                maximo: max,
                mensagem: `${reg} campo ${String(pos + 1).padStart(2, '0')}: saiu com `
                    + `${String(valor).length} caracteres e o leiaute dá ${max}. `
                    + 'O PVA recusa com "Tamanho do campo inválido".',
            });
        });
    });

    return { erros, ok: erros.length === 0 };
}
