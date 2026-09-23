// ============================================================================
// sefaz-backend/acervo-do-fechamento.js  (PURO — sem io, testável)
// ----------------------------------------------------------------------------
// 🔒 O ACERVO QUE O FIM DE MÊS CONGELOU — quais documentos viraram aquele
//    número, e quais chegaram DEPOIS.
//
// Paulo, 26/08: o fim de mês *"deve ser usada como régua para nos nortear,
// usar como base p impostos, livros, ficha financeira"*. O carimbo já guarda o
// instante do corte; **este módulo é quem o LÊ**. Sem ele, o livro de agosto
// reimpresso em dezembro sai DIFERENTE se uma nota de agosto chegou em
// novembro — que é exatamente o que o ato existe para impedir.
//
// ═══ POR QUE A COMPARAÇÃO É EM MEMÓRIA, e não uma query ═════════════════════
//
// 🚨 MEDIDO, não suposto: o instante de chegada é gravado em **dois nomes** e
// **dois tipos**, conforme o trilho que capturou:
//
//   · `xml-importer.js`        → `createdAt`  = serverTimestamp()  (Timestamp)
//   · `nfse-sp-csv-importer`   → `createdAt` + `importadoEm`        (Timestamp)
//   · `nfse-sp-importer.js:172`→ `createdAt` + `importadoEm`        (**string ISO**)
//   · `abrasf/importer.js`     → `importadoEm` = serverTimestamp()  (Timestamp)
//
// Um `.where('createdAt', '<=', corte)` deixaria de fora, **EM SILÊNCIO**,
// todo documento gravado como string: o Firestore ordena por TIPO, e string
// nunca cai num range de Timestamp. Seria o livro a MENOR, na direção mais
// cara, e nada acusaria. Por isso a régua lê as quatro formas em memória — e
// o `xmlFiscalService` já carregava essa cascata para ORDENAR a lista, o que é
// a prova de que o campo tem muitas formas.
//
// ═══ AUSÊNCIA NÃO É PROVA — e aqui isso decide o lado do erro ════════════════
//
// Documento sem instante legível **FICA** e sai NOMEADO. Tirá-lo produziria
// livro a menor (o erro caro); mantê-lo produz, no máximo, um livro com um
// documento a mais que o carimbo contou — e isso é DITO, com o número do
// carimbo do lado para conferir. É a régua de 06/08: o app denuncia, não
// contorna.
// ============================================================================

/**
 * 🚨 OS CAMPOS QUE UMA PROJEÇÃO `.select()` PRECISA CARREGAR para que
 * `chegouEmMs` consiga responder.
 *
 * Campo fora da projeção some da leitura, e aí a régua devolve `null` para
 * TODO documento — o recorte viraria "não consegui conferir nenhum", que é
 * indistinguível de "todos chegaram antes". É a régua de 22/08
 * (`projecaoNaoCegaARegua`).
 */
export const CAMPOS_PARA_CHEGADA = Object.freeze([
    'createdAt', 'importadoEm',
]);

/** Um instante, em ms, a partir das formas em que ele é gravado. */
function paraMs(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const t = new Date(v).getTime();
        return Number.isNaN(t) ? null : t;
    }
    // Firestore Timestamp — nas duas formas em que ele chega (SDK e JSON).
    if (typeof v.toMillis === 'function') {
        try { return v.toMillis(); } catch { return null; }
    }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    if (typeof v._seconds === 'number') return v._seconds * 1000;
    return null;
}

/**
 * QUANDO ESTE DOCUMENTO ENTROU NA NOSSA BASE? — em ms, ou `null`.
 *
 * ⚠️ `dhEmi` fica de FORA de propósito, embora a cascata da ORDENAÇÃO da lista
 * o use: ele é **quando a nota foi emitida**, não quando ela chegou aqui. Para
 * ordenar uma tela, aproximar serve; para decidir se um documento entrou antes
 * do corte, ele responde a pergunta ERRADA — a nota do Ceará emitida em 30/08 e
 * capturada em 02/09 passaria pelo corte como se já estivesse na base.
 */
export function chegouEmMs(doc) {
    if (!doc) return null;
    for (const campo of CAMPOS_PARA_CHEGADA) {
        const ms = paraMs(doc[campo]);
        if (ms !== null) return ms;
    }
    return null;
}

/**
 * RECORTA o acervo pelo que o fim de mês congelou.
 *
 * Sem fechamento — ou com a competência REABERTA — devolve tudo, intocado: é o
 * comportamento de hoje, e quem não usar o ato não sente nada.
 *
 * @returns {{
 *   docs: any[],                    // o que entra no livro/arquivo
 *   foraDoCorte: any[],             // chegou DEPOIS — nomeado, nunca sumido
 *   semCarimboDeChegada: any[],     // instante ilegível — FICA, e é dito
 *   corte: string|null,             // o instante, para a frase
 *   documentosNoCarimbo: number|null,
 * }}
 */
export function recortarPeloFechamento(documentos, fechamento) {
    const docs = Array.isArray(documentos) ? documentos : [];
    const vazio = {
        docs, foraDoCorte: [], semCarimboDeChegada: [],
        corte: null, documentosNoCarimbo: null,
    };

    // 'reaberta' é competência ABERTA de novo — recortá-la esconderia
    // justamente a nota que motivou a reabertura.
    if (fechamento?.estado !== 'fechada') return vazio;

    const corte = fechamento?.corte?.instante || null;
    const corteMs = paraMs(corte);
    // Carimbo sem instante legível não recorta nada — e DIZ. Recortar por um
    // corte que não se sabe qual é seria pior que não recortar.
    if (corteMs === null) return { ...vazio, corte };

    const dentro = [];
    const fora = [];
    const semCarimbo = [];
    for (const d of docs) {
        const ms = chegouEmMs(d);
        if (ms === null) { semCarimbo.push(d); dentro.push(d); continue; }
        if (ms > corteMs) fora.push(d);
        else dentro.push(d);
    }

    return {
        docs: dentro,
        foraDoCorte: fora,
        semCarimboDeChegada: semCarimbo,
        corte,
        documentosNoCarimbo: Number.isFinite(Number(fechamento?.corte?.documentos?.total))
            ? Number(fechamento.corte.documentos.total) : null,
    };
}

/**
 * O AVISO do recorte — a causa junto do número.
 *
 * Sem isto, quem conferir o arquivo vê um documento a menos que na Central de
 * XMLs e conclui que a captura falhou. E o número do CARIMBO vai junto: é
 * contra ele que se confere, não contra o acervo de hoje.
 *
 * ⚠️ Nasce VAZIO quando não há fechamento — alarme sobre arquivo normal é o que
 * ensina a equipe a ignorar os avisos que importam.
 */
export function avisosDoRecorte(recorte) {
    const avisos = [];
    if (!recorte?.corte) return avisos;

    const fmt = (iso) => {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pt-BR');
    };

    if (recorte.foraDoCorte.length) {
        avisos.push(
            `🔒 ${recorte.foraDoCorte.length} documento(s) ficaram FORA deste arquivo: eles chegaram `
            + `DEPOIS do fim de mês (${fmt(recorte.corte)}). O arquivo sai com o mesmo acervo que gerou `
            + `os valores fechados`
            + (recorte.documentosNoCarimbo != null ? ` (${recorte.documentosNoCarimbo} documento(s) no carimbo)` : '')
            + '. Para incluí-los, um administrador precisa reabrir a competência na Rotina do mês.',
        );
    }

    if (recorte.semCarimboDeChegada.length) {
        avisos.push(
            `⚠️ ${recorte.semCarimboDeChegada.length} documento(s) não têm registro de QUANDO entraram na base `
            + '— eles foram MANTIDOS no arquivo (tirá-los produziria livro a menor, que é o erro caro). '
            + (recorte.documentosNoCarimbo != null
                ? `Confira o total contra os ${recorte.documentosNoCarimbo} documento(s) do carimbo.`
                : 'Confira o total contra o carimbo do fim de mês.'),
        );
    }

    return avisos;
}
