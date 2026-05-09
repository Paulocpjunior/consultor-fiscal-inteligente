// ============================================================================
// sefaz-backend/sped-fiscal-blocoC.js
// Bloco C do EFD ICMS/IPI — Mercadorias (notas modelos 55 e 65).
//
// Registros gerados (Fase 2):
//   C001 — Abertura do Bloco C
//   C100 — Documento Fiscal Mercantil (cabecalho NF)
//   C170 — Itens da NF
//   C190 — Registro Analitico de Operacoes (agregacao por CST+CFOP+aliquota)
//   C990 — Encerramento do Bloco C
//
// Modelos suportados:
//   '55' = NFe (saida e entrada)
//   '65' = NFCe (apenas saida)
//
// CTe (modelo 57) e MDFe (58) ficam fora — vao no Bloco D futuro.
//
// Layout: Guia Pratico 3.2.2.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';
import { correlacionarCfop, derivarNaturezaAtividade } from './cfop-correlacao.js';

const MODELOS_BLOCO_C = ['55', '65'];

/**
 * Mapeia status interno -> COD_SIT do registro C100.
 *   00 = Documento regular (autorizado)
 *   01 = Escriturado extempor.
 *   02 = Cancelado
 *   03 = Cancelado extemp.
 *   04 = NFe denegada
 *   05 = NFe numero inutilizado
 *   06 = Documento Fiscal Complementar
 *   07 = Documento Fiscal Complementar extemp.
 *   08 = Documento Fiscal Regime Especial ou Norma Especifica
 */
function statusParaCodSit(status) {
    switch (status) {
        case 'cancelado':    return '02';
        case 'denegado':     return '04';
        case 'inutilizado':  return '05';
        case 'autorizado':
        default:             return '00';
    }
}

/**
 * Tenta extrair CST do ICMS de um item.
 * Aceita varias variacoes que XMLs costumam ter.
 * Fallback: '01' (ICMS comum).
 */
function getCstIcms(item) {
    return (
        item.cstIcms || item.cst || item.CST || item.CSTICMS ||
        item.cst_icms || item.icmsCst ||
        '01'
    );
}

/**
 * Wrapper local: converte CFOP do emitente pra destinatario usando a
 * funcao correlacionarCfop (que considera naturezaAtividade + overrides
 * da empresa).
 *
 * O contexto eh extraido de `dados.empresa.dadosFiscais` quando disponivel.
 */
function convertCfopParaEntrada(rawCfop, direcao, dados) {
    const empresa = dados?.empresa;
    const df = empresa?.dadosFiscais || {};
    return correlacionarCfop(rawCfop, direcao, {
        naturezaAtividade: derivarNaturezaAtividade(empresa),
        cfopOverrides: df.cfopOverrides,
    });
}

/**
 * Filtra notas que entram no Bloco C.
 */
function filtrarNotasBlocoC(notas) {
    return (notas || []).filter(n => {
        // Modelo 55 ou 65
        if (!MODELOS_BLOCO_C.includes(String(n.modelo))) return false;
        // Tipo NFe ou NFCe (defensivo - se modelo bate, tipo ja deve estar ok)
        if (!['NFe', 'NFCe'].includes(n.tipo)) return false;
        return true;
    });
}

/**
 * Constroi o Bloco C inteiro.
 *
 * @param {object} dados - mesmo objeto retornado por coletarDadosEmpresa
 * @returns {string[]} array de linhas SPED
 */
export function buildBlocoC(dados) {
    const linhas = [];
    const notas = filtrarNotasBlocoC(dados.notas);

    // C001 — Abertura
    // Indicador de movimento: 0 = Bloco com dados, 1 = Bloco sem dados
    const indMovimento = notas.length > 0 ? '0' : '1';
    linhas.push(fmt.buildLine(['C001', indMovimento]));

    // Anexa referencia ao objeto dados em cada nota pra que helpers de CFOP
    // possam acessar empresa.dadosFiscais (naturezaAtividade + overrides).
    // Usa _ no nome pra deixar claro que eh metadata interno.
    for (const nota of notas) { nota._dados = dados; }

    // C100 + C170s + C190s pra cada nota
    for (const nota of notas) {
        try {
            // C100
            linhas.push(buildC100(nota, dados));

            // C170s — apenas se a nota nao for cancelada/denegada/inutilizada
            // (Guia Pratico: notas canceladas vao apenas com C100, sem C170)
            if (nota.status === 'autorizado') {
                // Regra Guia Pratico: NF-e de emissao propria (IND_EMIT=0)
                // NAO leva C170 — basta C100+C190. So gera C170 quando a
                // nota foi emitida por terceiros (entrada).
                const ehEmissaoPropria = nota.direcao === 'saida';
                if (!ehEmissaoPropria) {
                    let nItem = 1;
                    for (const item of (nota.itens || [])) {
                        linhas.push(buildC170(item, nItem, nota));
                        nItem++;
                    }
                }

                // C190s — agregacao por CST+CFOP+aliquota (sempre)
                const c190s = buildC190sFromNota(nota);
                for (const linha of c190s) {
                    linhas.push(linha);
                }
            }
        } catch (err) {
            console.warn(`[blocoC] Falha gerando linhas pra nota ${nota.numero}:`, err.message);
        }
    }

    // C990 — Encerramento
    // Total de linhas do bloco INCLUINDO o proprio C990
    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['C990', totalBloco]));

    return linhas;
}

/**
 * C100 — Documento Fiscal Mercantil (cabecalho NF)
 *
 * Campos (29 no leiaute 020):
 *  01 REG          'C100'
 *  02 IND_OPER     0=Entrada, 1=Saida
 *  03 IND_EMIT     0=Emissao propria, 1=Terceiros
 *  04 COD_PART     CNPJ do participante (PF/PJ)
 *  05 COD_MOD      Modelo (55, 65)
 *  06 COD_SIT      Situacao (00=regular, 02=cancelado, etc)
 *  07 SER          Serie da NF
 *  08 NUM_DOC      Numero da NF
 *  09 CHV_NFE      Chave de acesso (44 digitos)
 *  10 DT_DOC       Data emissao DDMMAAAA
 *  11 DT_E_S       Data entrada/saida (= DT_DOC quando nao informado)
 *  12 VL_DOC       Valor total da NF (vNF)
 *  13 IND_PGTO     0=A vista, 1=A prazo, 2=Outros, 9=Sem pagamento
 *  14 VL_DESC      Valor desconto
 *  15 VL_ABAT_NT   Valor abatimento nao tributado
 *  16 VL_MERC      Valor produtos (vProd)
 *  17 IND_FRT      0=CIF, 1=FOB, 2=Tercer., 9=Sem cobranca frete
 *  18 VL_FRT       Valor frete
 *  19 VL_SEG       Valor seguro
 *  20 VL_OUT_DA    Valor outras despesas acessorias
 *  21 VL_BC_ICMS   Base ICMS (vBC)
 *  22 VL_ICMS      Valor ICMS
 *  23 VL_BC_ICMS_ST Base ICMS-ST
 *  24 VL_ICMS_ST   Valor ICMS-ST
 *  25 VL_IPI       Valor IPI
 *  26 VL_PIS       Valor PIS
 *  27 VL_COFINS    Valor COFINS
 *  28 VL_PIS_ST    Valor PIS-ST (vazio)
 *  29 VL_COFINS_ST Valor COFINS-ST (vazio)
 */
function buildC100(nota, dados) {
    const t = nota.totais || {};
    const codSit = statusParaCodSit(nota.status);

    // Identifica participante e direcao
    const indOper = nota.direcao === 'saida' ? '1' : '0';
    const participante = nota.direcao === 'saida' ? nota.destinatario : nota.emitente;
    const codPart = (participante && (participante.cnpjCpf || participante.cnpj))
        ? String(participante.cnpjCpf || participante.cnpj).replace(/\D/g, '')
        : '';

    // IND_EMIT: 0=Emissao propria (saida), 1=Terceiros (entrada)
    const indEmit = nota.direcao === 'saida' ? '0' : '1';

    return fmt.buildLine([
        'C100',
        indOper,
        indEmit,
        codPart,
        String(nota.modelo || '55'),
        codSit,
        fmt.sanitizeString(nota.serie || '1', 3),
        fmt.sanitizeString(String(nota.numero || ''), 9),
        fmt.sanitizeString(nota.chave || '', 44),
        fmt.formatDate(nota.dhEmi),
        fmt.formatDate(nota.dhSaiEnt || nota.dhEmi),
        fmt.formatValue(t.vNF, 2),
        '0',  // IND_PGTO: assume A vista (default conservador)
        fmt.formatValue(t.vDesc, 2),
        '',   // VL_ABAT_NT
        fmt.formatValue(t.vProd, 2),
        '9',  // IND_FRT: 9=Sem cobranca frete (default conservador)
        fmt.formatValue(t.vFrete, 2),
        fmt.formatValue(t.vSeg, 2),
        fmt.formatValue(t.vOutro, 2),
        fmt.formatValue(t.vBC, 2),
        fmt.formatValue(t.vICMS, 2),
        fmt.formatValue(t.vBCST, 2),
        fmt.formatValue(t.vST, 2),
        fmt.formatValue(t.vIPI, 2),
        fmt.formatValue(t.vPIS, 2),
        fmt.formatValue(t.vCOFINS, 2),
        '',   // VL_PIS_ST
        '',   // VL_COFINS_ST
    ]);
}

/**
 * C170 — Itens da NF
 *
 * Campos (37 no leiaute 020 — varios opcionais):
 *  01 REG             'C170'
 *  02 NUM_ITEM        Sequencial (1, 2, 3...)
 *  03 COD_ITEM        Codigo do produto
 *  04 DESCR_COMPL     Descricao adicional (vazio)
 *  05 QTD             Quantidade
 *  06 UNID            Unidade
 *  07 VL_ITEM         Valor total do item
 *  08 VL_DESC         Desconto
 *  09 IND_MOV         Movimentacao fisica (0=Sim, 1=Nao)
 *  10 CST_ICMS        CST ICMS (3 chars: orig + cst)
 *  11 CFOP            CFOP
 *  12 COD_NAT         Cod. Natureza (vazio)
 *  13 VL_BC_ICMS      BC ICMS
 *  14 ALIQ_ICMS       Aliquota ICMS
 *  15 VL_ICMS         Valor ICMS
 *  16 VL_BC_ICMS_ST   BC ICMS-ST
 *  17 ALIQ_ST         Aliquota ICMS-ST
 *  18 VL_ICMS_ST      Valor ICMS-ST
 *  19 IND_APUR        0=Mensal, 1=Decendial
 *  20 CST_IPI         CST IPI (vazio aceito)
 *  21 COD_ENQ         Cod. Enquadramento IPI (vazio)
 *  22 VL_BC_IPI       BC IPI
 *  23 ALIQ_IPI        Aliquota IPI
 *  24 VL_IPI          Valor IPI
 *  25 CST_PIS         CST PIS (vazio aceito)
 *  26 VL_BC_PIS       BC PIS
 *  27 ALIQ_PIS        Aliquota PIS (%)
 *  28 QUANT_BC_PIS    Qtd BC PIS (qtde caso unidade tributacao)
 *  29 ALIQ_PIS_REAIS  Aliquota PIS R$ (vazio)
 *  30 VL_PIS          Valor PIS
 *  31 CST_COFINS      CST COFINS
 *  32 VL_BC_COFINS    BC COFINS
 *  33 ALIQ_COFINS     Aliquota COFINS
 *  34 QUANT_BC_COFINS Qtd BC COFINS
 *  35 ALIQ_COFINS_REAIS Aliquota COFINS R$ (vazio)
 *  36 VL_COFINS       Valor COFINS
 *  37 COD_CTA         Codigo conta contabil (vazio)
 */
function buildC170(item, nItem, nota) {
    const cst = getCstIcms(item);
    // CST eh 3 chars no SPED: "OOO" onde primeiro digito eh origem (0-8)
    // Se XML so tem 2 chars (CST sem origem), prepend '0' (origem nacional)
    const cstFmt = cst.length === 2 ? '0' + cst : cst.padStart(3, '0').slice(-3);

    const aliqIcms = item.aliqIcms || (
        item.vICMS && item.vBC ? (item.vICMS / item.vBC * 100) : 0
    );

    return fmt.buildLine([
        'C170',
        String(nItem).padStart(3, '0'),
        fmt.sanitizeString(item.cProd || item.codigo || `ITEM-${nItem}`, 60),
        '',  // DESCR_COMPL
        fmt.formatValue(item.qCom || item.quantidade, 5),
        fmt.sanitizeString((item.uCom || item.unidade || 'UN').toUpperCase(), 6),
        fmt.formatValue(item.vProd || item.valor, 2),
        fmt.formatValue(item.vDesc, 2),
        '0',  // IND_MOV: 0=Sim (movimentacao fisica)
        cstFmt,
        fmt.sanitizeString(convertCfopParaEntrada(item.cfop || item.CFOP || '0000', nota.direcao, nota._dados), 4),
        '',  // COD_NAT
        fmt.formatValue(item.vBC, 2),
        fmt.formatValue(aliqIcms, 2),
        fmt.formatValue(item.vICMS, 2),
        fmt.formatValue(item.vBCST, 2),
        fmt.formatValue(item.aliqST, 2),
        fmt.formatValue(item.vICMSST, 2),
        '0',  // IND_APUR: 0=Mensal
        '',   // CST_IPI
        '',   // COD_ENQ
        fmt.formatValue(item.vBCIPI, 2),
        fmt.formatValue(item.aliqIPI, 2),
        fmt.formatValue(item.vIPI, 2),
        '',   // CST_PIS
        fmt.formatValue(item.vBCPIS, 2),
        fmt.formatValue(item.aliqPIS, 2),
        '',   // QUANT_BC_PIS
        '',   // ALIQ_PIS_REAIS
        fmt.formatValue(item.vPIS, 2),
        '',   // CST_COFINS
        fmt.formatValue(item.vBCCOFINS, 2),
        fmt.formatValue(item.aliqCOFINS, 2),
        '',   // QUANT_BC_COFINS
        '',   // ALIQ_COFINS_REAIS
        fmt.formatValue(item.vCOFINS, 2),
        '',   // COD_CTA
        '',   // VL_ABAT_NT (campo 38, leiaute 020)
    ]);
}

/**
 * C190 — Registro Analitico de Operacoes
 *
 * Agrupa os itens de uma NF por (CST_ICMS, CFOP, ALIQ_ICMS) e gera 1
 * registro pra cada combinacao com totais.
 *
 * Campos (12):
 *  01 REG           'C190'
 *  02 CST_ICMS      CST ICMS (3 chars)
 *  03 CFOP          CFOP
 *  04 ALIQ_ICMS     Aliquota ICMS
 *  05 VL_OPR        Valor da operacao (soma dos vProd)
 *  06 VL_BC_ICMS    Soma das BCs ICMS
 *  07 VL_ICMS       Soma dos ICMS
 *  08 VL_BC_ICMS_ST Soma das BCs ICMS-ST
 *  09 VL_ICMS_ST    Soma dos ICMS-ST
 *  10 VL_RED_BC     Valor reducao BC (geralmente 0)
 *  11 VL_IPI        Soma dos IPI
 *  12 COD_OBS       Codigo da observacao (vazio)
 */
function buildC190sFromNota(nota) {
    const grupos = new Map();  // key: "CST|CFOP|ALIQ" -> totais

    for (const item of (nota.itens || [])) {
        const cst = getCstIcms(item);
        const cstFmt = cst.length === 2 ? '0' + cst : cst.padStart(3, '0').slice(-3);
        const cfopRaw = String(item.cfop || item.CFOP || '0000');
        const cfop = convertCfopParaEntrada(cfopRaw, nota.direcao, nota._dados);

        const aliqIcms = item.aliqIcms || (
            item.vICMS && item.vBC ? (item.vICMS / item.vBC * 100) : 0
        );
        // Arredonda aliquota a 2 casas pra agrupamento estavel
        const aliqKey = (Math.round(aliqIcms * 100) / 100).toFixed(2);

        const key = `${cstFmt}|${cfop}|${aliqKey}`;

        if (!grupos.has(key)) {
            grupos.set(key, {
                cst: cstFmt,
                cfop,
                aliq: parseFloat(aliqKey),
                vlOpr: 0,
                vlBcIcms: 0,
                vlIcms: 0,
                vlBcIcmsSt: 0,
                vlIcmsSt: 0,
                vlIpi: 0,
            });
        }

        const g = grupos.get(key);
        g.vlOpr += parseFloat(item.vProd || item.valor || 0);
        g.vlBcIcms += parseFloat(item.vBC || 0);
        g.vlIcms += parseFloat(item.vICMS || 0);
        g.vlBcIcmsSt += parseFloat(item.vBCST || 0);
        g.vlIcmsSt += parseFloat(item.vICMSST || 0);
        g.vlIpi += parseFloat(item.vIPI || 0);
    }

    const linhas = [];
    for (const g of grupos.values()) {
        linhas.push(fmt.buildLine([
            'C190',
            g.cst,
            g.cfop,
            fmt.formatValue(g.aliq, 2),
            fmt.formatValue(g.vlOpr, 2),
            fmt.formatValue(g.vlBcIcms, 2),
            fmt.formatValue(g.vlIcms, 2),
            fmt.formatValue(g.vlBcIcmsSt, 2),
            fmt.formatValue(g.vlIcmsSt, 2),
            '0,00',  // VL_RED_BC
            fmt.formatValue(g.vlIpi, 2),
            '',  // COD_OBS
        ]));
    }
    return linhas;
}
