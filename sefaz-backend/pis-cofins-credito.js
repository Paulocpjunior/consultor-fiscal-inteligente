// ============================================================================
// sefaz-backend/pis-cofins-credito.js  (PURO — sem io, testável)
// ----------------------------------------------------------------------------
// A BASE DE CRÉDITO DE PIS/COFINS NÃO-CUMULATIVO, DERIVADA DOS DOCUMENTOS.
//
// POR QUE EXISTE (caso WALDESA, 12/08/2026 — docs/achados-apuracao-piscofins-
// planilha.md): a apuração vivia numa planilha que aplicava 1,65% e 7,6% sobre
// a CONTA CONTÁBIL inteira de "COMPRAS MERCADORIAS". Só em junho/2025 isso deu
// R$ 451.611,87 de crédito sobre R$ 4.882.290,45, SEM nenhum filtro.
//
// O regime não-cumulativo NÃO credita por conta contábil — credita por
// OPERAÇÃO (Lei 10.637/2002 art. 3º e Lei 10.833/2003 art. 3º). Ficam de fora,
// entre outros: compra de fornecedor optante do SIMPLES, mercadoria
// MONOFÁSICA, mercadoria com ST já encerrada e itens com CST de aquisição sem
// direito a crédito. Todos eles moram dentro daquela mesma conta.
//
// ─── O QUE ESTE MÓDULO NÃO FAZ ──────────────────────────────────────────────
//
// Ele NÃO devolve "a base é X". Ele devolve TRÊS montantes:
//
//   creditaConfirmado  — o documento PROVA que credita (tem CST de PIS)
//   naoCreditaConfirmado — o documento PROVA que não credita
//   indefinido         — o documento não diz, e o app NÃO CHUTA
//
// O terceiro é o mais importante, e é o oposto do que a planilha fazia. Nota
// capturada ANTES de 12/08/2026 não tem `cstPis`/`cstCofins` (o importer só
// lia valor — a mesma armadilha do CST do IPI, #563). Para essas, o módulo usa
// INDÍCIOS do próprio documento (CSOSN do fornecedor, CFOP de ST) — que provam
// a NEGATIVA com segurança, mas nunca a positiva: CFOP de compra comum não
// prova direito a crédito, porque o CST pode ser 70-75.
//
// Tratar "não sei" como "credita" é exatamente o erro da planilha, com outro
// nome. Por isso `indefinido` sai separado e a tela mostra o tamanho dele: é a
// medida de quanto do crédito ainda não tem prova documental.
//
// ─── COMO SE TIRA A DÚVIDA ──────────────────────────────────────────────────
//
// O XML cru está no Cloud Storage (`storagePath` de cada documento), então o
// `indefinido` se resolve com BACKFILL — reprocessar os XMLs já capturados
// para gravar cstPis/cstCofins. Não precisa recapturar da SEFAZ.
// ============================================================================

/**
 * CST de PIS/COFINS na ENTRADA — Tabela 4.3.3 do SPED Contribuições.
 * A faixa é o que a lei diz; onde o código não está mapeado, o veredito é
 * 'indefinido' (nunca um default otimista).
 */
export const CST_CREDITA = new Set(['50', '51', '52', '53', '54', '55', '56']);
/** 60-66: crédito PRESUMIDO — existe, mas depende de parâmetro do cliente. */
export const CST_CREDITO_PRESUMIDO = new Set(['60', '61', '62', '63', '64', '65', '66']);
/** 70-75: aquisição SEM direito a crédito. */
export const CST_NAO_CREDITA = new Set(['70', '71', '72', '73', '74', '75']);

/**
 * CSOSN — só existe em nota de optante do SIMPLES NACIONAL. A presença dele
 * IDENTIFICA o fornecedor, e compra de optante não gera crédito de PIS/COFINS
 * para o adquirente. É prova NEGATIVA forte e independe do CST de PIS.
 */
const CSOSN = new Set(['101', '102', '103', '201', '202', '203', '300', '400', '500', '900']);

/**
 * CFOP de entrada cuja mercadoria já teve o ciclo encerrado por ST — o
 * adquirente não credita PIS/COFINS sobre revenda de ST/monofásico.
 */
const CFOP_ST_ENCERRADA = new Set(['1403', '1404', '1410', '1411', '2403', '2404', '2410', '2411']);

/** CFOP de entrada que NÃO é aquisição para revenda/insumo (não entra na base). */
const CFOP_FORA_DA_BASE = new Set([
    '1201', '1202', '2201', '2202', // devolução de venda (entra por outra linha)
    '1553', '2553',                 // devolução de compra de ativo
    '1949', '2949',                 // outra entrada não especificada
]);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const txt = (v) => String(v ?? '').trim();

/**
 * Classifica UM item de uma nota de entrada.
 *
 * @returns {{veredito:'credita'|'nao-credita'|'presumido'|'indefinido',
 *            motivo:string, prova:'documento'|'indicio', valor:number}}
 */
export function classificarItemCredito(item) {
    const valor = num(item?.vProd);
    const cfop = txt(item?.cfop);
    const cstPis = txt(item?.cstPis);
    const cstIcms = txt(item?.cst);

    if (CFOP_FORA_DA_BASE.has(cfop)) {
        return {
            veredito: 'nao-credita', prova: 'documento', valor,
            motivo: `CFOP ${cfop} não é aquisição para revenda/insumo`,
        };
    }

    // 1) O CST de PIS é a prova. Só ele decide na positiva.
    if (cstPis) {
        if (CST_CREDITA.has(cstPis)) {
            return { veredito: 'credita', prova: 'documento', valor, motivo: `CST PIS ${cstPis}` };
        }
        if (CST_CREDITO_PRESUMIDO.has(cstPis)) {
            return {
                veredito: 'presumido', prova: 'documento', valor,
                motivo: `CST PIS ${cstPis} — crédito presumido, depende de parâmetro do cliente`,
            };
        }
        if (CST_NAO_CREDITA.has(cstPis)) {
            return { veredito: 'nao-credita', prova: 'documento', valor, motivo: `CST PIS ${cstPis} — aquisição sem direito a crédito` };
        }
        return {
            veredito: 'indefinido', prova: 'documento', valor,
            motivo: `CST PIS ${cstPis} fora das faixas conhecidas (50-56, 60-66, 70-75) — conferir`,
        };
    }

    // 2) Sem CST de PIS (nota capturada antes de 12/08/2026): INDÍCIOS provam
    //    só a negativa. Nunca a positiva.
    if (CSOSN.has(cstIcms)) {
        return {
            veredito: 'nao-credita', prova: 'indicio', valor,
            motivo: `fornecedor optante do Simples (CSOSN ${cstIcms}) — não gera crédito`,
        };
    }
    if (CFOP_ST_ENCERRADA.has(cfop)) {
        return {
            veredito: 'nao-credita', prova: 'indicio', valor,
            motivo: `CFOP ${cfop} — mercadoria com ST/monofásica, ciclo encerrado`,
        };
    }

    return {
        veredito: 'indefinido', prova: 'indicio', valor,
        motivo: 'nota capturada sem o CST de PIS/COFINS — reprocessar o XML para decidir',
    };
}

/**
 * Apura a base de crédito de uma lista de documentos de ENTRADA.
 *
 * NUNCA soma `indefinido` ao que credita. O total do indefinido é o tamanho da
 * dúvida, e é ele que diz se o número já pode ser usado.
 *
 * @param {Array} docs documentos de entrada (cada um com `itens[]`)
 * @returns {{baseConfirmada:number, baseNaoCredita:number, basePresumido:number,
 *            baseIndefinida:number, totalEntradas:number,
 *            porMotivo:Array, itensSemCst:number, totalItens:number,
 *            confiavel:boolean}}
 */
export function apurarBaseCredito(docs = []) {
    const acc = {
        baseConfirmada: 0, baseNaoCredita: 0, basePresumido: 0, baseIndefinida: 0,
        totalEntradas: 0, itensSemCst: 0, totalItens: 0,
    };
    const motivos = new Map();

    for (const doc of docs) {
        for (const item of (doc?.itens || [])) {
            const r = classificarItemCredito(item);
            acc.totalItens += 1;
            acc.totalEntradas += r.valor;
            if (!txt(item?.cstPis)) acc.itensSemCst += 1;

            if (r.veredito === 'credita') acc.baseConfirmada += r.valor;
            else if (r.veredito === 'presumido') acc.basePresumido += r.valor;
            else if (r.veredito === 'nao-credita') acc.baseNaoCredita += r.valor;
            else acc.baseIndefinida += r.valor;

            const chave = `${r.veredito}|${r.motivo}`;
            const m = motivos.get(chave) || { veredito: r.veredito, motivo: r.motivo, prova: r.prova, valor: 0, itens: 0 };
            m.valor += r.valor; m.itens += 1;
            motivos.set(chave, m);
        }
    }

    const round = (n) => Number(n.toFixed(2));
    return {
        baseConfirmada: round(acc.baseConfirmada),
        baseNaoCredita: round(acc.baseNaoCredita),
        basePresumido: round(acc.basePresumido),
        baseIndefinida: round(acc.baseIndefinida),
        totalEntradas: round(acc.totalEntradas),
        totalItens: acc.totalItens,
        itensSemCst: acc.itensSemCst,
        porMotivo: Array.from(motivos.values()).sort((a, b) => b.valor - a.valor),
        // Farol honesto: com indefinido no meio, o número NÃO fecha apuração.
        confiavel: acc.totalItens > 0 && acc.baseIndefinida === 0,
        // A base derivada é PARCIAL por construção — energia, aluguel PJ e
        // depreciação geram crédito e não chegam como documento capturável.
        // Viaja no resultado pra nenhuma tela poder omitir.
        naoIncluido: CREDITOS_FORA_DO_DOCUMENTO,
    };
}

/**
 * O QUE ESTA DERIVAÇÃO **NÃO** COBRE — e por que isso tem que sair na tela.
 *
 * Paulo (12/08): *"todos os impostos já estão contidos nas NFs e XMLs, nada é
 * imputado na mão"*. Verdade sobre os IMPOSTOS — e é o que permite o app ser
 * fonte única da base de mercadorias. Mas a BASE DE CRÉDITO do não-cumulativo
 * tem itens cujo DOCUMENTO não chega ao CFI: o DistDFe da SEFAZ distribui
 * NF-e (55), NFC-e (65) e CT-e (57) — não distribui conta de energia, e aluguel
 * nem documento fiscal eletrônico tem.
 *
 * Consequência que MANDA no uso deste módulo: a base derivada sai
 * SISTEMATICAMENTE MENOR que a base legal correta. Comparar com a apuração do
 * colaborador sem dizer isso acusaria excesso de crédito onde pode haver
 * simplesmente crédito legítimo fora do alcance da captura — o erro mais caro
 * que uma conferência pode cometer.
 *
 * Por isso a lista viaja no resultado: quem mostra o número é obrigado a mostrar
 * o que ele não inclui.
 */
export const CREDITOS_FORA_DO_DOCUMENTO = [
    { item: 'Energia elétrica', baseLegal: 'Lei 10.833/03 art. 3º, IX', porque: 'a conta de energia (NF3e/mod. 66) não vem no DistDFe' },
    { item: 'Aluguel de prédios/máquinas pagos a PJ', baseLegal: 'Lei 10.833/03 art. 3º, IV e V', porque: 'contrato/recibo — não é documento fiscal eletrônico' },
    { item: 'Depreciação de bens do ativo imobilizado', baseLegal: 'Lei 10.833/03 art. 3º, VI', porque: 'é apuração contábil, não documento' },
    { item: 'Arrendamento mercantil pago a PJ', baseLegal: 'Lei 10.833/03 art. 3º, V', porque: 'contrato — não é documento fiscal' },
    { item: 'Armazenagem e frete na OPERAÇÃO DE VENDA', baseLegal: 'Lei 10.833/03 art. 3º, IX', porque: 'só entra se o CT-e foi capturado; serviço faturado por NFS-e não vem no DistDFe' },
];

/** Alíquotas do não-cumulativo (Lei 10.637/02 e Lei 10.833/03). */
export const ALIQ_PIS = 0.0165;
export const ALIQ_COFINS = 0.076;

/**
 * Confronta a base derivada dos documentos com a base que foi USADA na
 * apuração (a da planilha, no caso WALDESA).
 *
 * A diferença NÃO é veredito de erro: pode ser crédito indevido do lado de lá,
 * mas também captura incompleta do lado de cá. Por isso a resposta diz as duas
 * leituras — mesma régua do espelho CFI × E-Fiscal.
 */
export function compararComBaseUsada(apuracao, baseUsada) {
    const usada = num(baseUsada);
    const diferenca = Number((usada - apuracao.baseConfirmada).toFixed(2));
    const creditoUsado = Number((usada * (ALIQ_PIS + ALIQ_COFINS)).toFixed(2));
    const creditoConfirmado = Number((apuracao.baseConfirmada * (ALIQ_PIS + ALIQ_COFINS)).toFixed(2));

    let leitura;
    if (Math.abs(diferenca) < 0.01) leitura = 'bate';
    else if (diferenca > 0) {
        leitura = apuracao.baseIndefinida > 0
            ? 'a-maior-com-duvida'   // pode ser crédito indevido OU falta de CST aqui
            : 'a-maior';            // sem dúvida: creditou mais do que o documento prova
    } else {
        leitura = 'a-menor';        // creditou menos do que teria direito
    }

    return {
        baseUsada: usada,
        baseConfirmada: apuracao.baseConfirmada,
        baseIndefinida: apuracao.baseIndefinida,
        diferenca,
        creditoUsado,
        creditoConfirmado,
        diferencaCredito: Number((creditoUsado - creditoConfirmado).toFixed(2)),
        leitura,
        /** Ação em texto — o número sozinho não diz o que fazer. */
        acao: leitura === 'bate'
            ? 'A base usada bate com o que os documentos provam.'
            : leitura === 'a-maior-com-duvida'
                ? 'A base usada é maior que a comprovada, MAS há entradas sem CST de PIS/COFINS. '
                  + 'Reprocesse os XMLs (o arquivo está no Storage) antes de concluir que houve crédito indevido.'
                : leitura === 'a-maior'
                    ? 'A base usada é maior que a que os documentos comprovam. ATENÇÃO ANTES DE CONCLUIR '
                      + 'crédito indevido: energia elétrica, aluguel de PJ e depreciação GERAM crédito e '
                      + 'NÃO chegam como documento capturável — a diferença pode ser exatamente isso. '
                      + 'Confira a lista `naoIncluido` e só então o item a item.'
                    : 'A base usada é MENOR que a comprovada — pode haver crédito não aproveitado.',
    };
}
