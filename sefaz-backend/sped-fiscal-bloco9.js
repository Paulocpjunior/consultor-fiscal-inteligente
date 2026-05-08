// ============================================================================
// sefaz-backend/sped-fiscal-bloco9.js
// Bloco 9 do EFD ICMS/IPI — Controle e Encerramento do Arquivo.
//
// Registros gerados:
//   9001 — Abertura do Bloco 9
//   9900 — Registros do Arquivo (1 por tipo de registro existente)
//   9990 — Encerramento do Bloco 9
//   9999 — Encerramento do Arquivo Digital (com hash MD5 do conteudo)
//
// Esse bloco eh totalmente dinamico: contagem dos registros do arquivo
// inteiro montado pelos blocos anteriores. So pode ser construido APOS
// todos os outros blocos.
//
// Layout: Guia Pratico 3.2.2.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';
import crypto from 'crypto';

/**
 * Constroi o Bloco 9 a partir das linhas dos blocos anteriores.
 *
 * @param {string[]} linhasAnteriores - todas as linhas do arquivo ate aqui
 *                                       (Bloco 0, Bloco C, E, etc).
 * @returns {string[]} array com 9001, 9900s..., 9990, 9999.
 */
function buildBloco9(linhasAnteriores) {
    const linhas = [];

    // 9001 — Abertura
    linhas.push(fmt.buildLine(['9001', '0']));

    // 9900 — Conta cada tipo de registro
    // Inclui as proprias linhas 9900, 9990, 9999 que ainda vamos gerar
    const contagem = contarRegistros(linhasAnteriores);

    // Tipos novos que vao aparecer no Bloco 9 mas nao estao em linhasAnteriores:
    // 9001 (abertura), 9900 (totalizacoes), 9990 (encerramento), 9999 (fim).
    // Os 4 sao tipos novos -> num9900 = tiposDistintos + 4.
    const tiposDistintos = Object.keys(contagem).sort();
    const num9900 = tiposDistintos.length + 4;
    contagem['9001'] = 1;
    contagem['9900'] = num9900;
    contagem['9990'] = 1;
    contagem['9999'] = 1;

    // Gera 9900s ordenados alfabeticamente por tipo
    for (const tipo of Object.keys(contagem).sort()) {
        linhas.push(fmt.buildLine(['9900', tipo, contagem[tipo]]));
    }

    // 9990 — Encerramento Bloco 9
    // Total de linhas do bloco 9: linhas geradas ate agora + 9990 + 9999
    const linhasBloco9 = linhas.length + 2;
    linhas.push(fmt.buildLine(['9990', linhasBloco9]));

    // 9999 — Encerramento do arquivo
    // Total de linhas do arquivo INTEIRO (anteriores + bloco 9)
    const totalLinhas = linhasAnteriores.length + linhas.length + 1;
    linhas.push(fmt.buildLine(['9999', totalLinhas]));

    return linhas;
}

/**
 * Conta quantos registros de cada tipo existem nas linhas.
 * Cada linha tem formato |TIPO|...|, entao TIPO eh o segundo elemento
 * apos o split por |.
 */
function contarRegistros(linhas) {
    const contagem = {};
    for (const linha of linhas) {
        // Linha eh |REG|campo1|...|\r\n
        // Apos split('|'), [0]='', [1]=REG, ...
        const parts = linha.split('|');
        if (parts.length >= 2 && parts[1]) {
            const tipo = parts[1];
            contagem[tipo] = (contagem[tipo] || 0) + 1;
        }
    }
    return contagem;
}

/**
 * Calcula o hash MD5 do conteudo do arquivo (sem o registro 9999),
 * em encoding Windows-1252.
 *
 * NAO eh usado no leiaute 020 atual — o registro 9999 nao tem campo de hash.
 * Mantido aqui caso versao futura volte a exigir.
 */
function calcularHashMD5(conteudo) {
    // Converte string pra Buffer Windows-1252
    const buf = Buffer.from(conteudo, 'latin1');  // latin1 ~ Windows-1252
    return crypto.createHash('md5').update(buf).digest('hex').toUpperCase();
}

export { buildBloco9, calcularHashMD5 };
