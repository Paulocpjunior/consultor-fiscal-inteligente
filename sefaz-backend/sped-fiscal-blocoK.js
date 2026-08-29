// ============================================================================
// sefaz-backend/sped-fiscal-blocoK.js
// Bloco K do EFD ICMS/IPI — Controle da Produção e do Estoque.
//
// Registros gerados: K001 · K010 · K100 · K200 · K230 · K235 · K990.
//
// A DECISÃO (entrega? qual leiaute? o que dá para escriturar?) mora em
// `sped-bloco-k.js`, que é PURO e testado. Aqui só vira LINHA — a mesma
// divisão do bloco H, e pelo mesmo motivo: régua dentro de gerador que puxa
// `fmt` é régua que o jest carrega junto do formatador.
//
// 🚨 REGRA QUE MANDA (lição do bloco H, 06/08): apontamento não informado sai
// como bloco VAZIO, nunca zerado. Bloco vazio diz "não declarei"; bloco zerado
// diz "declarei que não tenho estoque e não produzi", e a segunda é uma
// afirmação falsa que o PVA aceita sem reclamar.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';
import { exigenciaBlocoK, montarBlocoK } from './sped-bloco-k.js';

/** Campos que são QUANTIDADE no bloco K — 3 casas, como no H010. */
const CASAS_QTD = 3;

/**
 * Constrói o Bloco K inteiro.
 *
 * @param {object} dados - mesmo objeto retornado por coletarDadosEmpresa
 * @returns {string[]} array de linhas SPED
 */
export function buildBlocoK(dados) {
    const df = dados?.empresa?.dadosFiscais || {};
    const exigencia = exigenciaBlocoK({
        // O regime decide a DISPENSA do Simples (Resolução CGSN 94) — e ele é
        // o do dono da pergunta, nunca uma leitura nova do cadastro.
        regime: dados?.regime || dados?.empresa?.regime,
        entregaBlocoK: df.entregaBlocoK ?? dados?.empresa?.entregaBlocoK,
        leiauteBlocoK: df.leiauteBlocoK ?? dados?.empresa?.leiauteBlocoK,
    });

    const { linhas, avisos } = montarBlocoK({
        exigencia,
        estoques: dados?.blocoK?.estoques || [],
        producao: dados?.blocoK?.producao || [],
        dtIni: fmt.formatCompetenciaInicio(dados?.competenciaInicio),
        dtFin: fmt.formatCompetenciaFim(dados?.competenciaFim),
        // O item do K200 tem de existir no 0200 do arquivo — item órfão é
        // recusa do PVA (a família do 0150/0200 sem referência).
        itensDo0200: (dados?.itens || []).map((i) => String(i.codItem)),
        tipoPorItem: Object.fromEntries((dados?.itens || []).map((i) => [String(i.codItem), i.tipo])),
    });

    // Os avisos precisam CHEGAR a quem gera: apontamento faltando é coisa para
    // resolver antes de transmitir, não detalhe de log.
    if (Array.isArray(dados?.warnings)) dados.warnings.push(...avisos);
    for (const a of avisos) console.warn(`[bloco-K] ${a}`);

    return linhas.map((campos) => fmt.buildLine(campos.map((v, i) => (
        // A quantidade é o único campo numérico dos registros gerados aqui:
        // K200 campo 04 e K230 campo 06 e K235 campo 04.
        typeof v === 'number' && i > 0 && campos[0] !== 'K990'
            ? fmt.formatValue(v, CASAS_QTD)
            : v
    ))));
}
