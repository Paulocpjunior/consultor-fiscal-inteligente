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
//   0300 — Cadastro de bens/componentes do ativo imobilizado (CIAP, quando ha)
//   0990 — Encerramento do Bloco 0
//
// Layout: Guia Pratico 3.2.2, Leiaute 020 (vigente 01/01/2026).
// ============================================================================

import * as fmt from './sped-fiscal-format.js';
import { ccmSpDaEmpresa } from './ccm-sp.js';
// 🚨 O 0300 é o CADASTRO que o G125 referencia (Guia 3.2.3, G125 campo 02:
// "o código informado neste campo deve constar de um registro 0300"), e o
// arquivo não o trazia — cada bem do CIAP saía ÓRFÃO, a família do item órfão
// do 0200 e do participante órfão do 0150. O dono é o módulo do CIAP: ele já lê
// esse cadastro para o G125, e duas leituras fariam os dois registros
// discordarem sobre o mesmo bem dentro do mesmo arquivo.
import { montarRegistros0300 } from './sped-bloco-g.js';
// 🚨 O 0460 é o cadastro que o C195 referencia — e o dono dele é o módulo do
// DIFAL, que também escreve o C195. Uma fonte, não duas: descrições diferentes
// para a MESMA observação fariam o arquivo se contradizer.
import { montarRegistro0460 } from './sped-difal-c197.js';
// TIPO_ITEM/NCM do item de serviço — a MESMA régua do bloco 0 do
// EFD-Contribuições; duas cópias declarariam tipos diferentes para o mesmo item
// em dois arquivos do mesmo mês.
import {
    ehItemDeServico, TIPO_ITEM_MERCADORIA_REVENDA, normalizarUnidade,
} from './sped-selecao-documentos.js';
// 0150 e 0190 têm o MESMO leiaute nas duas famílias — e a cópia já tinha
// custado a recusa do COD_MUN, corrigida em metade delas.
import {
    build0150, build0190, avisoParticipantesSemMunicipio,
} from './sped-bloco0-cadastros.js';

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

    // ── 0002 — Classificação do estabelecimento INDUSTRIAL ──────────────
    //
    // 🚨 PVA da PWR 07/2026 (19/08): *"Registro filho obrigatório não foi
    // informado · 0002"*. Ele é exigido do contribuinte de IPI — e o gerador
    // nunca o produziu.
    //
    // ⚠️ O CÓDIGO NÃO SE INVENTA: `CLAS_ESTAB_IND` é tabela oficial (Guia
    // Prático / Ato COTEPE) e diz o que o estabelecimento É perante o IPI.
    // Chutar aqui seria declarar uma classificação industrial em nome do
    // cliente — a família do 1405, num campo que a fiscalização lê. Então o
    // registro só sai CADASTRADO, e a falta vira aviso NOMEADO com a ação
    // (mesmo desenho do código 9 do ISS fixo, que veio do cadastro).
    const clasEstab = String(dados?.empresa?.dadosFiscais?.classEstabIpi || '').trim();
    if (clasEstab) {
        linhas.push(fmt.buildLine(['0002', fmt.sanitizeString(clasEstab, 2)]));
    } else if (Array.isArray(dados?.warnings)) {
        dados.warnings.push(
            'Registro 0002 (Classificação do estabelecimento industrial) NÃO foi gerado: o código não está '
            + 'cadastrado. Se esta empresa é contribuinte de IPI, o PVA vai recusar com "Registro filho '
            + 'obrigatório não foi informado · 0002". O código é da tabela oficial e não pode ser deduzido pelo '
            + 'app — pegue o do cadastro do cliente no E-Fiscal e preencha em Empresas → Dados Fiscais '
            + '("Classificação do estab. industrial - IPI").',
        );
    }

    // ── 0005 — Dados Complementares ─────────────────────────────────────
    linhas.push(build0005(dados));

    // 🚨 CEP ILEGÍVEL SAI VAZIO — e a ausência vai DITA, nunca calada.
    // `sanitizeCep` completa o zero à esquerda (recuperação legítima: ele se
    // perde quando o cadastro grava o CEP como número) e DESCARTA o que tem
    // mais de 8 dígitos, porque CEP truncado é um CEP DIFERENTE, que o PVA
    // aceita e aponta outro município — a família do `1405`. O campo é
    // `Obrig. O`, então quem lê precisa saber por que ele saiu em branco.
    const cepCru = String(dados.empresa?.dadosFiscais?.cep || '').replace(/\D/g, '');
    if (cepCru && cepCru.length > 8 && Array.isArray(dados.warnings)) {
        dados.warnings.push(
            `0005: o CEP cadastrado tem ${cepCru.length} dígitos e o campo aceita 8 — ele saiu VAZIO, e o `
            + 'PVA vai recusar com "Campo de preenchimento obrigatório". O app NÃO corta o número: CEP '
            + 'truncado é um CEP de outro lugar. Corrija em Empresas → Dados Fiscais.',
        );
    }

    // ── 0100 — Contabilista ─────────────────────────────────────────────
    linhas.push(build0100(dados));

    // ── 0150 — Participantes ────────────────────────────────────────────
    // 🚨 O COD_MUN FALTANDO É RECUSA DO PVA (MANTOAN, 18/08, 30 ocorrências) —
    // e a denúncia vivia SÓ no EFD-Contribuições. O 0150 é o MESMO registro
    // nas duas famílias: trava que roda em metade delas deixa a próxima
    // empresa gastar a mesma volta de PVA com outro CNPJ.
    for (const p of dados.participantes || []) {
        linhas.push(build0150(p));
    }
    const avisoMun = avisoParticipantesSemMunicipio(dados.participantes);
    if (avisoMun && Array.isArray(dados.warnings)) dados.warnings.push(avisoMun);

    // ── 0190 — Unidades de Medida ───────────────────────────────────────
    for (const u of dados.unidades || []) {
        linhas.push(build0190(u));
    }

    // ── 0200 — Itens (produtos/servicos) ────────────────────────────────
    for (const item of dados.itens || []) {
        linhas.push(build0200(item));
    }

    // ── 0300 — Bens/componentes do CIAP ─────────────────────────────────
    // Só sai quando a empresa tem CIAP cadastrado — a maioria não tem, e o
    // bloco G dela sai vazio. Sem isto o G125 referenciaria um cadastro que o
    // arquivo não declara.
    const r0300 = montarRegistros0300(dados.ciap?.bens);
    for (const l of r0300.linhas) linhas.push(l);
    if (Array.isArray(dados.warnings)) for (const a of r0300.avisos) dados.warnings.push(a);

    // ── 0460 — Tabela de Observações do Lançamento Fiscal ───────────────
    // Só sai quando o bloco C de fato emitiu um C195 (`dados.difalTemC195`, que
    // ele grava): o Guia valida nos DOIS sentidos — o C195 exige o 0460, e o
    // 0460 exige existir em pelo menos um registro dos demais blocos.
    for (const l of montarRegistro0460(dados.difalCodObservacao, dados.difalTemC195)) {
        linhas.push(l);
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
 *  14 IND_PERFIL   A | B | C                   do cadastro (default A)
 *  15 IND_ATIV     0=Industrial, 1=Outras
 */
/**
 * 🚨 IND_PERFIL — o modal tinha o campo e o arquivo IGNORAVA (21/08, varredura
 * inversa: campo que a TELA grava e nenhum gerador lê).
 *
 * O perfil de enquadramento (A/B/C) é atribuído pelo FISCO ESTADUAL e decide
 * QUAIS REGISTROS o arquivo deve ter. Declarar 'A' num contribuinte de perfil
 * B faz o arquivo prometer um detalhamento que o PVA vai cobrar — é a família
 * da recusa *"O registro não deve ser informado para esse PERFIL"* que a
 * AFFITTARE levou no EFD-Contribuições em 21/08.
 *
 * E tinha a agravante do trabalho perdido: a pessoa escolhia o perfil na tela,
 * salvava, e o arquivo saía com outro. Valor fora de A/B/C é RECUSADO com o
 * motivo (nunca descartado calado — lição do #382) e cai em 'A'.
 */
function perfilDoArquivo(dados) {
    const bruto = String(dados?.empresa?.dadosFiscais?.perfilEFD || '').trim().toUpperCase();
    if (['A', 'B', 'C'].includes(bruto)) {
        if (bruto !== 'A' && Array.isArray(dados.warnings)) {
            dados.warnings.push(
                `0000: o arquivo saiu com IND_PERFIL = ${bruto} (o cadastro da empresa diz isso). `
                + 'O perfil decide quais registros o PVA exige — confira se é o enquadramento que o '
                + 'fisco estadual atribuiu antes de transmitir.',
            );
        }
        return bruto;
    }
    if (bruto && Array.isArray(dados.warnings)) {
        dados.warnings.push(
            `0000: perfil "${bruto}" não existe (os válidos são A, B e C) — o arquivo saiu com A. `
            + 'Corrija em Empresas → Dados Fiscais.',
        );
    }
    return 'A';
}

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
        // 🚨 Inscrição Municipal — pelo DONO (`ccm-sp.js`), que lê as duas
        // formas E trata os SÓ-ZEROS como vazio. Até 29/08 esta linha escrevia
        // `00000000` no arquivo quando a equipe usava o contorno dos oito zeros
        // no cadastro: campo em branco é AUSÊNCIA, oito zeros é uma AFIRMAÇÃO
        // falsa de inscrição, e a diferença é a que esta casa paga caro.
        fmt.sanitizeString(ccmSpDaEmpresa({ dadosFiscais: df, ccmSp: empresa.ccmSp }), 15),
        fmt.sanitizeString(df.codSuframa || '', 9),
        perfilDoArquivo(dados),
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
        // 🚨 O leiaute dá **060** ao FANTASIA (o 0000 é que tem NOME de 100), e
        // este campo cortava em 100: razão social longa saía com 91 caracteres
        // num campo de 60, que é a recusa "Tamanho do campo inválido" — a
        // família do `COD_ENQ 318,68` da PWR (20/08). A trava de contagem conta
        // CAMPOS, não TAMANHO, então ela ficava muda aqui.
        fmt.sanitizeString(dados.empresa.nomeFantasia || dados.empresa.nome, 60),
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
        // 🚨 SEM DEFAULT INVENTADO. Isto saía 'CONTADOR SP CONTABIL' e o CRC
        // '1SP123456/O-7' — dado FABRICADO num campo que a fiscalização lê, a
        // família do '1405', do 'PARTSEM' e do '5352'. Pior que o campo vazio:
        // vazio o PVA ACUSA; contabilista inventado ele ACEITA, e o arquivo
        // passa a declarar um profissional que não existe, com um CRC que não é
        // de ninguém. Faltando, o campo sai VAZIO e a geração AVISA qual env
        // preencher (`conferirContador`).
        fmt.sanitizeString(c.nome || '', 100),
        fmt.sanitizeCnpjCpf(c.cpf || ''),
        fmt.sanitizeString(c.crc || '', 15),
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
    // COD_GEN (tabela 4.2.1 — Gênero do item) = CAPÍTULO da NCM, os 2 primeiros
    // dígitos; o código '00' significa SERVIÇO. O default antigo cravava '00'
    // em todo item — 309 mercadorias com NCM declaradas como "serviço" no
    // arquivo da REALITY 0899 · 07/2026 (o e-Fiscal aceito deriva
    // 48131000 → 48). Sem NCM não se afirma gênero: o campo sai VAZIO.
    const ncmLimpo = String(item.ncm || '').replace(/\D/g, '');
    const codGen = item.codGen
        || (ncmLimpo.length === 8 && ncmLimpo !== '00000000' ? ncmLimpo.slice(0, 2) : '');
    return fmt.buildLine([
        '0200',
        fmt.sanitizeString(item.codItem, 60),
        fmt.sanitizeString(item.descricao, 255),
        fmt.sanitizeString(item.codBarra || '', 14),
        '',  // COD_ANT_ITEM
        normalizarUnidade(item.unidade) || 'UN',
        item.tipo || TIPO_ITEM_MERCADORIA_REVENDA,
        // Serviço não tem NCM (Guia 3.2.3, 0200 campo 08: "Não existe COD-NCM
        // para serviços") — o '00000000' era NCM fabricado.
        ehItemDeServico(item) ? '' : fmt.sanitizeString(item.ncm || '00000000', 8),
        '',  // EX_IPI
        fmt.sanitizeString(codGen, 2),
        fmt.sanitizeString(item.codLst || '', 5),
        fmt.formatValue(item.aliqIcms, 2),
        fmt.sanitizeString(item.cest || '', 7),
    ]);
}

export { buildBloco0 };
