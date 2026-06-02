// ============================================================================
// sefaz-backend/sped-fiscal-bloco0.js
// Bloco 0 do EFD ICMS/IPI — Abertura, Identificacao e Referencias.
//
// Registros gerados na Fase 1:
//   0000 — Abertura do Arquivo Digital e Identificacao da Entidade
//   0001 — Abertura do Bloco 0
//   0005 — Dados Complementares da Entidade
//   0100 — Dados do Contabilista
//   0150 — Tabela de Cadastro do Participante (clientes/fornecedores)
//   0190 — Identificacao das Unidades de Medida (UN, KG, L, etc)
//   0200 — Tabela de Identificacao do Item (produtos e servicos)
//   0990 — Encerramento do Bloco 0
//
// Layout: Guia Pratico 3.2.2, Leiaute 020 (vigente 01/01/2026).
// ============================================================================

import * as fmt from './sped-fiscal-format.js';

const VERSAO_LEIAUTE = '020';  // Leiaute 020 vigente desde 01/01/2026

/**
 * Constroi o Bloco 0 inteiro a partir dos dados coletados pelo orchestrator.
 *
 * @param {object} dados
 * @param {object} dados.empresa - empresa (Simples ou Lucro Presumido)
 * @param {object} dados.contador - dados do contador (registro 0100)
 * @param {string} dados.competenciaInicio - YYYY-MM
 * @param {string} dados.competenciaFim - YYYY-MM
 * @param {object[]} dados.notas - documentos_fiscais filtrados por periodo
 * @param {object[]} dados.participantes - clientes/fornecedores unicos
 * @param {object[]} dados.itens - produtos/servicos unicos
 * @param {object[]} dados.unidades - unidades de medida unicas
 *
 * @returns {string[]} array de linhas (cada linha eh string completa com |...|\r\n)
 */
function buildBloco0(dados) {
    const linhas = [];

    // ── 0000 — Abertura ─────────────────────────────────────────────────
    linhas.push(build0000(dados));

    // ── 0001 — Abertura do Bloco 0 ──────────────────────────────────────
    linhas.push(fmt.buildLine(['0001', '0']));

    // ── 0005 — Dados Complementares ─────────────────────────────────────
    linhas.push(build0005(dados));

    // ── 0100 — Contabilista ─────────────────────────────────────────────
    linhas.push(build0100(dados));

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
    // Total de linhas do bloco INCLUINDO o proprio 0990
    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['0990', totalBloco]));

    return linhas;
}

/**
 * 0000 — Abertura do Arquivo Digital e Identificacao da Entidade
 *
 * Campos:
 *  01 REG          'NOME DO REGISTRO'        '0000' fixo
 *  02 COD_VER      Versao do leiaute          '020'
 *  03 COD_FIN      0=Original, 1=Substituto  '0' (sempre original na Fase 1)
 *  04 DT_INI       Data inicial               DDMMAAAA
 *  05 DT_FIN       Data final                 DDMMAAAA
 *  06 NOME         Razao social               max 100 chars
 *  07 CNPJ         CNPJ                       14 digitos
 *  08 CPF          CPF (vazio se PJ)          14 digitos ou ''
 *  09 UF           UF                         2 chars
 *  10 IE           Inscricao Estadual         max 14 chars ou ISENTO
 *  11 COD_MUN      Codigo Municipio IBGE      7 digitos
 *  12 IM           Inscricao Municipal        max 15 chars (vazio aceito)
 *  13 SUFRAMA      Codigo Suframa             9 digitos (vazio aceito)
 *  14 IND_PERFIL   A | B | C                   'A' fixo
 *  15 IND_ATIV     0=Industrial, 1=Outras
 */
function build0000(dados) {
    const { empresa, competenciaInicio, competenciaFim } = dados;
    const df = empresa.dadosFiscais || {};
    return fmt.buildLine([
        '0000',
        VERSAO_LEIAUTE,
        '0',  // 0=Original
        fmt.formatCompetenciaInicio(competenciaInicio),
        fmt.formatCompetenciaFim(competenciaFim),
        fmt.sanitizeString(empresa.nome, 100),
        fmt.sanitizeCnpjCpf(empresa.cnpj),
        '',  // CPF (vazio pra PJ)
        fmt.sanitizeString(df.uf || '', 2).toUpperCase(),
        fmt.sanitizeString(df.inscricaoEstadual || '', 14),
        fmt.sanitizeString(df.codMunIBGE || '', 7),
        fmt.sanitizeString(empresa.ccmSp || df.ccmSp || '', 15),  // Inscricao Municipal (top-level ou dadosFiscais)
        fmt.sanitizeString(df.codSuframa || '', 9),
        'A',  // perfil EFD: sempre A
        df.indAtividade === 'industrial' ? '0' : '1',
    ]);
}

/**
 * 0005 — Dados Complementares da Entidade
 *
 * Campos:
 *  01 REG       '0005'
 *  02 FANTASIA  Nome fantasia          max 100
 *  03 CEP       CEP                    8 digitos
 *  04 END       Logradouro             max 60
 *  05 NUM       Numero                 max 10
 *  06 COMPL     Complemento            max 60
 *  07 BAIRRO    Bairro                 max 60
 *  08 FONE      Telefone               max 11
 *  09 FAX       Fax                    max 11 (vazio)
 *  10 EMAIL     Email                  max 60
 */
function build0005(dados) {
    const df = dados.empresa.dadosFiscais || {};
    return fmt.buildLine([
        '0005',
        fmt.sanitizeString(dados.empresa.nomeFantasia || dados.empresa.nome, 100),
        fmt.sanitizeCep(df.cep),
        fmt.sanitizeString(df.logradouro || '', 60),
        fmt.sanitizeString(df.numero || '', 10),
        fmt.sanitizeString(df.complemento || '', 60),
        fmt.sanitizeString(df.bairro || '', 60),
        fmt.sanitizeString(df.telefone || '', 11),
        '',  // FAX
        fmt.sanitizeString(df.email || '', 60),
    ]);
}

/**
 * 0100 — Dados do Contabilista
 *
 * Campos:
 *  01 REG       '0100'
 *  02 NOME      Nome do contabilista      max 100
 *  03 CPF       CPF                       11 digitos
 *  04 CRC       CRC (ex: 1SP123456/O-7)  max 15
 *  05 CNPJ      CNPJ escritorio (opcional) 14 digitos
 *  06 CEP       CEP escritorio            8 digitos
 *  07 END       Endereco                  max 60
 *  08 NUM       Numero                    max 10
 *  09 COMPL     Complemento               max 60
 *  10 BAIRRO    Bairro                    max 60
 *  11 FONE      Telefone                  max 11
 *  12 FAX       Fax (vazio)
 *  13 EMAIL     Email                     max 60
 *  14 COD_MUN   Codigo Municipio IBGE     7 digitos
 */
function build0100(dados) {
    // Contador eh fixo da SP Assessoria Contabil (placeholder por enquanto;
    // pode virar campo da empresa ou parametro do usuario admin no futuro).
    const c = dados.contador || {};
    return fmt.buildLine([
        '0100',
        fmt.sanitizeString(c.nome || 'CONTADOR SP CONTABIL', 100),
        fmt.sanitizeCnpjCpf(c.cpf || ''),
        fmt.sanitizeString(c.crc || '1SP123456/O-7', 15),
        fmt.sanitizeCnpjCpf(c.cnpj || ''),
        fmt.sanitizeCep(c.cep || ''),
        fmt.sanitizeString(c.logradouro || '', 60),
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
 * 0150 — Tabela de Cadastro do Participante
 * Um registro por participante unico (cliente + fornecedor).
 *
 * Campos:
 *  01 REG          '0150'
 *  02 COD_PART     Codigo unico do participante   max 60
 *  03 NOME         Razao social/Nome              max 100
 *  04 COD_PAIS     Codigo pais (1058 = Brasil)    max 5
 *  05 CNPJ         CNPJ                           14 digitos
 *  06 CPF          CPF (vazio se PJ)              11 digitos
 *  07 IE           Inscricao Estadual             max 14
 *  08 COD_MUN      Codigo Municipio IBGE          7 digitos
 *  09 SUFRAMA      Codigo Suframa (vazio)         9 digitos
 *  10 END          Endereco                       max 60
 *  11 NUM          Numero                         max 10
 *  12 COMPL        Complemento                    max 60
 *  13 BAIRRO       Bairro                         max 60
 */
function build0150(p) {
    // PF tem cpf preenchido e cnpj vazio (e vice-versa). IE so se aplica a PJ.
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
 * Um registro por unidade unica usada nos itens.
 *
 * Campos:
 *  01 REG    '0190'
 *  02 UNID   Codigo unidade (UN, KG, L, etc)   max 6
 *  03 DESCR  Descricao                          max 100
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
 * Um registro por item (produto ou servico) unico.
 *
 * Campos (15 campos no total no leiaute 020, alguns opcionais):
 *  01 REG           '0200'
 *  02 COD_ITEM      Codigo interno              max 60
 *  03 DESCR_ITEM    Descricao                   max 255
 *  04 COD_BARRA     Codigo de barras (vazio OK) max 14
 *  05 COD_ANT_ITEM  Codigo anterior do item     max 60 (vazio OK)
 *  06 UNID_INV      Unidade de inventario       max 6
 *  07 TIPO_ITEM     Tipo do item               2 digitos (00=mercadoria revenda, etc)
 *  08 COD_NCM       NCM                        8 digitos
 *  09 EX_IPI        EX IPI                     max 3 (vazio OK)
 *  10 COD_GEN       Codigo Genero/Familia      2 digitos
 *  11 COD_LST       Lista Servicos LC 116      max 5 (servicos so)
 *  12 ALIQ_ICMS     Aliquota ICMS              decimal (vazio OK)
 *  13 CEST          CEST (vazio OK)            7 digitos
 */
function build0200(item) {
    return fmt.buildLine([
        '0200',
        fmt.sanitizeString(item.codItem, 60),
        fmt.sanitizeString(item.descricao, 255),
        fmt.sanitizeString(item.codBarra || '', 14),
        '',  // COD_ANT_ITEM
        fmt.sanitizeString(item.unidade || 'UN', 6),
        item.tipo || '00',  // 00=Mercadoria pra Revenda
        fmt.sanitizeString(item.ncm || '00000000', 8),
        '',  // EX_IPI
        fmt.sanitizeString(item.codGen || '00', 2),
        fmt.sanitizeString(item.codLst || '', 5),
        fmt.formatValue(item.aliqIcms, 2),
        fmt.sanitizeString(item.cest || '', 7),
    ]);
}

export { buildBloco0 };
