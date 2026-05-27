// ============================================================================
// sefaz-backend/sped-contrib-bloco0.js
// Bloco 0 do EFD Contribuicoes (PIS/COFINS) — Abertura, Identificacao e
// Referencias.
//
// Registros gerados:
//   0000 — Abertura do Arquivo Digital
//   0001 — Abertura do Bloco 0
//   0100 — Dados do Contabilista
//   0110 — Regimes de Apuracao da Contribuicao e do Credito
//   0140 — Tabela de Cadastro de Estabelecimentos
//   0150 — Tabela de Cadastro do Participante
//   0190 — Identificacao das Unidades de Medida
//   0200 — Tabela de Identificacao do Item
//   0990 — Encerramento do Bloco 0
//
// Layout: Guia Pratico EFD Contribuicoes 1.35, versao 006 (vigente 2026).
// ============================================================================

import * as fmt from './sped-fiscal-format.js';

const COD_VER = '006';  // Versao 006 vigente desde 01/01/2026

/**
 * Constroi o Bloco 0 inteiro pro EFD Contribuicoes.
 *
 * @param {object} dados - dados coletados pelo orchestrator
 * @returns {string[]} array de linhas SPED
 */
function buildBloco0Contrib(dados) {
    const linhas = [];

    // ── 0000 — Abertura ─────────────────────────────────────────────────
    linhas.push(build0000(dados));

    // ── 0001 — Abertura do Bloco 0 ──────────────────────────────────────
    linhas.push(fmt.buildLine(['0001', '0']));  // 0 = Bloco COM dados

    // ── 0100 — Contabilista ─────────────────────────────────────────────
    linhas.push(build0100(dados));

    // ── 0110 — Regime de Apuracao ───────────────────────────────────────
    linhas.push(build0110(dados));

    // ── 0140 — Estabelecimentos ─────────────────────────────────────────
    linhas.push(build0140(dados));

    // ── 0150 — Participantes ────────────────────────────────────────────
    for (const p of dados.participantes || []) {
        linhas.push(build0150(p));
    }

    // ── 0190 — Unidades de Medida ───────────────────────────────────────
    for (const u of dados.unidades || []) {
        linhas.push(build0190(u));
    }

    // ── 0200 — Itens (produtos/servicos) ────────────────────────────────
    for (const item of dados.itens || []) {
        linhas.push(build0200(item));
    }

    // ── 0990 — Encerramento do Bloco 0 ──────────────────────────────────
    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['0990', totalBloco]));

    return linhas;
}

/**
 * 0000 — Abertura do Arquivo Digital (EFD Contribuicoes)
 *
 * Campos:
 *  01 REG               '0000'
 *  02 COD_VER           Versao do leiaute ('006')
 *  03 TIPO_ESCRIT       '0' = Original, '1' = Retificadora
 *  04 IND_SIT_ESP       Situacao especial (vazio = normal)
 *  05 NUM_REC_ANTERIOR  Recibo anterior (vazio se original)
 *  06 DT_INI            Data inicial DDMMAAAA
 *  07 DT_FIN            Data final DDMMAAAA
 *  08 NOME              Razao social
 *  09 CNPJ              CNPJ 14 digitos
 *  10 UF                UF
 *  11 COD_MUN           Codigo Municipio IBGE 7 digitos
 *  12 SUFRAMA           Codigo Suframa (vazio)
 *  13 IND_NAT_PJ        Natureza da PJ (00=nenhum)
 *  14 IND_ATIV           Atividade preponderante (0=industrial/equip, 1=prestador, ...)
 */
function build0000(dados) {
    const { empresa, competenciaInicio, competenciaFim } = dados;
    const df = empresa.dadosFiscais || {};
    return fmt.buildLine([
        '0000',
        COD_VER,
        '0',  // TIPO_ESCRIT: 0=Original
        '',   // IND_SIT_ESP: vazio = normal
        '',   // NUM_REC_ANTERIOR: vazio (original)
        fmt.formatCompetenciaInicio(competenciaInicio),
        fmt.formatCompetenciaFim(competenciaFim),
        fmt.sanitizeString(empresa.nome, 100),
        fmt.sanitizeCnpjCpf(empresa.cnpj),
        fmt.sanitizeString(df.uf || '', 2).toUpperCase(),
        fmt.sanitizeString(df.codMunIBGE || '', 7),
        fmt.sanitizeString(df.codSuframa || '', 9),
        fmt.sanitizeString(df.indNatPJ || '00', 2),
        df.indAtividade === 'industrial' ? '0' : '1',
    ]);
}

/**
 * 0100 — Dados do Contabilista
 */
function build0100(dados) {
    const c = dados.contador || {};
    return fmt.buildLine([
        '0100',
        fmt.sanitizeString(c.nome || 'CONTADOR SP CONTABIL', 100),
        fmt.sanitizeCnpjCpf(c.cpf || ''),
        fmt.sanitizeString(c.crc || '1SP123456/O-7', 15),
        fmt.sanitizeCnpjCpf(c.cnpj || ''),
        fmt.sanitizeCep(c.cep || ''),
        fmt.sanitizeString(c.logradouro || c.endereco || '', 60),
        fmt.sanitizeString(c.numero || '', 10),
        fmt.sanitizeString(c.complemento || '', 60),
        fmt.sanitizeString(c.bairro || '', 60),
        fmt.sanitizeString(c.telefone || '', 11),
        '',  // FAX
        fmt.sanitizeString(c.email || '', 60),
        fmt.sanitizeString(c.codMunIBGE || '', 7),
    ]);
}

/**
 * 0110 — Regimes de Apuracao da Contribuicao Social e de Credito
 *
 * Campos:
 *  01 REG              '0110'
 *  02 COD_INC_TRIB     1=Nao-cumulativo, 2=Cumulativo, 3=Ambos
 *  03 IND_APRO_CRED    Criterio de apropriacao do credito (obrig. se 1 ou 3)
 *  04 COD_TIPO_CONT    1=Aliquota basica, 2=Diferenciadas
 *  05 IND_REG_CUM      Regime cumulativo (obrig. se 2 ou 3)
 */
function build0110(dados) {
    const regimeApuracao = dados.regimeApuracao || '2';
    const indAproCred = (regimeApuracao === '1' || regimeApuracao === '3') ? '2' : '';
    const indRegCum = (regimeApuracao === '2' || regimeApuracao === '3') ? '1' : '';
    return fmt.buildLine([
        '0110',
        regimeApuracao,
        indAproCred,
        '1',  // COD_TIPO_CONT: 1 = aliquota basica
        indRegCum,
    ]);
}

/**
 * 0140 — Tabela de Cadastro de Estabelecimentos
 */
function build0140(dados) {
    const { empresa } = dados;
    const df = empresa.dadosFiscais || {};
    return fmt.buildLine([
        '0140',
        '1',  // COD_EST: estabelecimento unico
        fmt.sanitizeString(empresa.nome, 100),
        fmt.sanitizeCnpjCpf(empresa.cnpj),
        fmt.sanitizeString(df.uf || '', 2).toUpperCase(),
        fmt.sanitizeString(df.inscricaoEstadual || '', 14),
        fmt.sanitizeString(df.codMunIBGE || '', 7),
        fmt.sanitizeString(empresa.ccmSp || '', 15),
        fmt.sanitizeString(df.codSuframa || '', 9),
    ]);
}

/**
 * 0150 — Tabela de Cadastro do Participante
 */
function build0150(p) {
    const cnpjStr = fmt.sanitizeCnpjCpf(p.cnpj || '');
    const cpfStr = fmt.sanitizeCnpjCpf(p.cpf || '');
    const ieStr = cpfStr ? '' : fmt.sanitizeString(p.ie || '', 14);
    return fmt.buildLine([
        '0150',
        fmt.sanitizeString(p.codPart, 60),
        fmt.sanitizeString(p.nome, 100),
        '1058',  // Brasil
        cnpjStr,
        cpfStr,
        ieStr,
        fmt.sanitizeString(p.codMunIBGE || '', 7),
        '',  // SUFRAMA
        fmt.sanitizeString(p.logradouro || '', 60),
        fmt.sanitizeString(p.numero || '', 10),
        fmt.sanitizeString(p.complemento || '', 60),
        fmt.sanitizeString(p.bairro || '', 60),
    ]);
}

/**
 * 0190 — Identificacao das Unidades de Medida
 */
function build0190(u) {
    return fmt.buildLine([
        '0190',
        fmt.sanitizeString(u.codigo, 6),
        fmt.sanitizeString(u.descricao || u.codigo, 100),
    ]);
}

/**
 * 0200 — Tabela de Identificacao do Item
 */
function build0200(item) {
    return fmt.buildLine([
        '0200',
        fmt.sanitizeString(item.codItem, 60),
        fmt.sanitizeString(item.descricao, 255),
        fmt.sanitizeString(item.codBarra || '', 14),
        '',  // COD_ANT_ITEM
        fmt.sanitizeString(item.unidade || 'UN', 6),
        item.tipo || '00',
        fmt.sanitizeString(item.ncm || '00000000', 8),
        '',  // EX_IPI
        '',  // COD_GEN
        '',  // COD_LST
        '',  // ALIQ_ICMS
    ]);
}

export { buildBloco0Contrib };
