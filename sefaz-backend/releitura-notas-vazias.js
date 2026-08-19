// ============================================================================
// sefaz-backend/releitura-notas-vazias.js  (PURO — testável)
// ----------------------------------------------------------------------------
// A NOTA "VAZIA" — sem nº, sem CFOP pela régua e sem CST — e a régua de QUANDO
// a releitura do XML guardado resolve e quando NÃO resolve.
//
// ═══ POR QUE EXISTE (Paulo, 19/08) ══════════════════════════════════════════
//
// Na tela ✏️ CFOP por nota apareceram notas sem número, sem CFOP e sem CST
// (caso PWR/GLOBAL COMPANY, depois outra empresa no mesmo dia). O colaborador
// digitava o CFOP no escuro. Duas causas DIFERENTES, com ações opostas:
//
//   1. O documento é um RESUMO (resNFe, ~531 bytes, sem itens) — o arquivo
//      guardado É o resumo, então reler não inventa item nenhum. A saída é
//      importar o XML COMPLETO (desde 19/08 ele completa a nota por cima do
//      resumo — `resumo-pode-completar`).
//   2. O documento tem o XML COMPLETO guardado mas foi importado por uma
//      versão antiga do leitor, que não extraía os itens — aí a releitura
//      resolve sozinha.
//
// Fundir as duas num botão que "relê tudo" e responde um número só seria o
// alarme sem ação de sempre. Este módulo é a régua que separa, ANTES de
// baixar arquivo, o que cada documento é — e o orquestrador (relerNotasVazias
// no xml-importer) só faz o I/O.
//
// ⚠️ BACKFILL NÃO APAGA (régua de 13/08): o patch só preenche o que está
// VAZIO. Item já gravado e número já gravado nunca são sobrescritos.
//
// 📌 E O NÚMERO SAI DA CHAVE QUANDO FALTA: a chave de acesso carrega o nNF nas
// posições 26-34 (Manual da NF-e — cUF 2 · AAMM 4 · CNPJ 14 · mod 2 · série 3
// · nNF 9 · tpEmis 1 · cNF 8 · DV 1). "A chave não mente" — até o resumo, que
// não tem <nNF>, ganha o número por ela.
// ============================================================================

import { isResumoSchema, isResumoTipoDoc, modeloComItens } from './gravacao-nfe-regua.js';

/**
 * Número da NF extraído da CHAVE de acesso (posições 26-34, 1-indexado).
 * Devolve null quando a chave não tem 44 dígitos — nunca um chute.
 */
export function numeroDaChave(chave) {
    const c = String(chave || '').replace(/\D/g, '');
    if (c.length !== 44) return null;
    const n = c.slice(25, 34).replace(/^0+/, '');
    return n || null;
}

/** O que faz uma nota ser "vazia" na tela: sem itens gravados ou sem número. */
export function ehNotaVazia(d) {
    const temItens = Array.isArray(d?.itens) && d.itens.length > 0;
    return !temItens || !d?.numero;
}

/**
 * Classifica um documento ANTES de qualquer download — cada causa tem ação
 * própria e o resultado do botão responde POR CAUSA.
 *
 * @returns {'fora-do-escopo'|'completa'|'resumo-gravado'|'sem-arquivo'|'alvo'}
 *   fora-do-escopo  não é NF-e/NFC-e (NFS-e, CT-e — itens não vêm de <det>)
 *   completa        já tem itens e número — nada a fazer
 *   resumo-gravado  o arquivo guardado é o resNFe: reler não cria item;
 *                   a ação é importar o XML COMPLETO
 *   sem-arquivo     não há storagePath: buraco de captura, não de leitura
 *   alvo            XML completo guardado — a releitura resolve
 */
export function classificarParaReleitura(d) {
    const tipo = String(d?.tipoDoc || d?.tipo || '');
    // Resumo tem tipoDoc 'resNFe' — a porta é o MODELO da chave, não só o tipo.
    const ehNfe = /^(NFe|NFCe)$/i.test(tipo) || modeloComItens(d?.chave);
    if (!ehNfe) return 'fora-do-escopo';
    if (!ehNotaVazia(d)) return 'completa';
    if (isResumoSchema(d?.schema) || isResumoTipoDoc(d?.tipoDoc)) return 'resumo-gravado';
    if (!d?.storagePath) return 'sem-arquivo';
    return 'alvo';
}

/**
 * Patch da releitura — SÓ preenche o que está vazio.
 *
 * @param {object} d           documento como está no banco
 * @param {object} [lido]      { itens, numero } extraídos do XML guardado
 * @returns {object}           campos a gravar (vazio = nada a fazer)
 */
export function patchDaReleitura(d, { itens, numero } = {}) {
    const patch = {};
    const semItens = !Array.isArray(d?.itens) || !d.itens.length;
    if (semItens && Array.isArray(itens) && itens.length) {
        patch.itens = itens;
        patch.temItens = true;
    }
    const numeroNovo = numero || numeroDaChave(d?.chave);
    if (!d?.numero && numeroNovo) patch.numero = numeroNovo;
    return patch;
}
