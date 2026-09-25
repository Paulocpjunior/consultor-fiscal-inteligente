// ============================================================================
// sefaz-backend/sped-contrib-m400.js  (PURO — testável)
// ----------------------------------------------------------------------------
// M400/M410 (PIS) e M800/M810 (COFINS): a RECEITA SEM ÔNUS — alíquota zero,
// monofásica na revenda, isenta, sem incidência, suspensa — detalhada por
// NATUREZA DA RECEITA.
//
// ═══ O CASO (Paulo, 25/09, EDUARDO GUERRA HORTIFRUTI 08/2026) ═══════════════
//
// PVA: *"Deverá existir um registro M400/M800 para cada CST informados nos
// documentos com CST igual a 04, 06, 07, 08 ou 09"* — 2 erros (PIS e COFINS).
// O arquivo do CFI tinha 6.859 itens de saída com CST 06 (hortifrúti,
// alíquota zero, R$ 4.293.206,20) e bloco M só com M200/M600 zerados.
//
// O EFD ACEITO da mesma empresa em 07/2026 (gerado por outro sistema) é o
// espelho: |M400|06|3944824,4||| + |M410|116|3944824,4||| e o mesmo par no
// M800/M810 — VL_TOT_REC = Σ VL_ITEM dos C170 de SAÍDA com aquele CST, um
// M410 por natureza, COD_CTA e DESC_COMPL vazios.
//
// ═══ A REGRA DA CASA: A NATUREZA É CADASTRO, NUNCA CHUTE ═════════════════════
//
// O código do M410 vem das tabelas da RFB (4.3.13 para CST 06, etc.) e depende
// do PRODUTO — hortifrúti é um código, farinha é outro, livro é outro. O app
// não deduz: quem sabe é a pessoa, e cadastra por empresa e por CST. Sem
// cadastro, o registro NÃO sai (M400 sem M410 é inválido) e o aviso diz o
// valor, o CST, a tabela e ONDE cadastrar. Código provado em arquivo aceito
// entra só como SUGESTÃO no aviso — nunca como default.
// ============================================================================

import { receitaDoItem } from './base-pis-cofins.js';
import * as fmt from './sped-fiscal-format.js';

/** CSTs de saída SEM ônus que o PVA exige no M400/M800 (Guia 1.35, M400). */
export const CSTS_SEM_ONUS = ['04', '06', '07', '08', '09'];

/** Tabela da RFB que dá o código do M410/M810 para cada CST (Guia 1.35, M410 campo 02). */
export const TABELA_NAT_REC_POR_CST = {
    '04': '4.3.10 / 4.3.11 (monofásica, revenda a alíquota zero)',
    '06': '4.3.13 (alíquota zero)',
    '07': '4.3.14 (isenção)',
    '08': '4.3.15 (sem incidência)',
    '09': '4.3.16 (suspensão)',
};

/**
 * Códigos PROVADOS em arquivo aceito — só sugestão, nunca default.
 * EDUARDO GUERRA HORTIFRUTI 07/2026 (EFD assinado, outro sistema).
 */
export const SUGESTOES_PROVADAS = {
    '06': [{ natRec: '116', quando: 'hortifrúti (produtos hortícolas, frutas e ovos a alíquota zero)', prova: 'EFD aceito da EDUARDO GUERRA HORTIFRUTI 07/2026' }],
    '08': [{ natRec: '999', quando: 'outras operações sem incidência', prova: 'EFD aceito da EDUARDO GUERRA HORTIFRUTI 07/2026' }],
};

const cst2 = (v) => String(v || '').padStart(2, '0');

/**
 * Soma a receita de SAÍDA por CST sem ônus, PIS e COFINS separados (o item
 * pode ter CST diferente em cada contribuição).
 *
 * @param {Array} notas
 * @param {object} p
 * @param {(item, regime, direcao) => string} p.getCstPis
 * @param {(item, regime, direcao) => string} p.getCstCofins
 * @param {(nota) => string} p.direcaoDoDoc  'saida' | 'entrada'
 * @param {(nota) => boolean} p.docFora      cancelado/denegado
 * @param {string} p.regimeApuracao
 * @returns {{pis: Object<string,{valor:number,itens:number,docs:Set}>, cofins: Object}}
 */
export function acumularReceitaSemOnus(notas, { getCstPis, getCstCofins, direcaoDoDoc, docFora, regimeApuracao }) {
    const pis = {}, cofins = {};
    const soma = (balde, cst, valor, docId) => {
        if (!CSTS_SEM_ONUS.includes(cst)) return;
        const b = balde[cst] || (balde[cst] = { valor: 0, itens: 0, docs: new Set() });
        b.valor += valor; b.itens += 1; b.docs.add(docId);
    };
    for (const nota of (notas || [])) {
        if (!nota || (docFora && docFora(nota))) continue;
        if (direcaoDoDoc(nota) !== 'saida') continue;
        const docId = String(nota.chave || nota.numero || nota.id || '');
        for (const item of (nota.itens || [])) {
            const valor = receitaDoItem(item);
            soma(pis, cst2(getCstPis(item, regimeApuracao, 'saida')), valor, docId);
            soma(cofins, cst2(getCstCofins(item, regimeApuracao, 'saida')), valor, docId);
        }
    }
    return { pis, cofins };
}

/** Confere UM cadastro {cst: {natRec, descricao}} antes de gravar. */
export function conferirCadastroNaturezaReceita(cadastro) {
    const erros = [];
    const limpo = {};
    for (const [cstCru, v] of Object.entries(cadastro || {})) {
        const cst = cst2(cstCru);
        if (!CSTS_SEM_ONUS.includes(cst)) { erros.push(`CST ${cstCru} não é de receita sem ônus (só ${CSTS_SEM_ONUS.join(', ')}).`); continue; }
        const natRec = String((v && v.natRec) || '').trim();
        const descricao = String((v && v.descricao) || '').trim().slice(0, 120);
        if (!natRec) continue; // linha em branco = sem cadastro para este CST
        if (!/^\d{3}$/.test(natRec)) { erros.push(`CST ${cst}: o código da natureza da receita tem 3 dígitos (tabela ${TABELA_NAT_REC_POR_CST[cst]}) — veio "${natRec}".`); continue; }
        limpo[cst] = { natRec, descricao };
    }
    return { ok: erros.length === 0, erros, cadastro: limpo };
}

const brl = (v) => Number(v || 0).toFixed(2);

/**
 * Monta as linhas do M400/M410 OU do M800/M810.
 *
 * @param {object} p
 * @param {'pis'|'cofins'} p.contribuicao
 * @param {Object} p.porCst      saída de acumularReceitaSemOnus()[contribuicao]
 * @param {Object} p.cadastro    {cst: {natRec, descricao}}
 * @param {string[]} p.warnings  recebe o aviso do que ficou de fora
 * @returns {string[]} linhas prontas (fmt.buildLine)
 */
export function montarReceitaSemOnus({ contribuicao, porCst, cadastro = {}, warnings = [] }) {
    const pai = contribuicao === 'cofins' ? 'M800' : 'M400';
    const filho = contribuicao === 'cofins' ? 'M810' : 'M410';
    const linhas = [];
    for (const cst of CSTS_SEM_ONUS) {
        const b = porCst && porCst[cst];
        if (!b || !(b.valor > 0)) continue;
        const cad = conferirCadastroNaturezaReceita({ [cst]: cadastro[cst] }).cadastro[cst];
        if (!cad) {
            const sug = (SUGESTOES_PROVADAS[cst] || []).map((s) => `${s.natRec} = ${s.quando} (${s.prova})`).join('; ');
            warnings.push(
                `🚨 ${pai}/${filho} NÃO saiu para o CST ${cst}: R$ ${brl(b.valor)} de receita de saída em ${b.itens} item(ns) de `
                + `${b.docs.size} documento(s) sem NATUREZA DA RECEITA cadastrada — o PVA recusa o arquivo ("Deverá existir um `
                + `registro M400/M800 para cada CST informados nos documentos com CST igual a 04, 06, 07, 08 ou 09"). `
                + `Cadastre o código da tabela ${TABELA_NAT_REC_POR_CST[cst]} em SPED Fiscal → SPED Contribuições → `
                + `"Natureza da receita sem ônus (M410/M810)" e gere de novo.${sug ? ` Código já provado em arquivo aceito: ${sug}.` : ''}`,
            );
            continue;
        }
        // Espelho do aceito: |M400|06|3944824,4||| + |M410|116|3944824,4|||
        linhas.push(fmt.buildLine([pai, cst, fmt.formatValue(b.valor), '', '']));
        linhas.push(fmt.buildLine([filho, cad.natRec, fmt.formatValue(b.valor), '', cad.descricao || '']));
    }
    return linhas;
}
