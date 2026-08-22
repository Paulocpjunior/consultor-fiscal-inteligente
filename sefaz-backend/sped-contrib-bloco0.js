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
// IND_REG_CUM sai do que o arquivo PRODUZIU (F550 × blocos A/C/D).
import { indRegCumDoArquivo } from './receita-sem-documento-f550.js';
// TIPO_ITEM/NCM do item de serviço — régua única, a mesma que os dois
// orquestradores usam para classificar o item.
import { ehItemDeServico, TIPO_ITEM_MERCADORIA_REVENDA } from './sped-selecao-documentos.js';
// A natureza da PJ (IND_NAT_PJ) sai do CADASTRO — nunca do regime, que é outro
// eixo. Aqui só se lê o regime para SABER quando o '00' é uma afirmação falsa.
import { regimeDaEmpresa, semFinsLucrativos } from './regime-tributario.js';

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
    // 🚨 COD_MUN DO PARTICIPANTE — o PVA cobra, e o app tem que cobrar ANTES.
    //
    // Paulo, 18/08 (MANTOAN, 30 recusas): *"alguns erros como COD MUN eu
    // arrumava manual mesmo, pq na nota não tinha mesmo"*. A decisão dele fica:
    // o app NÃO preenche — inventar município é afirmar domicílio de terceiro, e
    // o '9999999' que a mensagem do PVA sugere significa "NÃO domiciliado no
    // Brasil", o que seria FALSO para um paciente de São Paulo.
    //
    // O que o app passa a fazer é DENUNCIAR na geração, com a lista e a
    // contagem, em vez de deixar a descoberta para o PVA depois do upload.
    // (Regra de 06/08: cadastro faltando é ALERTA, nunca contorno.)
    const semMunicipio = [];
    for (const p of dados.participantes || []) {
        if (!String(p?.codMunIBGE || '').replace(/\D/g, '')) {
            semMunicipio.push(String(p?.nome || p?.codPart || '(sem nome)'));
        }
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

    if (semMunicipio.length && Array.isArray(dados.warnings)) {
        dados.warnings.push(
            `Bloco 0: ${semMunicipio.length} participante(s) sem código de município (COD_MUN) — o PVA `
            + `recusa cada um: ${semMunicipio.slice(0, 8).join(', ')}`
            + `${semMunicipio.length > 8 ? ` e mais ${semMunicipio.length - 8}` : ''}. `
            + 'O app NÃO preenche: inventar município é afirmar o domicílio de terceiro, e o "9999999" '
            + 'que o PVA sugere significa NÃO domiciliado no Brasil. Complete no cadastro do '
            + 'participante ou ajuste no arquivo antes de transmitir.',
        );
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
    conferirIndNatPJ(dados, df);
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
 * 🚨 IND_NAT_PJ — o campo era LIDO de um cadastro que não existia.
 *
 * Varredura noturna dos leitores (21/08). O 0000 escrevia
 * `df.indNatPJ || '00'` — e `indNatPJ` não estava na whitelist do modal Dados
 * Fiscais nem tinha campo em tela nenhuma: **caía SEMPRE no '00'**. É a "rota
 * sem botão" (13/08) na versão CAMPO, e o efeito é uma afirmação: '00' é
 * *sociedade empresária em geral*, o que a COMUNIDADE EVANGÉLICA do caso de
 * 18/08 não é — e o arquivo declarava isso à Receita todo mês.
 *
 * ⚠️ **O APP NÃO ESCOLHE O CÓDIGO.** A Tabela 3.1.3 do leiaute não está neste
 * repositório, e código de tabela oficial não se deduz (é a regra do 0002 e do
 * código 9 do ISS fixo — inventar aqui declararia natureza errada num campo que
 * muda a apuração de quem recolhe PIS sobre a FOLHA). O que muda é o SILÊNCIO:
 * quando o app SABE que a entidade é imune, isenta ou sem fins lucrativos, o
 * '00' vira aviso NOMEADO com o lugar de preencher.
 *
 * Regime tributário e natureza da PJ são EIXOS SEPARADOS (18/08) — o regime
 * aqui só responde "este '00' contradiz o que já sabemos?".
 */
function conferirIndNatPJ(dados, df) {
    if (String(df.indNatPJ || '').trim()) return;
    if (!Array.isArray(dados.warnings)) return;
    const empresa = dados.empresa || {};
    const { regime } = regimeDaEmpresa(empresa);
    const terceiroSetor = semFinsLucrativos(empresa);
    if (!terceiroSetor && !['IMUNE', 'ISENTA'].includes(regime)) return;
    const quem = terceiroSetor ? 'entidade SEM FINS LUCRATIVOS' : `entidade ${regime === 'IMUNE' ? 'IMUNE' : 'ISENTA'}`;
    dados.warnings.push(
        `⚠️ 0000 campo 13 (IND_NAT_PJ): o arquivo está declarando **00 — sociedade `
        + `empresária em geral**, e o cadastro diz que esta é ${quem}. O código é de `
        + `TABELA OFICIAL (3.1.3 do leiaute) e o app NÃO o deduz: preencha `
        + `"Natureza da PJ (IND_NAT_PJ)" em Empresas → Dados Fiscais e gere de novo.`,
    );
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
    // 🚨 IND_REG_CUM = 9 — ESCRITURAÇÃO DETALHADA nos blocos A/C/D/F.
    //
    // Estava cravado em '1', que significa **regime de CAIXA, escrituração
    // consolidada no registro F500** — e o gerador NUNCA produz F500. O arquivo
    // afirmava sobre si mesmo uma coisa que não fazia (17/08, RADIO E TV
    // IBIRAPUERA). O 9 é o que o arquivo ACEITO do E-Fiscal usa (06/2025), e é o
    // que descreve o que este gerador de fato faz: documento a documento nos
    // blocos A/C/D/F.
    //
    // Se um dia existir o caminho consolidado, o valor passa a DEPENDER do que
    // foi gerado — nunca a ser cravado, que é o defeito de origem aqui.
    // ✅ O DIA CHEGOU: o valor agora DEPENDE do que foi gerado. Quando a receita
    // do período vem do **F550** (aluguel — não há documento), a escrituração é
    // CONSOLIDADA e o campo é **2**; quando vem dos blocos A/C/D, é detalhada e
    // continua **9**. Os dois saem de arquivo ACEITO: AFFITTARE 05/2026 traz 2
    // com F550, HS PROJETOS 05/2026 traz 9 escriturando documento a documento.
    const indRegCum = indRegCumDoArquivo({
        regimeApuracao,
        receitaConsolidada: dados.receitaSemDocumento || 0,
    });
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
/**
 * A IE como o SPED a quer: só dígitos, ou VAZIO.
 *
 * Texto de cadastro ("ISENTO", "NÃO CONTRIBUINTE", "N/A") vira vazio — é o que
 * eles significam. IE com letra de verdade não existe no leiaute do 0140.
 */
export function ieDoArquivo(bruto) {
    const d = String(bruto == null ? '' : bruto).replace(/\D/g, '');
    return d.length ? d.slice(0, 14) : '';
}

function build0140(dados) {
    const { empresa } = dados;
    const df = empresa.dadosFiscais || {};
    return fmt.buildLine([
        '0140',
        '1',  // COD_EST: estabelecimento unico
        fmt.sanitizeString(empresa.nome, 100),
        fmt.sanitizeCnpjCpf(empresa.cnpj),
        fmt.sanitizeString(df.uf || '', 2).toUpperCase(),
        // 🚨 "ISENTO" NÃO É INSCRIÇÃO ESTADUAL — é o texto que o cadastro guarda
        // para dizer que não há uma. O PVA recusou (MANTOAN 07/2026: "Inscrição
        // Estadual inválida · Conteúdo ISENTO"), e está certo: a ausência de IE
        // se declara com o campo VAZIO, não com uma palavra.
        //
        // ⚠️ Não é conserto de cadastro (regra de 06/08): o cadastro continua
        // dizendo ISENTO, que é a verdade para quem lê a tela. O que muda é a
        // TRADUÇÃO para o arquivo, e traduzir é trabalho do gerador.
        ieDoArquivo(df.inscricaoEstadual),
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
    // 🚨 SERVIÇO NÃO TEM NCM — Guia 3.2.3, 0200 campo 08, literal: *"Não existe
    // COD-NCM para serviços"*. O gerador escrevia '00000000', que é NCM
    // FABRICADO (mesma família do 'PARTSEM'), justamente no item sintético que
    // representa a NFS-e sem discriminação.
    const ehServico = ehItemDeServico(item);
    return fmt.buildLine([
        '0200',
        fmt.sanitizeString(item.codItem, 60),
        fmt.sanitizeString(item.descricao, 255),
        fmt.sanitizeString(item.codBarra || '', 14),
        '',  // COD_ANT_ITEM
        fmt.sanitizeString(item.unidade || 'UN', 6),
        item.tipo || TIPO_ITEM_MERCADORIA_REVENDA,
        ehServico ? '' : fmt.sanitizeString(item.ncm || '00000000', 8),
        '',  // EX_IPI
        '',  // COD_GEN
        '',  // COD_LST
        '',  // ALIQ_ICMS
    ]);
}

export { buildBloco0Contrib };
