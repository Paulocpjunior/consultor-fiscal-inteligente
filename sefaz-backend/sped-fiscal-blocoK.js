// ============================================================================
// sefaz-backend/sped-fiscal-blocoK.js
// Bloco K do EFD ICMS/IPI — Controle da Produção e do Estoque.
//
// Registros gerados: K001 · K010 · K100 · K200 · K220 · K230 · K235 · K990.
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

    // 🚨 O CORTE ACONTECE AQUI, E NOS DOIS LADOS JUNTOS (29/08).
    //
    // O módulo do bloco K devolve ARRAYS DE CAMPOS e a casca formata — só que
    // o `buildLine` formata NÚMERO, não corta TEXTO. Resultado medido: o K200
    // saía com `COD_ITEM` e `COD_PART` de 160 caracteres em campos de **060**,
    // que é a recusa "Tamanho do campo inválido" (a família do FANTASIA do
    // 0005 e do COD_ENQ da PWR).
    //
    // ⚠️ E cortar SÓ o que sai não bastaria: o `itensDo0200` é o outro lado da
    // conferência de item órfão, e o 0200 do arquivo já corta em 60. Cortando
    // um lado só, o K200 apontaria para um código que o 0200 declara com outro
    // tamanho — trocaria a recusa de TAMANHO pela de item ÓRFÃO. Os dois lados
    // passam pelo mesmo corte, com o mesmo limite do 0200.
    const cod = (v) => fmt.sanitizeString(v, 60);
    const { linhas, avisos } = montarBlocoK({
        exigencia,
        estoques: (dados?.blocoK?.estoques || []).map((e) => ({
            ...e, codItem: cod(e.codItem), codPart: cod(e.codPart),
        })),
        producao: (dados?.blocoK?.producao || []).map((p) => ({
            ...p, codItem: cod(p.codItem), codPart: cod(p.codPart),
        })),
        // 🚨 K220 — a BAIXA de estoque (30/08, Paulo: *"baixa de estoque no
        // bloco k"*). Os DOIS códigos passam pelo mesmo corte de 60 do 0200,
        // pelo mesmo motivo do K200: cortar um lado só trocaria a recusa de
        // TAMANHO pela de item ÓRFÃO.
        movimentacoes: (dados?.blocoK?.movimentacoes || []).map((m) => ({
            ...m, codItemOri: cod(m.codItemOri), codItemDest: cod(m.codItemDest),
        })),
        dtIni: fmt.formatCompetenciaInicio(dados?.competenciaInicio),
        dtFin: fmt.formatCompetenciaFim(dados?.competenciaFim),
        // O item do K200 tem de existir no 0200 do arquivo — item órfão é
        // recusa do PVA (a família do 0150/0200 sem referência).
        itensDo0200: (dados?.itens || []).map((i) => cod(i.codItem)),
        tipoPorItem: Object.fromEntries((dados?.itens || []).map((i) => [cod(i.codItem), i.tipo])),
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
