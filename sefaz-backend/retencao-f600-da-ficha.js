// ============================================================================
// sefaz-backend/retencao-f600-da-ficha.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 A RETENÇÃO DA FICHA NÃO CHEGAVA AO ARQUIVO — e ele declarava a recolher
// MAIOR que o devido.
//
// 28/08, MONICA MOROMIZATO ENDOCRINOLOGIA 01641443000124 · 07/2026. A Memória
// de Apuração dizia **PIS Retido 64,11 · COFINS Retido 295,86**, e o M200 do
// PVA mostrava **retenção 0,00 · a recolher 157,38** (o devido é 93,27).
//
// A conta fecha centavo a centavo e explica tudo: as notas de tomador **PJ**
// somam 9.862,04 (9.148,99 + 445,59 + 267,46), e 0,65% disso é 64,10 e 3% é
// 295,86 — exatamente o que a ficha declara. Ou seja: **a ficha estava certa**
// e o F600 é que carregou quase nada, porque ele coletava a retenção GRAVADA
// NO DOCUMENTO e só uma nota tinha o campo preenchido.
//
// ⚠️ E essa uma estava errada: `12,44` lançado inteiro como COFINS. Aquele
// valor é **4,65% de 267,46**, ou seja a **CSRF inteira** (PIS + COFINS +
// CSLL) num campo só — a armadilha do `csllOuTotal` (07/08). Declará-lo como
// COFINS retido infla a retenção da COFINS e some com a do PIS.
//
// ═══ POR QUE A FONTE É A FICHA, E NÃO UMA CONTA MINHA ════════════════════════
//
// A ficha é quem alimenta a GUIA que o cliente paga. Se o arquivo calculasse a
// retenção por conta própria, o DARF e o SPED declarariam números diferentes
// sobre o mesmo fato — o defeito que esta casa mais paga (a régua do R-2055:
// *"a ressalva PROÍBE recalcular do outro lado"*). Então o TOTAL vem da ficha,
// e o que este módulo faz é DISTRIBUIR esse total pelas notas, porque o F600 é
// por documento e exige o CNPJ da fonte pagadora.
//
// ⚠️ O QUE ELE NÃO FAZ, de propósito:
//  · não inventa retenção onde a ficha não declarou nada (sem número, sem F600
//    derivado — o caminho antigo, que lê o documento, continua valendo);
//  · não inclui a **CSLL**: o F600 leva só PIS e COFINS (régua de 19/08, do
//    arquivo assinado da HS PROJETOS — somá-la declararia retenção a maior);
//  · não alcança tomador **pessoa física**: retenção do art. 30 da Lei
//    10.833/2003 é de PJ para PJ, e ratear sobre nota de PF poria retenção em
//    documento que não a comporta.
// ============================================================================

// Os DONOS das leituras de documento — nenhuma cópia aqui: o lado, o
// cancelamento, o participante nas duas formas e o valor já têm régua única.
import { normalizarParticipantesDoc } from './dipam-produtor-rural.js';
import { direcaoEfetivaDoc, docCancelado, valorDoDocumento } from './xml-metadata-helper.js';

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const centavos = (v) => Math.round((Number(v) || 0) * 100);

/** A retenção que a FICHA declara para a competência (PIS e COFINS). */
export function retencaoDaFicha(ficha) {
    const pis = Number(ficha?.retencaoPis) || 0;
    const cofins = Number(ficha?.retencaoCofins) || 0;
    return { pis: pis > 0 ? pis : 0, cofins: cofins > 0 ? cofins : 0 };
}

/**
 * As notas que podem ANCORAR uma retenção: saída, não cancelada, com tomador
 * PJ identificado e valor legível.
 *
 * A ordem é DETERMINÍSTICA (maior base primeiro, depois o rótulo) porque o
 * rateio devolve a sobra de centavos ao último — sem ordem fixa, dois arquivos
 * da mesma competência sairiam diferentes.
 */
export function notasQueAncoramRetencao(notas) {
    const out = [];
    for (const cru of (notas || [])) {
        if (docCancelado(cru) || cru?.status === 'denegado') continue;
        if (direcaoEfetivaDoc(cru) !== 'saida') continue;
        const nota = normalizarParticipantesDoc(cru);
        const cnpjFonte = soDigitos(nota.destinatario?.cnpjCpf || nota.destinatario?.cnpj);
        // ⚠️ PJ apenas: 14 dígitos. CPF (11) fica de fora — e CONTADO, porque
        // sumir calado é o que faz alguém achar que declarou tudo.
        if (cnpjFonte.length !== 14) continue;
        const base = valorDoDocumento(nota);
        if (!Number.isFinite(base) || base <= 0) continue;
        out.push({
            numero: String(cru.numero || cru.chave || '(sem número)'),
            data: cru.dataEmissao || cru.dhEmi || null,
            base, cnpjFonte,
        });
    }
    out.sort((a, b) => (b.base - a.base) || a.numero.localeCompare(b.numero, 'pt-BR'));
    return out;
}

/**
 * Rateia um total em centavos proporcionalmente às bases. A soma das partes
 * fecha EXATAMENTE com o total — se o F600 não bater com o M200, o PVA acusa.
 *
 * ⚠️ A SOBRA VAI À MAIOR BASE (a primeira, já que a lista vem ordenada), e aqui
 * ela DIFERE do rateio de desconto do C170, que a devolve ao último item. O
 * motivo é concreto: as notas vêm ordenadas por base DECRESCENTE, então "o
 * último" é a MENOR — e um centavo de sobra numa nota de um centavo declararia
 * retenção de 100% sobre ela. A maior base absorve a sobra sem distorcer.
 */
export function ratearEmCentavos(total, bases) {
    const alvo = centavos(total);
    const soma = bases.reduce((t, b) => t + b, 0);
    if (alvo <= 0 || !(soma > 0) || !bases.length) return bases.map(() => 0);
    const partes = bases.map((b) => Math.floor((alvo * b) / soma));
    const sobra = alvo - partes.reduce((t, p) => t + p, 0);
    partes[0] += sobra;
    return partes;
}

/**
 * Monta os eventos do F600 a partir da retenção declarada na FICHA.
 *
 * @param {object} p
 * @param {Array}  p.notas   documentos do período
 * @param {object} p.ficha   ficha financeira da competência
 * @returns {{eventos: Array, totalPis: number, totalCofins: number, avisos: string[], aplicou: boolean}}
 */
export function montarF600DaFicha({ notas, ficha }) {
    const { pis, cofins } = retencaoDaFicha(ficha);
    const avisos = [];
    if (pis <= 0 && cofins <= 0) {
        return { eventos: [], totalPis: 0, totalCofins: 0, avisos, aplicou: false };
    }

    const ancoras = notasQueAncoramRetencao(notas);
    if (!ancoras.length) {
        // 🚨 RETENÇÃO SEM NOTA QUE A ANCORE: o F600 exige o CNPJ da fonte
        // pagadora, e sem ela não há registro possível. Isso NÃO vira silêncio
        // — o M200 vai declarar a recolher a MAIOR e alguém precisa saber.
        avisos.push(
            `F600: a ficha declara retenção (PIS ${pis.toFixed(2)} · COFINS ${cofins.toFixed(2)}) e NENHUMA `
            + 'nota de saída com tomador PJ foi encontrada para ancorá-la. O F600 exige o CNPJ da fonte '
            + 'pagadora, então os registros não saíram — e o M200/M600 está declarando A MAIOR. Confira a '
            + 'captura das notas ou a retenção lançada na ficha.',
        );
        return { eventos: [], totalPis: 0, totalCofins: 0, avisos, aplicou: false };
    }

    const bases = ancoras.map((n) => n.base);
    const partesPis = ratearEmCentavos(pis, bases);
    const partesCofins = ratearEmCentavos(cofins, bases);

    const eventos = ancoras.map((n, i) => ({
        data: n.data,
        base: n.base,
        pis: partesPis[i] / 100,
        cofins: partesCofins[i] / 100,
        cnpjFonte: n.cnpjFonte,
        numero: n.numero,
        // Carimbo da ORIGEM: número derivado não se apresenta como fato lido do
        // documento. Quem conferir o arquivo depois precisa saber a diferença.
        origem: 'ficha-rateada',
    // Nota que ficou com ZERO nos dois (rateio de um total pequeno entre muitas
    // notas) não vira registro: F600 com valor zero é linha sem conteúdo.
    })).filter((e) => centavos(e.pis) > 0 || centavos(e.cofins) > 0);

    const totalPis = eventos.reduce((t, e) => t + e.pis, 0);
    const totalCofins = eventos.reduce((t, e) => t + e.cofins, 0);

    avisos.push(
        `F600: a retenção veio da FICHA (PIS ${pis.toFixed(2)} · COFINS ${cofins.toFixed(2)}) e foi RATEADA `
        + `entre ${eventos.length} nota(s) de tomador PJ, proporcional à base. Ela NÃO foi lida do documento: `
        + 'a ficha é a mesma fonte da guia que o cliente paga, e calcular aqui faria o DARF e o SPED '
        + 'declararem números diferentes sobre o mesmo fato. A CSLL retida fica fora — o F600 leva só '
        + 'PIS e COFINS.',
    );

    return { eventos, totalPis, totalCofins, avisos, aplicou: true };
}
