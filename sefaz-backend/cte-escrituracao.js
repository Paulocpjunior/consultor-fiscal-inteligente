// ============================================================================
// sefaz-backend/cte-escrituracao.js  (PURO — testável)
// ----------------------------------------------------------------------------
// O CT-e COMO ITEM: o cabeçalho do conhecimento é o único "item" que ele tem,
// e é por ele que o frete passa pela MESMA régua de CFOP, CST e crédito de
// ICMS que a nota de mercadoria.
//
// ═══ O CASO (21/09, EDUARDO GUERRA · tomadora de frete) ═════════════════════
//
// Paulo, depois de o Livro de Entradas abrir no PVA: *"onde posso emitir um
// relatório específico de fretes para conferência? Seria interessante que essas
// informações constassem no Resumo por CFOP. Além disso, onde consigo alterar o
// CST do frete? Nessa empresa não aproveitamos o crédito de ICMS sobre os
// fretes"*.
//
// 📌 MEDIDO ANTES DE ESCREVER, e a resposta era "em lugar nenhum":
//   · o Resumo por CFOP fazia `if (!(d.itens || []).length) continue;` — e o
//     CT-e NÃO TEM `itens[]`: todo conhecimento saía do relatório em SILÊNCIO,
//     enquanto o D100/D190 do SPED o escriturava. Tela e arquivo divergindo;
//   · o Livro de Entradas e a ✏️ CFOP por nota filtravam `['NFe', 'NFCe']` —
//     não havia ONDE informar o CST de um frete;
//   · o D190 lia o CST CRU do cabeçalho (`cstDoCte`) e a base/ICMS dos
//     `totais`, sem olhar o CST informado nem a régua de crédito
//     (`entradaGeraCreditoIcms`) — a mesma que o C170/C190 honram desde 09/09.
//
// ═══ A DECISÃO: NÃO NASCE UMA SEGUNDA RÉGUA ═════════════════════════════════
//
// O frete tomado é uma ENTRADA como qualquer outra: quem escritura decide se
// credita (regime) e o que informou na nota vence (CST informado). Essa régua
// já existe, provada por PVA, para o ITEM da nota de mercadoria — em
// `sped-fiscal-blocoC.js` (`icmsDoItemNoArquivo`/`cstDoItemNoArquivo`) e em
// `alocarTributacaoIcms` (Livro e Resumo). Escrever uma versão "para CT-e"
// seria a segunda cópia, que diverge no primeiro ajuste (a lição do C190 ×
// E110, 11/09).
//
// Por isso `itemSinteticoDoCte` traduz o cabeçalho para a FORMA do item, e os
// leitores passam por ele: o D190, o Livro, o Resumo por CFOP e a ✏️ leem o
// MESMO item — um dono só.
//
// ⚠️ O QUE ESTE MÓDULO NÃO FAZ: não decide CST (é `cstDoLancamento`), não
// decide crédito (é `entradaGeraCreditoIcms`/`colunaDoCstInformado`) e não
// decide CFOP (é `cfopDoLancamento`). Ele só diz COMO o CT-e se apresenta a
// essas réguas.
// ============================================================================

import { valorDoDocumento } from './xml-metadata-helper.js';
import { ehConhecimentoDeTransporte } from './sped-selecao-documentos.js';

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/** CFOP do CT-e — cabeçalho (onde o CT-e o guarda) ou 1º item. Vazio = não sei. */
export function cfopDoCte(nota) {
    const cru = soDigitos(nota?.cfop || nota?.CFOP || (nota?.itens || [])[0]?.cfop || '');
    return cru.length === 4 ? cru : '';
}

/** CST de ICMS do CT-e — mesma ideia; '' quando o documento não diz. */
export function cstDoCte(nota) {
    const cru = soDigitos(nota?.cstIcms || nota?.cst || (nota?.itens || [])[0]?.cst || '');
    return cru ? cru : '';
}

/**
 * CST que o D190 usava quando o cabeçalho não declara nenhum: **90 (Outras)**.
 *
 * ⚠️ É o comportamento que o gerador tinha desde 21/08 (`cstDoCte(nota) ||
 * '090'`) e ele NÃO muda aqui: trocar o default é mudar VALOR de arquivo
 * fiscal, e isso se faz com o número na frente do dono. CT-e capturado antes
 * do 🚚 (17/09) está gravado sem `cstIcms`; o 🚚 Reler cabeçalho recupera.
 */
export const CST_CTE_SEM_CABECALHO = '90';

/**
 * O CT-e na FORMA do item da nota de mercadoria.
 *
 * Os campos são os que `alocarTributacaoIcms` (Livro/Resumo) e
 * `icmsDoItemNoArquivo`/`cstDoItemNoArquivo` (bloco C) leem: `cfop`, `cst`,
 * `vProd`, `vBC`, `vICMS`, `aliqIcms`. Sem `nItem` de propósito — o CT-e não
 * tem escrituração POR ITEM, então `escrituracaoDoItem` devolve null e a
 * precedência cai no CST/CFOP informado NA NOTA (`cstEscriturado`/
 * `cfopEscriturado`), que é o campo que a ✏️ grava.
 *
 * ⚠️ AUSENTE ≠ ZERO: `vBC`/`vICMS` que o cabeçalho não traz ficam ausentes
 * (o leitor lê 0 na falta); `aliqIcms` idem. Zero DECLARADO entra — o EFD de
 * 05/2026 da EDUARDO GUERRA (e-Fiscal, ACEITO) sai com CST 090, alíquota 0 e
 * ICMS 0 nos 34 CT-e.
 */
export function itemSinteticoDoCte(nota) {
    const t = nota?.totais || {};
    const item = {
        sintetico: 'cte',
        cfop: cfopDoCte(nota),
        cst: cstDoCte(nota) || CST_CTE_SEM_CABECALHO,
        descricao: 'Serviço de transporte (CT-e)',
        vProd: valorDoDocumentoOuZero(nota),
        vDesc: 0,
    };
    if (t.vBC !== undefined && t.vBC !== null && t.vBC !== '') item.vBC = Number(t.vBC) || 0;
    if (t.vICMS !== undefined && t.vICMS !== null && t.vICMS !== '') item.vICMS = Number(t.vICMS) || 0;
    if (nota?.aliqIcms !== undefined && nota?.aliqIcms !== null && nota?.aliqIcms !== '') {
        item.aliqIcms = Number(nota.aliqIcms) || 0;
    }
    return item;
}

/**
 * "Este item é o sintético de um CT-e?" — é por AQUI que um leitor que já
 * recebeu os itens (Resumo por CFOP) sabe que a linha é frete, sem voltar a
 * julgar a espécie do documento por conta própria (a espécie tem UM dono, e a
 * varredura do R-4020 barra a segunda cópia dela em `relatoriosAgregacoes`).
 */
export function ehItemSinteticoDeCte(item) {
    return !!item && item.sintetico === 'cte';
}

function valorDoDocumentoOuZero(nota) {
    const v = valorDoDocumento(nota);
    return Number.isFinite(v) ? v : 0;
}

/**
 * Os "itens" que a escrituração deve ler de um documento: os dele, ou o
 * sintético quando é conhecimento de transporte.
 *
 * É a porta dos leitores de TELA (Livro, Resumo por CFOP, ✏️): eles trocam
 * `d.itens || []` por `itensParaEscriturar(d)` e o CT-e passa a existir
 * neles sem nenhum `if` de CT-e espalhado. Documento sem itens e sem ser
 * CT-e continua devolvendo `[]` — ausência não vira item inventado.
 */
export function itensParaEscriturar(doc) {
    if (ehConhecimentoDeTransporte(doc)) return [itemSinteticoDoCte(doc)];
    return Array.isArray(doc?.itens) ? doc.itens : [];
}

/**
 * Quanto de ICMS o CT-e DESTACA — o número que o aviso da geração diz quando a
 * escrituração o tira do crédito. `0` quando não há destaque.
 */
export function icmsDestacadoDoCte(nota) {
    const v = Number(nota?.totais?.vICMS);
    return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Aviso da geração: CT-e que saíram SEM crédito, por CAUSA.
 *
 * Duas causas com ações diferentes, ditas separadas: o CST INFORMADO na nota
 * (decisão de quem escritura — o caminho de volta é a ✏️) e o REGIME (optante
 * não se credita — LC 123 art. 23). Nasce MUDO quando o conhecimento não
 * destaca ICMS: zerar o que já era zero não é notícia, e alarme sobre arquivo
 * correto é o jeito conhecido de a equipe ignorar o aviso que importa.
 *
 * @param {Array<{numero: string, destacado: number, por: 'informado'|'regime'}>} semCredito
 * @param {string} [regime]
 * @returns {string[]}
 */
export function avisosDeCteSemCredito(semCredito, regime = '') {
    const dinheiro = (v) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const avisos = [];
    const porCausa = { informado: [], regime: [] };
    for (const c of semCredito || []) {
        if (!(Number(c?.destacado) > 0)) continue;
        (porCausa[c.por] || porCausa.informado).push(c);
    }
    const lista = (cs) => cs.slice(0, 10).map((c) => c.numero).join(', ') + (cs.length > 10 ? ` e mais ${cs.length - 10}` : '');
    const soma = (cs) => cs.reduce((s, c) => s + (Number(c.destacado) || 0), 0);
    if (porCausa.informado.length) {
        avisos.push(
            `Bloco D: ${porCausa.informado.length} CT-e saíram SEM crédito de ICMS por CST INFORMADO na nota `
            + `(D190 com CST x90/x40, base e ICMS zero) — nº ${lista(porCausa.informado)}. `
            + `R$ ${dinheiro(soma(porCausa.informado))} destacados pelo transportador ficam FORA do crédito, `
            + 'por decisão de quem escriturou (Relatórios → ✏️ CFOP por nota, coluna CST informado — '
            + 'limpar o campo devolve o conhecimento ao destaque do documento). É o mesmo que o Livro de '
            + 'Entradas e o Resumo por CFOP do CFI mostram.',
        );
    }
    if (porCausa.regime.length) {
        avisos.push(
            `Bloco D: ${porCausa.regime.length} CT-e saíram SEM crédito de ICMS (CST x90, base e ICMS zero — `
            + `R$ ${dinheiro(soma(porCausa.regime))} destacados pelo transportador) porque a empresa é `
            + `${regime === 'SIMPLES' ? 'optante do Simples Nacional' : regime || 'de regime sem crédito'} `
            + 'e não se credita (LC 123/2006, art. 23) — nº ' + lista(porCausa.regime) + '. '
            + 'Para creditar um conhecimento de propósito, informe o CST na nota (✏️).',
        );
    }
    return avisos;
}
