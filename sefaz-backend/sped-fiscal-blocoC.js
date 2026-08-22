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
import { montarC197Difal } from './sped-difal-c197.js';
import { cfopDoLancamento, derivarNaturezaAtividade } from './cfop-correlacao.js';
import { cstDoLancamento } from './cst-correlacao.js';
// Régua ÚNICA de QUAL documento entra no bloco — o modelo vem dela, nunca do
// campo cru `n.modelo`, que o importer principal não grava.
import {
    selecionarNotasBlocoC, avisosDaSelecao, codSitDoDocumento, serieDoDocumento,
    codItemDoItem, unidadeDoItem,
} from './sped-selecao-documentos.js';
import { modeloDoDoc, participanteDoDocumento, ehEmissaoPropriaDoc } from './participante-doc-helper.js';
import { docCancelado, ehNotaPropriaDeEntrada } from './xml-metadata-helper.js';
// Régua ÚNICA do VL_OPR — o valor da OPERAÇÃO não é a soma dos vProd (Guia
// 3.2.3, C190 campo 05). O gerador, o validador do editor e o autofix do C190
// leem daqui; eram três leituras, e as três discordavam do manual.
import { valorOperacaoDoItem } from './valor-operacao-c190.js';


/**
 * Soma os campos fiscais dos itens da nota.
 * Usado como fonte única de verdade pra VL_BC_ICMS/VL_ICMS/etc no C100,
 * garantindo que C100 = Σ C190 sempre (PVA valida essa igualdade).
 * Necessário porque algumas notas têm itens preenchidos mas totalizadores
 * (nota.totais.vBC, vICMS) vazios após parsing do XML.
 */
function somarTotaisDosItens(nota) {
    let vProd = 0, vBC = 0, vICMS = 0, vBCST = 0, vICMSST = 0;
    let vIPI = 0, vPIS = 0, vCOFINS = 0;
    for (const item of (nota && nota.itens) || []) {
        vProd += parseFloat(item.vProd || item.valor || 0);
        vBC += parseFloat(item.vBC || 0);
        vICMS += parseFloat(item.vICMS || 0);
        vBCST += parseFloat(item.vBCST || 0);
        vICMSST += parseFloat(item.vICMSST || 0);
        vIPI += parseFloat(item.vIPI || 0);
        vPIS += parseFloat(item.vPIS || 0);
        vCOFINS += parseFloat(item.vCOFINS || 0);
    }
    return { vProd, vBC, vICMS, vBCST, vICMSST, vIPI, vPIS, vCOFINS };
}

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

/**
 * Tenta extrair CST do ICMS de um item.
 * Aceita varias variacoes que XMLs costumam ter.
 * Fallback: '01' (ICMS comum).
 */
/**
 * O CST que VAI PARA O ARQUIVO, já correlacionado com o CFOP escriturado.
 *
 * Sempre 3 dígitos (origem + tributação), como o SPED exige. Quando a régua não
 * converte, ele é o do fornecedor — que é o comportamento de sempre.
 */
function cstDoItemNoArquivo(item, cfopLancado, nota) {
    const cru = getCstIcms(item);
    // O CST informado NAQUELA NOTA vence a régua — a precedência mora no DONO
    // (cstDoLancamento), nunca aqui, senão C170 e C190 divergiriam.
    const r = cstDoLancamento(cru, cfopLancado, nota?.cstEscriturado);
    const escolhido = r.cst || cru;
    return escolhido.length === 2 ? '0' + escolhido : String(escolhido).padStart(3, '0').slice(-3);
}

/**
 * SER do C100 — TRÊS posições, e '000' quando a nota não tem série.
 *
 * Guia Prático 3.2.3, C100 campo 07: *"campo de preenchimento obrigatório com
 * três posições … Se não existir Série … informar 000"*. O PVA ainda confere a
 * série contra a que está DENTRO da chave (3 dígitos), então o zero à esquerda
 * é justamente o que faz os dois baterem.
 */
export function serieDoC100(serie) {
    return serieDoDocumento({ serie });
}

/**
 * COD_SIT '08' para a nota emitida em SUBSTITUIÇÃO AO CUPOM FISCAL.
 *
 * Guia Prático 3.2.3, C100, Exceção 4: documentos emitidos por regime especial
 * ou norma específica são COD_SIT 08, e o manual dá o exemplo explícito —
 * *"Nota fiscal emitida em substituição ao cupom fiscal – CFOP igual a 5.929 ou
 * 6.929"*. O gerador mandava 00 (documento regular) nessas notas.
 * ⚠️ A ressalva do próprio manual: o contribuinte do PARANÁ escritura por outra
 * regra — por isso a UF entra na decisão em vez de a régua valer para todos.
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
export function convertCfopParaEntrada(rawCfop, direcao, dados, doc) {
    const empresa = dados?.empresa;
    const df = empresa?.dadosFiscais || {};
    // `doc` traz o CFOP informado NA NF, que vence a régua automática (decisão
    // do Paulo, 17/08: "é por NF"). Chamador que não passa o doc continua
    // caindo na correlação de sempre — nada regride.
    return cfopDoLancamento(doc, rawCfop, direcao, {
        naturezaAtividade: derivarNaturezaAtividade(empresa),
        cfopOverrides: df.cfopOverrides,
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
    const selecao = selecionarNotasBlocoC(dados.notas);
    const notas = selecao.notas;
    // O que NÃO entrou sai NOMEADO: nota que some do arquivo sem ninguém saber
    // é livro a menor — foi o defeito que a PS VIDROS denunciou.
    if (Array.isArray(dados.warnings)) dados.warnings.push(...avisosDaSelecao(selecao));

    // C001 — Abertura
    // Indicador de movimento: 0 = Bloco com dados, 1 = Bloco sem dados
    const indMovimento = notas.length > 0 ? '0' : '1';
    linhas.push(fmt.buildLine(['C001', indMovimento]));

    // Anexa referencia ao objeto dados em cada nota pra que helpers de CFOP
    // possam acessar empresa.dadosFiscais (naturezaAtividade + overrides).
    // Usa _ no nome pra deixar claro que eh metadata interno.
    for (const nota of notas) { nota._dados = dados; }

    // DIFAL de aquisicao: calculado UMA vez pro periodo, indexado por chave.
    // O debito na apuracao continua vindo do E111 (o C197 e a origem
    // documental, nao a conta) — o aviso diz isso na tela.
    const difal = montarC197Difal({
        notas,
        ufEmpresa: (dados.empresa?.dadosFiscais?.uf || '').toUpperCase(),
        aliqInternaPadrao: Number(dados.difalAliqInternaPadrao) || 18,
        aliqInternaPorChave: dados.difalAliqInternaPorChave || {},
        codigoAjuste: dados.difalCodigoAjusteC197 || '',
        codObservacao: dados.difalCodObservacao || '',
    });
    const difalPorChave = difal.linhasPorChave;
    if (Array.isArray(dados.warnings)) {
        for (const a of difal.avisos) dados.warnings.push(`DIFAL aquisição (C197): ${a}`);
    }
    dados.difalAquisicaoResumo = { total: difal.totalDifal, notas: difal.porNota };

    // Nota própria de IMPORTAÇÃO: o destinatário também é a própria empresa,
    // então o COD_PART sai com o CNPJ dela — o EXPORTADOR estrangeiro não vem
    // no XML e não se inventa participante. O e-Fiscal resolve com cadastro
    // manual (0150 do exportador); aqui a limitação é DITA, nunca calada.
    if (Array.isArray(dados.warnings)) {
        const cnpjEmp = String(dados?.empresa?.cnpj || '').replace(/\D/g, '');
        const importacoesSemExportador = notas.filter((n) => {
            if (!ehNotaPropriaDeEntrada(n, dados?.empresa?.cnpj).sim) return false;
            const p = participanteDoDocumento(n, dados?.empresa?.cnpj);
            const doc = String(p?.cnpjCpf || p?.cnpj || '').replace(/\D/g, '');
            return !!doc && doc === cnpjEmp;
        });
        if (importacoesSemExportador.length > 0) {
            const nums = importacoesSemExportador.map((n) => n.numero).filter(Boolean).join(', ');
            dados.warnings.push(
                `${importacoesSemExportador.length} nota(s) própria(s) de entrada (nº ${nums}) com participante `
                + '= a própria empresa: o XML da nota de importação não traz o fornecedor estrangeiro. '
                + 'O PVA pode pedir o participante do exterior no 0150 — se pedir, será preciso cadastrá-lo.',
            );
        }
    }

    // C100 + C170s + C190s pra cada nota
    for (const nota of notas) {
        try {
            // C100
            linhas.push(buildC100(nota, dados));

            // C170s — apenas se a nota nao for cancelada/denegada/inutilizada
            // (Guia Pratico: notas canceladas vao apenas com C100, sem C170)
            if (!docCancelado(nota) && nota.status !== 'denegado' && nota.status !== 'inutilizado') {
                // Guia Prático 3.2.3, C100, Exceção 2: NF-e de EMISSÃO PRÓPRIA
                // (IND_EMIT=0) leva somente C100 + C190 — sem C170.
                // 🚨 E saída não é a única emissão própria: a nota própria de
                // ENTRADA (importação, compra de produtor) também é. Ela saía
                // com IND_EMIT=0 **e** C170 desde a correção da manhã de
                // 21/08 — o arquivo se contradizendo. O EFD ICMS/IPI ACEITO da
                // REALITY prova: as duas notas de importação têm ZERO C170.
                // A régua é a MESMA do IND_EMIT (`ehEmissaoPropriaDoc`).
                const ehEmissaoPropria = ehEmissaoPropriaDoc(nota, dados?.empresa?.cnpj);
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

                // C195/C197 — DIFAL de aquisicao interestadual (uso/consumo e
                // ativo). So sai com o codigo de ajuste da tabela 5.3 do
                // estado cadastrado; sem ele vira aviso (nao se inventa).
                const c197 = difalPorChave[String(nota.chave || nota.id || '')];
                if (c197) for (const linha of c197) linhas.push(linha);
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
    // 🚨 O CAMPO `status` MENTE no caminho NORMAL do cancelamento: ele chega por
    // EVENTO e o campo continua 'autorizado' (régua de 11/08, MV LIDER). Quem
    // responde é `docCancelado` — senão a nota cancelada saía COD_SIT 00
    // (regular) e voltava ao livro pela porta do SPED.
    // COD_SIT pela régua ÚNICA (`codSitDoDocumento`): a tabela é a MESMA do
    // D100, e os dois blocos tinham defaults DIFERENTES para status
    // desconhecido — o D declarava '08' (regime especial), que é afirmar sobre
    // a natureza do documento. A régua cobre o cancelamento por evento e a
    // Exceção 4 (nota em substituição ao cupom, com a ressalva do PARANÁ).
    const codSit = codSitDoDocumento(nota, dados?.empresa?.dadosFiscais?.uf);

    // Soma dos itens — fonte primária pros campos que precisam bater com C190.
    // Fallback pra nota.totais.X apenas se os itens não tiverem (nota sem itens).
    const i = somarTotaisDosItens(nota);
    const pick = (itemSum, totalKey) => {
        const fromItens = parseFloat(itemSum || 0);
        const fromTotal = parseFloat(t[totalKey] || 0);
        // Se itens somam alguma coisa, sempre confia neles (faz C100=ΣC190).
        // Senão, usa o total da nota.
        return fromItens > 0 ? fromItens : fromTotal;
    };

    // Identifica participante e direcao — a régua do "outro lado" é ÚNICA
    // (participanteDoDocumento), a mesma do coletor do 0150: escolher o lado
    // aqui de novo foi o que fez a NOTA PRÓPRIA DE ENTRADA (importação da
    // REALITY 0899 · 07/2026) sair com COD_PART = a própria empresa E
    // IND_EMIT=1, quando a chave diz que quem emitiu foi ela (IND_EMIT=0).
    const indOper = nota.direcao === 'saida' ? '1' : '0';
    const propriaDeEntrada = ehNotaPropriaDeEntrada(nota, dados?.empresa?.cnpj).sim;
    const participante = participanteDoDocumento(nota, dados?.empresa?.cnpj);

    // 🚨 O COD_MOD SAI DA RÉGUA (PVA da PS VIDROS 07/2026, 19/08: *"O modelo da
    // chave do documento eletrônico não confere com o modelo do documento"* —
    // 35 ocorrências). Aqui estava `String(nota.modelo || '55')`: NFC-e
    // capturada, que não tem o campo gravado, saía declarada como modelo 55
    // com uma chave que diz 65. Mesmo campo cru, mesma causa do filtro.
    const codMod = modeloDoDoc(nota);

    // 🚨 NFC-e (65) TEM LEIAUTE PRÓPRIO NO C100 (86 ocorrências no mesmo PVA):
    // *"Para NF Eletrônica para consumidor final (COD_MOD = 65) não devem ser
    // informados os campos COD_PART, VL_BC_ICMS_ST, VL_ICMS_ST, VL_IPI,
    // VL_PIS, VL_COFINS, VL_PIS_ST e VL_COFINS_ST"*. É venda de balcão: não há
    // participante a declarar, e os tributos vão só no C190/C170.
    const ehNfce = codMod === '65';

    // 🚨 CANCELADA SAI QUASE VAZIA — Guia Prático 3.2.3, C100, Exceção 1:
    // *"Para documentos com código de situação cancelado (02), cancelado
    // extemporâneo (03) … preencher SOMENTE os campos REG, IND_OPER, IND_EMIT,
    // COD_MOD, COD_SIT, SER, NUM_DOC e CHV_NFe. Demais campos deverão ser
    // apresentados com conteúdo VAZIO. Não informar registros filhos."*
    // O gerador mandava a nota cancelada com todos os valores preenchidos.
    const ehCancelada = ['02', '03'].includes(codSit);
    const soCancelavel = (valor) => (ehCancelada ? '' : valor);
    const codPart = (!ehNfce && participante && (participante.cnpjCpf || participante.cnpj))
        ? String(participante.cnpjCpf || participante.cnpj).replace(/\D/g, '')
        : '';

    // IND_EMIT: 0=Emissao propria, 1=Terceiros. Nota própria de ENTRADA
    // (tpNF=0 emitida pela empresa — importação, compra de produtor rural)
    // é emissão PRÓPRIA mesmo sendo entrada: o e-Fiscal aceito da REALITY
    // declara |C100|0|0|…| nas duas notas de importação.
    const indEmit = (nota.direcao === 'saida' || propriaDeEntrada) ? '0' : '1';
    /** Campo que a NFC-e não pode informar — vazio, nunca 0,00. */
    const soNfe = (valor) => (ehNfce ? '' : valor);

    return fmt.buildLine([
        'C100',
        indOper,
        indEmit,
        codPart,
        codMod,
        codSit,
        // Guia Prático 3.2.3, C100 campo 07 (SER): *"campo de preenchimento
        // obrigatório com TRÊS POSIÇÕES … Se não existir Série … informar 000"*.
        // E o PVA confere a série contra a que está DENTRO da chave (3 dígitos),
        // então o zero à esquerda é o que faz os dois baterem.
        serieDoDocumento(nota),
        fmt.sanitizeString(String(nota.numero || ''), 9),
        fmt.sanitizeString(nota.chave || '', 44),
        soCancelavel(fmt.formatDate(nota.dhEmi)),
        soCancelavel(fmt.formatDate(nota.dhSaiEnt || nota.dhEmi)),
        soCancelavel(fmt.formatValue(t.vNF, 2)),
        soCancelavel('0'),  // IND_PGTO: assume A vista (default conservador)
        soCancelavel(fmt.formatValue(t.vDesc, 2)),
        '',   // VL_ABAT_NT
        soCancelavel(fmt.formatValue(pick(i.vProd, 'vProd'), 2)),
        soCancelavel('9'),  // IND_FRT: 9=Sem cobranca frete (default conservador)
        soCancelavel(fmt.formatValue(t.vFrete, 2)),
        soCancelavel(fmt.formatValue(t.vSeg, 2)),
        soCancelavel(fmt.formatValue(t.vOutro, 2)),
        soCancelavel(fmt.formatValue(pick(i.vBC, 'vBC'), 2)),       // VL_BC_ICMS — bate com ΣC190
        soCancelavel(fmt.formatValue(pick(i.vICMS, 'vICMS'), 2)),   // VL_ICMS
        soNfe(soCancelavel(fmt.formatValue(pick(i.vBCST, 'vBCST'), 2))),
        soNfe(soCancelavel(fmt.formatValue(pick(i.vICMSST, 'vST'), 2))),
        soNfe(soCancelavel(fmt.formatValue(pick(i.vIPI, 'vIPI'), 2))),
        soNfe(soCancelavel(fmt.formatValue(pick(i.vPIS, 'vPIS'), 2))),
        soNfe(soCancelavel(fmt.formatValue(pick(i.vCOFINS, 'vCOFINS'), 2))),
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
    const cfopLancado = convertCfopParaEntrada(item.cfop || item.CFOP || '0000', nota.direcao, nota._dados, nota);
    // 🔁 O CST SEGUE O CFOP ESCRITURADO — Paulo, 18/08: "a nota vai vir 5102,
    // vamos registrar como 1556; aí que está a chave do SPED: o CST do
    // fornecedor vai vir como 00, temos que indicar 90 para essas operações".
    // A régua mora em cst-correlacao.js e PRESERVA a origem (1º dígito), que é
    // fato da mercadoria e não da operação.
    const cstFmt = cstDoItemNoArquivo(item, cfopLancado, nota);

    const aliqIcms = item.aliqIcms || (
        item.vICMS && item.vBC ? (item.vICMS / item.vBC * 100) : 0
    );

    return fmt.buildLine([
        'C170',
        String(nItem).padStart(3, '0'),
        fmt.sanitizeString(codItemDoItem(item), 60),
        '',  // DESCR_COMPL
        fmt.formatValue(item.qCom || item.quantidade, 5),
        unidadeDoItem(item),
        fmt.formatValue(item.vProd || item.valor, 2),
        fmt.formatValue(item.vDesc, 2),
        '0',  // IND_MOV: 0=Sim (movimentacao fisica)
        cstFmt,
        fmt.sanitizeString(cfopLancado, 4),
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
 *  05 VL_OPR        Valor da OPERAÇÃO — mercadorias + frete/seguro/outras +
 *                   ICMS_ST + FCP_ST + IPI destacado − desconto incondicional
 *                   (Guia 3.2.3, C190 campo 05). NÃO é a soma dos vProd.
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
        const cfopRaw = String(item.cfop || item.CFOP || '0000');
        const cfop = convertCfopParaEntrada(cfopRaw, nota.direcao, nota._dados, nota);
        // O C190 agrupa por CST+CFOP: usar o CST cru aqui e o convertido no
        // C170 faria os dois registros do MESMO item discordarem — e é o C190
        // que a apuração soma.
        const cstFmt = cstDoItemNoArquivo(item, cfop, nota);

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
                vlRedBc: 0,
                vlIpi: 0,
            });
        }

        const g = grupos.get(key);
        // VL_OPR ≠ Σ vProd. A régua está em `valor-operacao-c190.js`, com a
        // citação do Guia 3.2.3 (C190, Campo 05) — foi o IPI faltando aqui que
        // fez o PVA da PWR somar 69.760,36 contra os 71.960,81 do livro.
        g.vlOpr += valorOperacaoDoItem(item);
        g.vlBcIcms += parseFloat(item.vBC || 0);
        g.vlIcms += parseFloat(item.vICMS || 0);
        g.vlBcIcmsSt += parseFloat(item.vBCST || 0);
        g.vlIcmsSt += parseFloat(item.vICMSST || 0);
        g.vlIpi += parseFloat(item.vIPI || 0);

        // Valor da redução de BC (obrigatório quando CST 20 ou 70).
        // Fórmula correta: vBC × pRedBC / (100 - pRedBC).
        // Fallback (parser legado sem pRedBC): max(0, vProd - vBC).
        const vBcItem = parseFloat(item.vBC || 0);
        const vProdItem = parseFloat(item.vProd || item.valor || 0);
        const pRedBC = parseFloat(item.pRedBC || 0);
        let itemRedBc = 0;
        if (pRedBC > 0 && pRedBC < 100 && vBcItem > 0) {
            itemRedBc = (vBcItem * pRedBC) / (100 - pRedBC);
        } else if (vProdItem > vBcItem && vBcItem > 0) {
            itemRedBc = vProdItem - vBcItem;
        }
        g.vlRedBc += itemRedBc;
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
            fmt.formatValue(g.vlRedBc, 2),  // VL_RED_BC — calculado dos itens
            fmt.formatValue(g.vlIpi, 2),
            '',  // COD_OBS
        ]));
    }
    return linhas;
}
