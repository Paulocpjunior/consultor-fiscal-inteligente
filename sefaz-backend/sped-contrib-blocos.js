// ============================================================================
// sefaz-backend/sped-contrib-blocos.js
// Blocos A, C, D, F, M, 1, 9 do EFD Contribuicoes (PIS/COFINS).
//
// MVP: estrutura completa com dados reais pra blocos C (NF-e) e M (apuracao).
// Blocos A (servicos), D (transporte), F (outros) geram estrutura minima.
//
// Layout: Guia Pratico EFD Contribuicoes 1.35.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';
// A régua das DUAS FORMAS do documento mora num lugar só (11/08).
import { normalizarParticipantesDoc } from './dipam-produtor-rural.js';
// 🚨 Cancelamento chega por EVENTO e o campo `status` fica 'autorizado'. Lendo
// o campo cru, a nota cancelada era DECLARADA À RECEITA nos blocos C/D/F —
// o pior desfecho da família de defeitos do MV LIDER 639 (11/08).
import { docCancelado, direcaoEfetivaDoc, valorDoDocumentoServico } from './xml-metadata-helper.js';
// A assinatura de alíquota que separa RETENÇÃO (0,65%+3%) de tributo da
// OPERAÇÃO (1,65%+7,60%) — a régua do R-4020, reusada pelo F600.
import { conferirRetencaoFederal } from './retencao-federal-coerencia.js';
// A leitura das retenções federais nas DUAS formas (achatada × objeto) é do
// DONO — o mesmo leitor que alimenta o R-4020. Segunda cópia divergiria.
import { lerRetencoesFederaisDoDoc } from './reinf-retencoes-pj.js';
// Régua ÚNICA de qual documento entra em qual bloco — o modelo vem dela.
import {
    selecionarNotasBlocoC, selecionarCtesBlocoD, avisosDaSelecao, ehNotaDeServico,
    serieDoDocumento, codItemDoItem, unidadeDoItem, levaC170NoContribuicoes,
} from './sped-selecao-documentos.js';
// O modelo mora na CHAVE; o campo cru `modelo` o importer principal não grava.
import {
    modeloDoDoc, participanteDoDocumento, ehEmissaoPropriaDoc,
} from './participante-doc-helper.js';
// CST e CFOP do C170 saem das MESMAS réguas do EFD ICMS/IPI — dois arquivos
// declarando códigos diferentes para o mesmo item é a divergência de sempre.
import { cstDoLancamento } from './cst-correlacao.js';
import { convertCfopParaEntrada, serieDoC100 } from './sped-fiscal-blocoC.js';
// Régua ÚNICA da base do PIS/COFINS — desconto incondicional fora da receita e
// ICMS fora da base (Tema 69). Estava faltando nos DOIS lugares que a usam (o
// C170 e o bloco M), e nos dois na direção mais cara.
import {
    receitaDoItem, baseDoItem, receitaEBaseDoDocumento, codigosReceitaM205,
    descontosDosItens, valoresLiquidosDosItens,
} from './base-pis-cofins.js';
// O valor total do documento (mercadorias + acessórias + ST + IPI − desconto) —
// o mesmo que o VL_OPR do C190 usa no EFD ICMS/IPI.
import { valorOperacaoDoItem } from './valor-operacao-c190.js';
// A receita que NÃO tem documento (aluguel) — F550. Régua única, com o
// arquivo aceito da AFFITTARE 05/2026 como fonte.
import { montarF550, montarF100, montar1900, CST_F550_TRIBUTADA } from './receita-sem-documento-f550.js';
// 🚨 A TERCEIRA fonte de receita sem documento: APLICAÇÃO FINANCEIRA (CF BANK
// 1109, 24/08). Alíquotas, CST e códigos de receita PRÓPRIOS — todos do EFD
// assinado da própria empresa.
import {
    montarReceitaFinanceira, CST_APLICACAO_FINANCEIRA,
    COD_CONT_APLICACAO_FINANCEIRA, CODIGOS_RECEITA_APLICACAO_FINANCEIRA,
    montar0500ContaReceita,
} from './receita-aplicacao-financeira.js';

// ─── Aliquotas PIS/COFINS por regime ────────────────────────────────────
const ALIQUOTAS = {
    // Regime cumulativo (Lucro Presumido)
    '2': { pis: 0.0065, cofins: 0.03 },
    // Regime nao-cumulativo (Lucro Real)
    '1': { pis: 0.0165, cofins: 0.076 },
    // Ambos: usa nao-cumulativo como padrao
    '3': { pis: 0.0165, cofins: 0.076 },
};

/**
 * Retorna aliquotas PIS/COFINS com base no regime de apuracao.
 */
function getAliquotas(regimeApuracao) {
    return ALIQUOTAS[regimeApuracao] || ALIQUOTAS['2'];
}

/**
 * Determina CST PIS/COFINS de um item com base no regime e direcao.
 *
 * CSTs comuns:
 *   01 = Operacao tributavel (aliquota basica)
 *   50 = Operacao com direito a credito (nao-cumulativo)
 *   70 = Operacao de aquisicao sem direito a credito
 */
function getCstPis(item, regimeApuracao, direcao) {
    if (item.cstPis || item.CSTPis || item.CSTPIS) {
        return String(item.cstPis || item.CSTPis || item.CSTPIS).padStart(2, '0');
    }
    if (direcao === 'saida') return '01';
    if (regimeApuracao === '1' || regimeApuracao === '3') return '50';
    return '70';
}

function getCstCofins(item, regimeApuracao, direcao) {
    if (item.cstCofins || item.CSTCofins || item.CSTCOFINS) {
        return String(item.cstCofins || item.CSTCofins || item.CSTCOFINS).padStart(2, '0');
    }
    if (direcao === 'saida') return '01';
    if (regimeApuracao === '1' || regimeApuracao === '3') return '50';
    return '70';
}

// ─── Constantes do C100/C170 do bloco C ─────────────────────────────────
/** IND_FRT 9 = sem cobrança de frete — o mesmo que o EFD ICMS/IPI declara. */
const IND_FRT_SEM_COBRANCA = '9';
/** IND_MOV 0 = houve movimentação física. Mercadoria em NF-e sempre tem. */
const IND_MOV_COM_MOVIMENTACAO = '0';
/** IND_APUR 0 = apuração mensal do IPI. */
const IND_APUR_MENSAL = '0';
/**
 * COD_CONT do M210/M610 (Tabela 4.3.5 — Códigos de Contribuição Social Apurada).
 *   01 = Contribuição NÃO-cumulativa apurada a alíquota básica
 *   51 = Contribuição CUMULATIVA apurada a alíquota básica
 * Provado no EFD-Contribuições ACEITO da PWR (03/2026): |M210|51|19580|...|0,65|
 */
const COD_CONT_NAO_CUMULATIVO = '01';
const COD_CONT_CUMULATIVO = '51';

/**
 * CST_ICMS do C170 do EFD-Contribuições — a MESMA régua do EFD ICMS/IPI.
 *
 * Três dígitos (origem + tributação) e correlacionado com o CFOP escriturado.
 * Reimplementar aqui faria os DOIS arquivos declararem CST diferente para o
 * mesmo item — a divergência que este projeto mais paga.
 */
function cstIcmsDoItemContrib(item, cfopLancado, nota) {
    const cru = String(
        item.cstIcms || item.cst || item.CST || item.CSTICMS || item.cst_icms || item.icmsCst || '',
    ).replace(/\D/g, '');
    if (!cru) return '';   // item sem CST não recebe CST deduzido do CFOP
    const r = cstDoLancamento(cru, cfopLancado, nota?.cstEscriturado);
    const escolhido = String(r.cst || cru);
    return escolhido.length === 2 ? `0${escolhido}` : escolhido.padStart(3, '0').slice(-3);
}

/**
 * 🚨 NA ENTRADA, O CST DE PIS/COFINS DO XML É O DO FORNECEDOR — e ele descreve
 * a operação DELE.
 *
 * O importer captura `cstPis`/`cstCofins` do XML desde #563, e o gerador os
 * usava direto. Numa nota de COMPRA isso escreve `01` (*Operação Tributável com
 * Alíquota Básica*) no C170 do comprador — código que **nem existe na Tabela
 * 4.3.7**, que é a das AQUISIÇÕES (50-56 com crédito, 70-75 sem, 98, 99).
 *
 * É a MESMA lição, terceira vez: o CST do ICMS 00 → 90 na entrada de
 * uso/consumo (18/08) e a correspondência do IPI da IN RFB 932/2009 (11/08).
 * Quem decide na entrada é o REGIME de quem escritura:
 *   · não-cumulativo → 50 (aquisição COM direito a crédito)
 *   · cumulativo     → 70 (aquisição SEM direito a crédito)
 *
 * Na SAÍDA vale o contrário: o documento é NOSSO, então o CST do item é o
 * nosso e continua vencendo.
 *
 * ⚠️ Com CST sem crédito, base e valor saem ZERO — e aqui zero É a resposta
 * ("não há crédito a apropriar"), não default de campo em branco.
 */
/**
 * VL_DOC do C100 — o valor TOTAL do documento.
 *
 * O `vNF` da própria nota vence quando existe: é o número que a DANFE imprime e
 * que o destinatário paga. Sem ele, deriva pelos itens com a MESMA régua do
 * VL_OPR do C190 (mercadorias + frete/seguro/outras + ST + IPI − desconto),
 * para os dois arquivos não declararem totais diferentes do mesmo documento.
 */
function valorTotalDoDocumento(nota, totais) {
    const vNF = parseFloat((totais || {}).vNF || 0);
    if (Number.isFinite(vNF) && vNF > 0) return vNF;
    return (nota.itens || []).reduce((s, i) => s + valorOperacaoDoItem(i), 0);
}

function pisCofinsDoItemC170(item, direcao, regimeApuracao, aliq, liquidoDoItem) {
    const vlItem = Number.isFinite(liquidoDoItem)
        ? liquidoDoItem
        : parseFloat(item.vProd || item.valor || 0) || 0;
    if (direcao === 'saida') {
        const cstPis = getCstPis(item, regimeApuracao, 'saida');
        const cstCofins = getCstCofins(item, regimeApuracao, 'saida');
        const aliqPis = parseFloat(item.aliqPIS || item.pAliquotaPis || 0) || aliq.pis * 100;
        const aliqCofins = parseFloat(item.aliqCOFINS || item.pAliquotaCofins || 0) || aliq.cofins * 100;
        // 🚨 A BASE NÃO É O `vBcPis` DO XML NEM O `vProd` (Paulo, 20/08: *"não
        // deduziu o ICMS da base do PIS/COFINS e também não considerou o
        // desconto"*). O XML traz a base do EMITENTE, calculada sobre a
        // mercadoria cheia; do lado de cá vale a receita líquida do desconto
        // MENOS o ICMS destacado (Tema 69). O arquivo ACEITO desta mesma
        // empresa prova: VL_BC_PIS 16.055,60 = VL_ITEM 19.580 − ICMS 3.524,40.
        // O líquido já vem do dono (desconto próprio + rateio do documento);
        // sem ele, cai no `baseDoItem`, que só conhece o desconto do ITEM.
        const base = Number.isFinite(liquidoDoItem)
            ? Math.max(0, vlItem - (parseFloat(item.vICMS || 0) || 0))
            : baseDoItem(item);
        // ⚠️ E O VALOR SEGUE A BASE, nunca o destacado no documento: no aceito,
        // o C170 traz 104,36 (0,65% da base reduzida) enquanto o C100 traz
        // 127,27 (o que o emitente destacou). Manter o destacado aqui faria o
        // próprio registro se desmentir — base × alíquota ≠ valor declarado.
        return {
            cstPis, cstCofins,
            basePis: base, baseCofins: base,
            aliqPis, aliqCofins,
            vlPis: base * (aliqPis / 100),
            vlCofins: base * (aliqCofins / 100),
        };
    }
    const naoCumulativo = regimeApuracao === '1' || regimeApuracao === '3';
    const cst = naoCumulativo ? '50' : '70';
    if (!naoCumulativo) {
        return {
            cstPis: cst, cstCofins: cst,
            basePis: 0, baseCofins: 0, aliqPis: 0, aliqCofins: 0, vlPis: 0, vlCofins: 0,
        };
    }
    return {
        cstPis: cst, cstCofins: cst,
        basePis: vlItem, baseCofins: vlItem,
        aliqPis: aliq.pis * 100, aliqCofins: aliq.cofins * 100,
        vlPis: vlItem * aliq.pis, vlCofins: vlItem * aliq.cofins,
    };
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO A — Servicos (NFSe)
// ═══════════════════════════════════════════════════════════════════════

/**
 * COD_SIT do A100 — situação do documento.
 *
 * '00' = documento REGULAR. Aqui ele é AFIRMÁVEL, e isso importa: a cancelada
 * já sai em `filtrarNotasBlocoA`, então o que chega ao A100 é regular por
 * CONSTRUÇÃO. Não é default de campo fiscal; é consequência do filtro.
 */
const COD_SIT_REGULAR = '00';

/**
 * IND_PGTO do A100 — 0 à vista · 1 a prazo · 9 sem pagamento.
 *
 * ⚠️ ESTE É O ÚNICO CAMPO DESTE PR QUE O DOCUMENTO NÃO RESPONDE. A NFS-e não
 * traz forma de pagamento em campo nenhum, e o PVA exige o campo preenchido
 * (37 recusas na MANTOAN 07/2026).
 *
 * Ou seja: não dá para deixar vazio, e não dá para saber. A saída da casa nesse
 * caso não é escolher em silêncio — é escolher e DIZER: o gerador declara "à
 * vista" e devolve um aviso NOMEADO com a contagem, para quem entrega saber o
 * que foi afirmado em nome do cliente.
 *
 * 📌 Ele NÃO entra em conta nenhuma: base, PIS, COFINS e o bloco M são os
 * mesmos com qualquer valor aqui. É informação cadastral do documento.
 */
const IND_PGTO_PADRAO = '0';

/**
 * CSTs de aquisição que GERAM crédito (Tabela 4.3.7) — só neles o campo
 * NAT_BC_CRED do A170 existe.
 */
const CSTS_COM_CREDITO = new Set(['50', '51', '52', '53', '54', '55', '56']);

/** Descrição do item quando o documento não traz itens capturados. */
function descricaoDoServico(nota) {
    const d = nota?.discriminacao || nota?.descricaoServico || nota?.servico?.discriminacao;
    if (d && String(d).trim()) return String(d).trim();
    return 'Prestação de serviços conforme documento fiscal';
}

/**
 * COD_ITEM do A170 quando o documento não traz itens capturados (NFS-e do
 * portal, que grava `valorTotal` em vez de `itens[]`).
 *
 * Paulo, 18/08 (MANTOAN, 3ª rodada do PVA): 36 recusas "Campo obrigatório não
 * informado · COD_ITEM" — o item sintético do A170 saía com `cod: ''`. Não é
 * item de estoque nenhum (não existe cProd numa NFS-e sem discriminação), então
 * inventar um código POR DOCUMENTO seria fingir um catálogo que não existe. A
 * saída é UM código FIXO e reconhecível, que representa "serviço sem item
 * discriminado" — e ele PRECISA aparecer no 0200 (Bloco 0), senão o A170 aponta
 * para um item que a Tabela de Identificação não cadastrou.
 */
export const COD_ITEM_SERVICO_GENERICO = 'SERV-GENERICO';

/**
 * O VALOR do documento de serviço, nas formas em que ele chega.
 *
 * A NFS-e do portal de SP grava `valorTotal`/`valorServicos` e o espelho
 * `totais.vNF`; a do XML/abrasf grava `valor`; o lançamento manual grava
 * `valorTotal`. Ler um nome só zerava o arquivo inteiro sem avisar.
 *
 * ⚠️ Devolve NaN quando NENHUMA forma tem número — e NaN é de propósito: quem
 * chama precisa distinguir "documento de R$ 0,00" (existe, é raro e é legítimo)
 * de "não achei o valor". Zero silencioso aqui foi o defeito de 17/08.
 */
// A régua do VALOR mudou de casa (21/08): ela é lida também pelo bloco D do
// EFD ICMS/IPI, e régua de leitura de documento mora no dono
// (`xml-metadata-helper`). Re-exportada aqui para nada quebrar — mesmo
// desenho do `decidirGravacaoNFe`, que saiu do importer para a régua própria.
export { valorDoDocumentoServico };

export function filtrarNotasBlocoA(notas) {
    return (notas || []).filter(n => {
        // Cancelada não se declara: os blocos C/D/F já a pulavam e o A não —
        // então NFS-e cancelada saía com PIS/COFINS calculados em cima dela.
        // ⚠️ PULA, não emite COD_SIT '02': o leiaute do documento cancelado
        // neste bloco não está provado contra arquivo aceito, e inventar código
        // de situação é o oposto da régua da casa. Omitir não declara nada a
        // menos — a nota cancelada não tem valor a declarar.
        if (docCancelado(n)) return false;
        // 🚨 A régua é a DONA da seleção por bloco (`ehNotaDeServico`), não o
        // campo cru: perguntar `n.tipo === 'NFSe'` cobre a forma mais rara — a
        // NFS-e do portal de SP entra por CSV/TXT gravando prestador/tomador, e
        // a do ADN grava `tipoDoc`. Documento desses trilhos sumia do bloco A,
        // e sumir do bloco A é sumir da apuração de PIS/COFINS, calada.
        return ehNotaDeServico(n);
    });
}

export function buildBlocoA(dados) {
    const linhas = [];
    /** Documentos que o PVA recusaria por VL_DOC = 0 — saem, mas NOMEADOS. */
    const valorZero = [];
    const notasA = filtrarNotasBlocoA(dados.notas);
    const regimeApuracao = dados.regimeApuracao || '2';
    const aliq = getAliquotas(regimeApuracao);

    if (notasA.length === 0) {
        linhas.push(fmt.buildLine(['A001', '1']));
        linhas.push(fmt.buildLine(['A990', '2']));
        return linhas;
    }

    linhas.push(fmt.buildLine(['A001', '0']));
    linhas.push(fmt.buildLine(['A010', fmt.sanitizeCnpjCpf(dados.empresa.cnpj)]));

    // VL_PIS_RET/VL_COFINS_RET do A100 saem da MESMA coleta do F600 e do M
    // (caso HS 07/2026 — o arquivo aceito de 05/2026 preenche esses campos em
    // toda saída retida). Uma segunda leitura aqui faria o A100 e o F600
    // contarem retenções diferentes no MESMO arquivo. Warnings mudos: quem
    // nomeia o que ficou de fora é o bloco F, uma vez só.
    const retF600 = dados.retencoesF600 || coletarRetencoesF600(dados.notas, null);
    const retPorNota = new Map((retF600.eventos || []).map(e => [String(e.numero), e]));

    for (const notaCrua of notasA) {
        // 🚨 O DOCUMENTO CHEGA EM DUAS FORMAS — e ler só a ANINHADA zerou tudo.
        //
        // 17/08 (CLINICA MEDICA MANTOAN 07/2026): o arquivo saiu com **37 A100 e
        // TODOS com COD_PART vazio e VL_DOC 0,00**. Os documentos estavam lá; o
        // que faltava era a leitura. A NFS-e do portal de SP entra ACHATADA
        // (`cnpjDest`, `valorTotal`), e este bloco lia só `nota.destinatario` e
        // `nota.valor` — nomes que aquele trilho não usa.
        //
        // É a MESMA armadilha de 11/08 (caso EDUARDO GUERRA × DAMIÃO), e a régua
        // já existe: `normalizarParticipantesDoc` monta o aninhado a partir dos
        // campos chatos. Reimplementar aqui seria a segunda cópia de sempre.
        const nota = normalizarParticipantesDoc(notaCrua);
        // ⚠️ Pela RÉGUA, como o C100 e o C170 deste MESMO arquivo. Aqui só
        // entra NFS-e (o `filtrarNotasBlocoA` já garante), e NFS-e não tem
        // `tpNF` — então a resposta é a mesma. O que não pode é o bloco A
        // perguntar de um jeito e os blocos vizinhos de outro: é assim que os
        // dois começam a divergir no dia em que a régua aprende um caso novo.
        const direcao = direcaoEfetivaDoc(nota);
        const indOper = direcao === 'saida' ? '1' : '0';
        const indEmit = direcao === 'saida' ? '0' : '1';

        const participanteRaw = direcao === 'saida' ? nota.destinatario : nota.emitente;
        const codPart = participanteRaw
            ? String(participanteRaw.cnpjCpf || participanteRaw.cnpj || participanteRaw.CNPJ || '').replace(/\D/g, '')
            : '';

        const vlDoc = valorDoDocumentoServico(nota);

        // 🚨 A100 COM VL_DOC = 0,00 É RECUSADO PELO PVA ("Valor informado deve
        // ser maior que zero" — MANTOAN 07/2026, 1 ocorrência). O documento não
        // some calado: ele sai NOMEADO, porque some da conta é o que faz alguém
        // achar que declarou tudo. Zero não muda base nenhuma, então o número
        // continua o mesmo — o que muda é o arquivo passar.
        if (!Number.isFinite(vlDoc) || vlDoc <= 0) {
            valorZero.push(String(nota.numero || nota.chave || '(sem número)'));
            continue;
        }

        const vlPis = vlDoc * aliq.pis;
        const vlCofins = vlDoc * aliq.cofins;
        const retido = retPorNota.get(String(nota.numero || nota.chave || '(sem número)'));

        linhas.push(fmt.buildLine([
            'A100',
            indOper, indEmit, codPart,
            // COD_SIT '00' = documento REGULAR. Ele pode ser afirmado porque a
            // cancelada já sai daqui em `filtrarNotasBlocoA` — o que resta é
            // regular por construção, não por suposição.
            COD_SIT_REGULAR,
            '',      // SER
            '', fmt.sanitizeString(nota.numero || '', 60),
            '',  // CHV_NFSE
            fmt.formatDate(nota.dataEmissao || nota.dhEmi),
            fmt.formatDate(nota.dataEmissao || nota.dhEmi),
            fmt.formatValue(vlDoc),
            IND_PGTO_PADRAO,
            '',  // VL_DESC
            fmt.formatValue(vlDoc), fmt.formatValue(vlPis),
            fmt.formatValue(vlDoc), fmt.formatValue(vlCofins),
            // VL_PIS_RET · VL_COFINS_RET — só quando a coleta do F600 aceitou a
            // nota como retenção (mesma régua); ausência fica em branco, nunca 0.
            retido ? fmt.formatValue(retido.pis) : '',
            retido ? fmt.formatValue(retido.cofins) : '',
            '',  // VL_ISS
        ]));

        // 🚨 O A170 É REGISTRO FILHO OBRIGATÓRIO — e ele NUNCA SAÍA.
        //
        // Paulo, 18/08, com o 2º recibo do PVA da MANTOAN: **37 ocorrências de
        // "Registro filho obrigatório não foi informado · A170"**, uma para cada
        // A100. A causa é a ARMADILHA DAS DUAS FORMAS pela nona vez: a NFS-e do
        // portal de SP entra SEM `itens` (ela grava `valorTotal`), e este laço
        // percorre `nota.itens` — então ele nunca rodava.
        //
        // ✂️ Documento de serviço sem itens capturados vira UM item, com o valor
        // do próprio documento. Não é invenção: é a mesma leitura que o A100 ao
        // lado já faz (`valorDoDocumentoServico`), um registro adiante.
        const itensDoDoc = (nota.itens || []).length
            ? nota.itens.map((item, i) => ({
                nItem: item.nItem || String(i + 1),
                cod: codItemDoItem(item),
                descr: item.xProd || item.descricao || '',
                valor: parseFloat(item.vProd || item.valor || 0),
                item,
            }))
            : [{
                nItem: '1',
                cod: COD_ITEM_SERVICO_GENERICO,
                descr: descricaoDoServico(nota),
                valor: vlDoc,
                item: {},
            }];

        for (const it of itensDoDoc) {
            const cstPis = getCstPis(it.item, regimeApuracao, direcao);
            const cstCofins = getCstCofins(it.item, regimeApuracao, direcao);
            // ⚠️ NAT_BC_CRED só existe quando HÁ crédito (CST de aquisição
            // 50-56) — campo fiscal não recebe default.
            const comCredito = CSTS_COM_CREDITO.has(cstPis);
            // 🚨 IND_ORIG_CRED — Paulo, 18/08, 3ª rodada do PVA da MANTOAN: 3
            // recusas em itens de ENTRADA com CST 70 (sem crédito), com a
            // mensagem "Campo obrigatório PARA NOTAS FISCAIS DE ENTRADA". O
            // código anterior condicionava este campo ao CST TER crédito — e
            // a mensagem do PVA desmente essa premissa: quem manda aqui é a
            // DIREÇÃO do documento, não o CST. Toda entrada leva IND_ORIG_CRED
            // (0 = mercado interno), tenha ou não direito a crédito; saída não
            // tem o campo (ele descreve a origem da AQUISIÇÃO).
            const indOrigemCredito = direcao !== 'saida' ? '0' : '';
            linhas.push(fmt.buildLine([
                'A170',
                it.nItem,
                fmt.sanitizeString(it.cod, 60),
                fmt.sanitizeString(it.descr, 255),
                fmt.formatValue(it.valor),
                '',                                   // VL_DESC
                comCredito ? '01' : '',               // NAT_BC_CRED
                indOrigemCredito,                     // IND_ORIG_CRED
                cstPis,
                fmt.formatValue(it.valor),
                fmt.formatValue(aliq.pis * 100, 4),
                fmt.formatValue(it.valor * aliq.pis),
                cstCofins,
                fmt.formatValue(it.valor),
                fmt.formatValue(aliq.cofins * 100, 4),
                fmt.formatValue(it.valor * aliq.cofins),
                '', '',                               // COD_CTA, COD_CCUS
            ]));
        }
    }

    // Nada sai calado deste bloco: o que ficou de fora e o que foi AFIRMADO em
    // nome do cliente voltam nos warnings da geração.
    if (Array.isArray(dados.warnings)) {
        if (valorZero.length) {
            dados.warnings.push(
                `Bloco A: ${valorZero.length} documento(s) de serviço ficaram FORA porque o valor é `
                + `R$ 0,00 e o PVA recusa A100 com VL_DOC zerado — nº ${valorZero.slice(0, 10).join(', ')}`
                + `${valorZero.length > 10 ? ` e mais ${valorZero.length - 10}` : ''}. `
                + 'Não muda base nenhuma (zero não soma), mas confira se a nota deveria estar cancelada.',
            );
        }
        const comA100 = linhas.filter(l => l.startsWith('|A100|')).length;
        if (comA100) {
            dados.warnings.push(
                `Bloco A: ${comA100} documento(s) saíram com IND_PGTO = "0" (à vista). A NFS-e não traz `
                + 'forma de pagamento em campo nenhum e o PVA exige o campo — o app DECLARA à vista e '
                + 'avisa, em vez de escolher calado. Não afeta base, PIS, COFINS nem o bloco M.',
            );
        }
    }

    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['A990', totalBloco]));
    return linhas;
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO C — Mercadorias (NF-e modelo 55/65)
// ═══════════════════════════════════════════════════════════════════════

export function buildBlocoC_Contrib(dados) {
    const linhas = [];
    const selecaoC = selecionarNotasBlocoC(dados.notas);
    const notasC = selecaoC.notas;
    if (Array.isArray(dados.warnings)) dados.warnings.push(...avisosDaSelecao(selecaoC));
    const regimeApuracao = dados.regimeApuracao || '2';
    const aliq = getAliquotas(regimeApuracao);

    if (notasC.length === 0) {
        linhas.push(fmt.buildLine(['C001', '1']));
        linhas.push(fmt.buildLine(['C990', '2']));
        return linhas;
    }

    linhas.push(fmt.buildLine(['C001', '0']));
    linhas.push(fmt.buildLine([
        'C010',
        fmt.sanitizeCnpjCpf(dados.empresa.cnpj),
        regimeApuracao === '1' ? '1' : '2',
    ]));

    for (const notaCrua of notasC) {
        if (docCancelado(notaCrua) || notaCrua.status === 'denegado') continue;

        // 🚨 AS TRÊS RÉGUAS DA CASA, que este C100 não tinha (21/08, varredura
        // dos leitores de documento). Ele lia o participante SÓ na forma
        // ANINHADA — e o importer principal grava ACHATADO (`cnpjEmit`/
        // `cnpjDest`), então **toda nota capturada automaticamente saía com
        // COD_PART VAZIO**. É o defeito de 17/08 (37 A100 da MANTOAN sem
        // participante) vivo um bloco adiante, no arquivo que a PWR ainda vai
        // regerar. E o participante do C100 tem de ser o MESMO que o 0150
        // cadastra, senão o registro aponta para um participante que não existe.
        const nota = normalizarParticipantesDoc(notaCrua);
        const direcao = direcaoEfetivaDoc(nota);
        const indOper = direcao === 'saida' ? '1' : '0';
        // ⚠️ IND_EMIT pela régua da EMISSÃO, não pela direção: a nota própria de
        // ENTRADA (art. 136, tpNF=0) é emissão PRÓPRIA e saía '1' (terceiros).
        // 🚨 E É SÓ O IND_EMIT: a Exceção 2 do Guia do ICMS/IPI — "emissão
        // própria não leva C170" — **NÃO vale aqui**. No EFD-Contribuições o
        // C170 é quem carrega o detalhe de PIS/COFINS do item, e o arquivo
        // ACEITO da PWR (03/2026) tem C170 nas notas próprias. Portar a regra
        // inteira apagaria a apuração.
        const indEmit = ehEmissaoPropriaDoc(nota, dados.empresa?.cnpj) ? '0' : '1';

        const participanteRaw = participanteDoDocumento(nota, dados.empresa?.cnpj);
        const codPart = participanteRaw
            ? String(participanteRaw.cnpjCpf || participanteRaw.cnpj || participanteRaw.CNPJ || '').replace(/\D/g, '')
            : '';

        // 🚨 O VL_MERC SAI LÍQUIDO DO DESCONTO INCONDICIONAL (Paulo, 25/08,
        // PWR: *"o valor da receita não pode ser esses 38.316,84 e sim
        // 37.754,60 conforme a ficha financeira — tem que ajustar no C100"*).
        // A receita que o PVA mostra no M210 vem dos DOCUMENTOS, então
        // enquanto o C100 declarar a mercadoria CHEIA ela sai bruta por
        // construção. O `VL_DESC` continua informado, dizendo quanto foi
        // tirado — e o `VL_ITEM` do C170 usa a MESMA régua, senão a soma dos
        // filhos deixaria de fechar com o pai.
        const liquidosDosItens = valoresLiquidosDosItens(nota);
        const descontosPorItem = descontosDosItens(nota);
        let vProd = 0, vDesc = 0, vPis = 0, vCofins = 0;
        (nota.itens || []).forEach((item, k) => {
            vProd += liquidosDosItens[k] || 0;
            vDesc += descontosPorItem[k] || 0;
            vPis += parseFloat(item.vPIS || 0);
            vCofins += parseFloat(item.vCOFINS || 0);
        });
        if (vPis === 0) vPis = vProd * aliq.pis;
        if (vCofins === 0) vCofins = vProd * aliq.cofins;

        const chave = nota.chaveAcesso || nota.chave || '';
        const t = nota.totais || {};
        const somaItem = (campo) => (nota.itens || [])
            .reduce((s, i) => s + (parseFloat(i[campo] || 0) || 0), 0);
        const doDoc = (soma, chaveTotal) => (soma > 0 ? soma : (parseFloat(t[chaveTotal] || 0) || 0));

        // ═══════════════════════════════════════════════════════════════════
        // 🚨 C100 — 29 CAMPOS, e este gerador emitia 24 (PWR 1364 · 07/2026).
        //
        // O PVA recusou o arquivo inteiro na IMPORTAÇÃO: 157 erros, todos em
        // C100 e C170, começando por *"O número de campos informado no registro
        // difere do número de campos especificado no leiaute do arquivo"*.
        //
        // A causa não era um campo faltando no fim: o bloco C do
        // EFD-Contribuições foi escrito PULANDO a seção de ICMS/IPI, então o
        // PIS e a COFINS caíam nas casas de VL_BC_ICMS/VL_ICMS. O arquivo
        // declarava PIS onde a Receita lê ICMS.
        //
        // O gabarito é o EFD-Contribuições ACEITO desta MESMA empresa (03/2026,
        // e-Fiscal, assinado) — a régua "arquivo aceito > leiaute deduzido":
        //   |C100|1|0|7FX0YC9FP|55|00|001|1|<chave>|28032026|28032026|19580|0|0|
        //    0|19580|1|0|0|0|19580|3524,4|0|0|0|127,27|587,4|0|0|
        //
        // ⚠️ E POR QUE ISTO SÓ APARECEU AGORA: MANTOAN e HS PROJETOS são de
        // SERVIÇO e fecham pelo bloco A (A100/A170). A PWR é INDÚSTRIA — é a
        // primeira a passar pelo bloco C do EFD-Contribuições. Paulo disse
        // exatamente isso: *"agora estamos falando do PIS e COFINS de
        // Indústria"*.
        // ═══════════════════════════════════════════════════════════════════
        linhas.push(fmt.buildLine([
            'C100',
            indOper, indEmit, codPart,
            // O modelo sai da RÉGUA, nunca do campo cru — o importer principal
            // não grava `modelo` (lição da PS VIDROS 0896, 19/08).
            modeloDoDoc(nota),
            '00',                                          // COD_SIT (cancelada já saiu acima)
            serieDoDocumento(nota),                       // SER — três posições
            fmt.sanitizeString(nota.numero || '', 9),
            fmt.sanitizeString(chave, 44),
            fmt.formatDate(nota.dataEmissao || nota.dhEmi),
            fmt.formatDate(nota.dataEntradaSaida || nota.dhEmi),
            // 🚨 VL_DOC É O VALOR TOTAL DO DOCUMENTO, e ele DESCONTA (Paulo,
            // 20/08). Aqui saía `Σ vProd`: a NF 7 da PWR ia com 18.741,24
            // enquanto a própria DANFE diz `V. TOTAL DA NOTA 18.179,00` —
            // 18.741,24 menos o desconto de 562,24. A régua é a mesma do VL_OPR
            // do C190 (mercadorias + acessórias + ST + IPI − desconto); o vNF do
            // documento vence quando existe, porque é o que a nota declara.
            fmt.formatValue(valorTotalDoDocumento(nota, t)),  // 12 VL_DOC
            IND_PGTO_PADRAO,                               // 13 IND_PGTO
            fmt.formatValue(vDesc),                        // 14 VL_DESC
            '',                                            // 15 VL_ABAT_NT
            fmt.formatValue(vProd),                        // 16 VL_MERC
            IND_FRT_SEM_COBRANCA,                          // 17 IND_FRT
            fmt.formatValue(t.vFrete || 0),                // 18 VL_FRT
            fmt.formatValue(t.vSeg || 0),                  // 19 VL_SEG
            fmt.formatValue(t.vOutro || 0),                // 20 VL_OUT_DA
            fmt.formatValue(doDoc(somaItem('vBC'), 'vBC')),          // 21 VL_BC_ICMS
            fmt.formatValue(doDoc(somaItem('vICMS'), 'vICMS')),      // 22 VL_ICMS
            fmt.formatValue(doDoc(somaItem('vBCST'), 'vBCST')),      // 23 VL_BC_ICMS_ST
            fmt.formatValue(doDoc(somaItem('vICMSST'), 'vST')),      // 24 VL_ICMS_ST
            fmt.formatValue(doDoc(somaItem('vIPI'), 'vIPI')),        // 25 VL_IPI
            fmt.formatValue(vPis),                         // 26 VL_PIS
            fmt.formatValue(vCofins),                      // 27 VL_COFINS
            '',                                            // 28 VL_PIS_ST
            '',                                            // 29 VL_COFINS_ST
        ]));

        // ═══════════════════════════════════════════════════════════════════
        // 🚨 C170 — 37 CAMPOS, e este gerador emitia 23.
        //
        // Mesmo defeito, mesma causa: a seção de ICMS/IPI (campos 10 a 24) foi
        // pulada, e o CST_PIS foi parar na casa do CST_ICMS, a base do PIS na
        // do CFOP, a alíquota na de COD_NAT. Daí os 79 *"Tamanho do campo
        // inválido"* e os 46 *"Conteúdo do campo inválido"* — todos derivados,
        // um único defeito de forma.
        //
        // ⚠️ O CST_ICMS e o CFOP saem das MESMAS RÉGUAS do EFD ICMS/IPI. Dois
        // arquivos declarando CFOP diferente para o mesmo item seria a
        // divergência que este projeto mais paga.
        //
        // 🚨 E A NFC-e NÃO LEVA C170 (HYPE CAFE 1385 · 07/2026, 24/08): o PVA
        // recusou **572 vezes** — 286 C170, cada um com as duas mensagens
        // (*"não deve ser informado para o modelo de documento do Registro
        // Pai"* e *"…para esse perfil e/ou tipo de operação"*). Quem responde é
        // o DONO, e a coleta do 0200 lê o MESMO dono: item de documento sem
        // C170 declarado na Tabela de Identificação vira item ÓRFÃO, que é a
        // recusa seguinte (a PWR pagou essa em 19/08).
        // ═══════════════════════════════════════════════════════════════════
        if (!levaC170NoContribuicoes(nota)) continue;
        (nota.itens || []).forEach((item, k) => {
            // ⚠️ MESMA RÉGUA DO VL_MERC: o item entra líquido do desconto
            // incondicional, e o desconto vai no campo próprio.
            const descontoItem = descontosPorItem[k] || 0;
            const vlItem = liquidosDosItens[k] || 0;
            const cfopLancado = convertCfopParaEntrada(
                item.cfop || item.CFOP || '0000', direcao, dados, nota,
            );
            const cstIcms = cstIcmsDoItemContrib(item, cfopLancado, nota);
            const aliqIcmsItem = parseFloat(item.aliqIcms || 0)
                || (item.vICMS && item.vBC ? (item.vICMS / item.vBC) * 100 : 0);

            // ⚠️ A BASE lê o MESMO líquido: com o desconto lançado só no total
            // do documento, `baseDoItem(item)` não o enxergaria e a base sairia
            // cheia — o registro se desmentiria dentro da própria linha.
            const p = pisCofinsDoItemC170(item, direcao, regimeApuracao, aliq, vlItem);

            linhas.push(fmt.buildLine([
                'C170',
                item.nItem || '1',                                    //  2 NUM_ITEM
                fmt.sanitizeString(codItemDoItem(item), 60),            //  3 COD_ITEM
                fmt.sanitizeString(item.xProd || item.descricao || '', 255), // 4 DESCR_COMPL
                fmt.formatValue(item.qCom || item.quantidade || 1, 5), //  5 QTD
                unidadeDoItem(item),                                    //  6 UNID
                fmt.formatValue(vlItem),                              //  7 VL_ITEM
                fmt.formatValue(descontoItem),                        //  8 VL_DESC
                IND_MOV_COM_MOVIMENTACAO,                             //  9 IND_MOV
                cstIcms,                                              // 10 CST_ICMS
                fmt.sanitizeString(cfopLancado, 4),                   // 11 CFOP
                '',                                                   // 12 COD_NAT
                fmt.formatValue(item.vBC || 0),                       // 13 VL_BC_ICMS
                fmt.formatValue(aliqIcmsItem, 2),                     // 14 ALIQ_ICMS
                fmt.formatValue(item.vICMS || 0),                     // 15 VL_ICMS
                fmt.formatValue(item.vBCST || 0),                     // 16 VL_BC_ICMS_ST
                fmt.formatValue(item.aliqST || 0, 2),                 // 17 ALIQ_ST
                fmt.formatValue(item.vICMSST || 0),                   // 18 VL_ICMS_ST
                IND_APUR_MENSAL,                                      // 19 IND_APUR
                '',                                                   // 20 CST_IPI
                '',                                                   // 21 COD_ENQ
                fmt.formatValue(item.vBCIPI || item.vBcIpi || 0),     // 22 VL_BC_IPI
                fmt.formatValue(item.aliqIPI || 0, 2),                // 23 ALIQ_IPI
                fmt.formatValue(item.vIPI || 0),                      // 24 VL_IPI
                p.cstPis,                                             // 25 CST_PIS
                fmt.formatValue(p.basePis),                           // 26 VL_BC_PIS
                fmt.formatValue(p.aliqPis, 4),                        // 27 ALIQ_PIS
                '',                                                   // 28 QUANT_BC_PIS
                '',                                                   // 29 ALIQ_PIS_QUANT
                fmt.formatValue(p.vlPis),                             // 30 VL_PIS
                p.cstCofins,                                          // 31 CST_COFINS
                fmt.formatValue(p.baseCofins),                        // 32 VL_BC_COFINS
                fmt.formatValue(p.aliqCofins, 4),                     // 33 ALIQ_COFINS
                '',                                                   // 34 QUANT_BC_COFINS
                '',                                                   // 35 ALIQ_COFINS_QUANT
                fmt.formatValue(p.vlCofins),                          // 36 VL_COFINS
                '',                                                   // 37 COD_CTA
            ]));
        });
    }

    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['C990', totalBloco]));
    return linhas;
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO D — Transporte (CTe modelo 57)
// ═══════════════════════════════════════════════════════════════════════

export function buildBlocoD_Contrib(dados) {
    const linhas = [];
    // Modelo pela RÉGUA (o campo cru não existe em documento capturado).
    const notasD = selecionarCtesBlocoD(dados.notas);

    if (notasD.length === 0) {
        linhas.push(fmt.buildLine(['D001', '1']));
        linhas.push(fmt.buildLine(['D990', '2']));
        return linhas;
    }

    const regimeApuracao = dados.regimeApuracao || '2';
    const aliq = getAliquotas(regimeApuracao);

    linhas.push(fmt.buildLine(['D001', '0']));
    linhas.push(fmt.buildLine(['D010', fmt.sanitizeCnpjCpf(dados.empresa.cnpj)]));

    /** CT-e sem valor legível: sai NOMEADO, como no bloco A. */
    const valorZeroD = [];
    for (const notaCrua of notasD) {
        if (docCancelado(notaCrua)) continue;
        // As MESMAS três réguas do bloco A — este bloco tinha as três leituras
        // cruas (21/08, varredura dos leitores de documento):
        //   · `nota.valor || nota.totalNota` — o importer grava **valorTotal**
        //     (o CT-e traz <vTPrest>), então TODO CT-e capturado saía com
        //     VL_DOC 0,00 e PIS/COFINS zerados. É o defeito que zerou o M200 da
        //     MANTOAN em 17/08, corrigido no bloco A e vivo aqui;
        //   · `nota.direcao` cru — a régua é `direcaoEfetivaDoc`;
        //   · participante só na forma ANINHADA — a captura grava achatado.
        const nota = normalizarParticipantesDoc(notaCrua);
        const direcao = direcaoEfetivaDoc(nota);
        const indOper = direcao === 'saida' ? '1' : '0';
        const indEmit = direcao === 'saida' ? '0' : '1';

        const participanteRaw = direcao === 'saida'
            ? (nota.destinatario || nota.tomador)
            : (nota.emitente || nota.prestador);
        const codPart = participanteRaw
            ? String(participanteRaw.cnpjCpf || participanteRaw.cnpj || '').replace(/\D/g, '')
            : '';

        const vlDoc = valorDoDocumentoServico(nota);
        // Zero num campo de valor é AFIRMAÇÃO, e o PVA recusa D100 zerado.
        // Documento sem valor em forma nenhuma sai da base, nomeado.
        if (!Number.isFinite(vlDoc) || vlDoc <= 0) {
            valorZeroD.push(String(nota.numero || nota.chave || '(sem número)'));
            continue;
        }
        const vlPis = vlDoc * aliq.pis;
        const vlCofins = vlDoc * aliq.cofins;

        linhas.push(fmt.buildLine([
            'D100',
            indOper, indEmit, codPart,
            '57', '00',
            // SER pela régua — o '1' cravado inventava a série de todo CT-e
            // que chegasse sem o campo; a chave carrega a série (23-25).
            serieDoDocumento(nota),
            '',
            fmt.sanitizeString(nota.numero || '', 9),
            fmt.sanitizeString(nota.chaveAcesso || nota.chave || '', 44),
            fmt.formatDate(nota.dataEmissao || nota.dhEmi),
            fmt.formatDate(nota.dataEmissao || nota.dhEmi),
            fmt.formatValue(vlDoc),
            '', '', '',
            fmt.formatValue(vlDoc), fmt.formatValue(vlPis),
            fmt.formatValue(vlDoc), fmt.formatValue(vlCofins),
        ]));
    }

    if (valorZeroD.length && Array.isArray(dados.warnings)) {
        dados.warnings.push(
            `Bloco D: ${valorZeroD.length} CT-e ficaram FORA porque o valor não foi encontrado em forma `
            + `nenhuma — nº ${valorZeroD.slice(0, 10).join(', ')}`
            + `${valorZeroD.length > 10 ? ` e mais ${valorZeroD.length - 10}` : ''}. `
            + 'O PVA recusa D100 com VL_DOC zerado, e declarar zero seria afirmar que o frete não teve valor. '
            + 'Reimporte o XML do CT-e (o valor mora em <vTPrest>) ou rode o ♻️ antes de transmitir.',
        );
    }

    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['D990', totalBloco]));
    return linhas;
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO F — Demais Documentos e Operacoes
// ═══════════════════════════════════════════════════════════════════════
//
// F600 — Contribuição Retida na Fonte. Era um STUB permanente (F001|1) e o
// Paulo pegou pelo caso HS PROJETOS (19/08): *"ela é retido de PIS/COFINS,
// então quando eu informo no EFD CONTRIBUIÇÕES ele me dá o F600 para
// preencher, na SAGE ele já puxava essas informações"*.
//
// 🚨 LEIAUTE PROVADO CONTRA ARQUIVO ACEITO — o EFD do E-Fiscal da própria HS
// (0304, 05/2026, assinado) que ele mandou no mesmo dia:
//
//   |F600|03|02052026|5200|189,8|5952|1|47252373000113|33,8|156|0|
//    REG  ↑    ↑       ↑     ↑    ↑  ↑        ↑          ↑   ↑  ↑
//         │  DT_RET VL_BC_RET│ COD_REC│     CNPJ      VL_RET VL_RET IND_DEC
//   IND_NAT_RET          VL_RET  IND_NAT_REC (fonte     _PIS _COFINS
//   (03 = PJ dir.privado) (PIS+COFINS)  1=cumulativa)  pagadora)
//
// E os totais fecham: os 5 F600 daquele arquivo somam PIS 114,40 e COFINS
// 528,00 — exatamente o VL_RET_CUM do M200 e do M600 do MESMO arquivo.
// ⚠️ VL_RET é SÓ PIS+COFINS (3,65% da base): a CSLL retida existe no DARF
// 5952 mas NÃO entra nesta escrituração — somá-la declararia retenção a
// maior. IR/INSS idem: outros tributos, outras declarações.

/**
 * Coleta os eventos de retenção na fonte (F600) das notas do período.
 *
 * Só serviço PRESTADO (direcao 'saida'): a retenção que abate a contribuição
 * da declarante é a que ELA sofreu. Cada nota com PIS/COFINS retidos vira UM
 * evento — o desenho do arquivo aceito (5 notas → 5 F600).
 *
 * ⚠️ A régua do R-4020 vale aqui na direção mais cara: nota cujos campos de
 * PIS/COFINS são o TRIBUTO DA OPERAÇÃO do prestador (assinatura 1,65%+7,60%,
 * não-cumulativo) NÃO entra — declararia como retenção um imposto que ninguém
 * reteve, inflando o abatimento do M200/M600. Quem decide é a régua que já
 * existe (`conferirRetencaoFederal`), nunca uma cópia.
 *
 * @param {Array}      notas     documentos da competência
 * @param {Array|null} warnings  onde nomear o que ficou de fora (null = mudo,
 *                               para releitura idempotente pelo bloco M)
 */
export function coletarRetencoesF600(notas, warnings) {
    const eventos = [];
    const daOperacao = [];
    const semBase = [];
    const semCnpjFonte = [];
    const foraDaAliquota = [];

    for (const notaCrua of (notas || [])) {
        if (docCancelado(notaCrua) || notaCrua.status === 'denegado') continue;
        // A retenção SOFRIDA é do que a empresa PRESTOU — e a nota própria de
        // entrada (art. 136) fica gravada como 'saida' até o backfill passar.
        // Lida crua, uma COMPRA entrava nesta coleta e saía nomeada num aviso
        // de "ficou de fora" que não faz sentido nenhum para quem lê.
        if (direcaoEfetivaDoc(notaCrua) !== 'saida') continue;
        // 🚨 AS DUAS FORMAS, PELA DÉCIMA VEZ — caso HS PROJETOS 07/2026 (19/08):
        // esta coleta lia só `valores.pis/cofins` (forma ANINHADA) e a NFS-e do
        // portal grava `valorPis`/`valorCofins` ACHATADOS na raiz. Resultado:
        // toda nota retida era pulada como "sem retenção gravada", o F600 saía
        // `F001|1` e o M200/M600 declarava a recolher SEM o abatimento — a
        // conta MAIOR que a devida, num arquivo aceito. Quem lê as duas formas
        // é o DONO da régua (o mesmo leitor do R-4020), nunca uma cópia.
        const v = notaCrua.valores || {};
        const fed = lerRetencoesFederaisDoDoc(notaCrua);
        const pis = fed.pis ?? 0;
        const cofins = fed.cofins ?? 0;
        if (pis + cofins <= 0) continue;   // sem retenção federal gravada — caso normal

        const rotulo = String(notaCrua.numero || notaCrua.chave || '(sem número)');
        const base = parseFloat(v.baseCalculo) || parseFloat(notaCrua.valorServicos) || parseFloat(notaCrua.valorTotal) || 0;
        const diag = conferirRetencaoFederal({ base, pis, cofins, csll: fed.csllOuTotal, ir: fed.ir, inss: fed.inss });
        if (diag.situacao === 'campos-sao-totais-da-operacao') { daOperacao.push(rotulo); continue; }
        if (!base) { semBase.push(rotulo); continue; }
        if (diag.situacao === 'aliquota-fora') foraDaAliquota.push(rotulo);

        // A fonte pagadora é o TOMADOR — mesma leitura das duas formas do
        // documento que o 0150 usa (portal grava achatado, XML aninhado).
        const nota = normalizarParticipantesDoc(notaCrua);
        const cnpjFonte = String(nota.destinatario?.cnpjCpf || nota.destinatario?.cnpj || '').replace(/\D/g, '');
        if (cnpjFonte.length !== 14) { semCnpjFonte.push(rotulo); continue; }

        eventos.push({
            data: notaCrua.dataEmissao || notaCrua.dhEmi || null,
            base, pis, cofins, cnpjFonte, numero: rotulo,
        });
    }

    if (Array.isArray(warnings)) {
        if (daOperacao.length) {
            warnings.push(
                `F600: ${daOperacao.length} nota(s) ficaram FORA porque os campos de PIS/COFINS são o tributo `
                + `da OPERAÇÃO do prestador (assinatura 1,65%+7,60%), não retenção — nº ${daOperacao.slice(0, 8).join(', ')}. `
                + 'Se houve retenção real (CSRF), ela não está rateada no documento: confira antes de declarar.',
            );
        }
        if (semBase.length) {
            warnings.push(
                `F600: ${semBase.length} nota(s) com retenção gravada e SEM base de cálculo legível — `
                + `nº ${semBase.slice(0, 8).join(', ')}. Ficaram fora (campo de valor não recebe default); `
                + 'o abatimento do M200/M600 está a MENOR até corrigir.',
            );
        }
        if (semCnpjFonte.length) {
            warnings.push(
                `F600: ${semCnpjFonte.length} nota(s) sem CNPJ da fonte pagadora (tomador) legível — `
                + `nº ${semCnpjFonte.slice(0, 8).join(', ')}. Ficaram fora; o abatimento está a MENOR.`,
            );
        }
        if (foraDaAliquota.length) {
            warnings.push(
                `F600: ${foraDaAliquota.length} nota(s) com retenção fora da alíquota legal (0,65%+3%) — `
                + `nº ${foraDaAliquota.slice(0, 8).join(', ')}. Entraram com o valor do documento; confira `
                + '(pode ser base com dedução ou digitação).',
            );
        }
    }

    const totalPis = eventos.reduce((t, e) => t + e.pis, 0);
    const totalCofins = eventos.reduce((t, e) => t + e.cofins, 0);
    return { eventos, totalPis, totalCofins };
}

/**
 * O COD_CTA que o F100 pode referenciar — VAZIO enquanto o 0500 não sair.
 * A régua de "o que falta" mora no dono; aqui só se pergunta se ela fechou.
 */
function contaDeclaradaNo0500(dados) {
    const r = montar0500ContaReceita({
        codConta: dados.contaContabilReceitaFinanceira,
        nomeConta: dados.contaContabilReceitaFinanceiraNome,
        nivel: dados.contaContabilReceitaFinanceiraNivel,
        ano: String(dados.competencia || '').slice(0, 4),
    });
    return r?.campos ? r.campos.codCta : '';
}

export function buildBlocoF(dados) {
    const ret = dados.retencoesF600 || coletarRetencoesF600(dados.notas, dados.warnings);
    const eventos = ret.eventos || [];
    const aliq = getAliquotas(dados.regimeApuracao || '2');
    // 🚨 A RECEITA SEM DOCUMENTO (aluguel) — sem ela o M200/M600 sai ZERADO
    // numa empresa que fatura todo mês (AFFITTARE 1139, 20/08). A régua e a
    // fonte moram em `receita-sem-documento-f550.js`.
    // 🚨 F550 × F100: os DOIS declaram o aluguel, e a escolha é de PERFIL do
    // arquivo, não de valor.
    //   · CONSOLIDADO (IND_REG_CUM 2) — arquivo sem documento nenhum: F550.
    //   · DETALHADO   (IND_REG_CUM 9) — há documento de receita: F100, que
    //     convive com o bloco A.
    // A premissa "receita de aluguel ⇒ arquivo consolidado" era da AFFITTARE e
    // quebrou na PEC PRONTA ENTREGA (07/2026), que tem serviços prestados E
    // aluguel: o arquivo saiu consolidado declarando A010/A100 e o PVA recusou
    // os SEIS registros. O EFD assinado da própria PEC (05/2026) mostra a saída
    // certa: `|0110|2||1|9|`, os cinco A100 de pé e o aluguel no F100.
    const consolidado = dados.escrituracaoConsolidada !== false;
    const receitaSemDoc = dados.receitaSemDocumento || 0;
    const f550 = consolidado
        ? montarF550({ receita: receitaSemDoc, aliqPis: aliq.pis, aliqCofins: aliq.cofins })
        : null;
    const f100 = consolidado
        ? null
        : montarF100({ receita: receitaSemDoc, aliqPis: aliq.pis, aliqCofins: aliq.cofins });
    // 🚨 RECEITA DE APLICAÇÃO FINANCEIRA — a empresa cuja receita inteira é
    // rendimento financeiro (CF BANK) saía com F001|1 e M200/M600 ZERADOS.
    // Ela tem CST e alíquotas PRÓPRIOS (02 · 0,65% e 4%), então não se mistura
    // com o F100 do aluguel, que usa a alíquota do regime.
    const fin = montarReceitaFinanceira({ receita: dados.receitaAplicacaoFinanceira });
    const linhas = [];
    // IND_MOV sai do que foi PRODUZIDO, nunca de constante (regra do 1001).
    linhas.push(fmt.buildLine(['F001', (eventos.length || f550 || f100 || fin) ? '0' : '1']));

    if (fin) {
        linhas.push(fmt.buildLine(['F010', String(dados.empresa?.cnpj || '').replace(/\D/g, '')]));
        // Leiaute do EFD ASSINADO do CF BANK (06/2026):
        // |F100|1|||30062026|21647,53|02|21647,53|0,65|140,71|02|21647,53|4|865,9|||<conta>|||
        linhas.push(fmt.buildLine([
            'F100',
            '1',                                        // IND_OPER (receita)
            '', '',                                     // COD_PART · COD_ITEM
            fmt.formatCompetenciaFim(dados.competenciaFim || dados.competencia), // DT_OPER
            fmt.formatValue(fin.receita),               // VL_OPER
            fin.cst,                                    // CST_PIS (02 — diferenciada)
            fmt.formatValue(fin.receita),               // VL_BC_PIS
            fmt.formatValue(fin.aliqPis * 100, 2),      // ALIQ_PIS
            fmt.formatValue(fin.pis),                   // VL_PIS
            fin.cst,                                    // CST_COFINS
            fmt.formatValue(fin.receita),               // VL_BC_COFINS
            fmt.formatValue(fin.aliqCofins * 100, 2),   // ALIQ_COFINS
            fmt.formatValue(fin.cofins),                // VL_COFINS
            '', '',                                     // NAT_BC_CRED · IND_ORIG_CRED
            // ⚠️ COD_CTA só sai quando o 0500 SAIU — referenciar conta que o
            // arquivo não declara é a recusa do CF BANK ("Informar código no
            // Registro 0500 antes de utilizá-lo"). Tudo ou nada: sem o plano de
            // contas completo, o F100 vai sem a conta, que é caso ACEITO (PEC).
            contaDeclaradaNo0500(dados),
            '', '',                                     // COD_CCUS · DESC_DOC_OPER
        ]));
    }

    if (f100) {
        linhas.push(fmt.buildLine(['F010', String(dados.empresa?.cnpj || '').replace(/\D/g, '')]));
        // Leiaute campo a campo do EFD ASSINADO da PEC 05/2026:
        // |F100|1|||01052026|188836,42|01|188836,42|0,65|1227,44|01|188836,42|3|5665,09||||||
        linhas.push(fmt.buildLine([
            'F100',
            f100.indOper,                          // IND_OPER (do arquivo assinado)
            '',                                    // COD_PART — aluguel não tem
            '',                                    // COD_ITEM — idem
            fmt.formatCompetenciaInicio(dados.competenciaInicio || dados.competencia), // DT_OPER — 1º dia, como o assinado
            fmt.formatValue(f100.receita),         // VL_OPER
            CST_F550_TRIBUTADA,                    // CST_PIS
            fmt.formatValue(f100.receita),         // VL_BC_PIS
            fmt.formatValue(aliq.pis * 100, 2),    // ALIQ_PIS
            fmt.formatValue(f100.pis),             // VL_PIS
            CST_F550_TRIBUTADA,                    // CST_COFINS
            fmt.formatValue(f100.receita),         // VL_BC_COFINS
            fmt.formatValue(aliq.cofins * 100, 2), // ALIQ_COFINS
            fmt.formatValue(f100.cofins),          // VL_COFINS
            '', '', '', '', '',                    // NAT_BC_CRED..DESC_DOC_OPER
        ]));
    }

    if (f550) {
        linhas.push(fmt.buildLine(['F010', String(dados.empresa?.cnpj || '').replace(/\D/g, '')]));
        linhas.push(fmt.buildLine([
            'F550',
            fmt.formatValue(f550.receita),      // VL_REC_COMP
            CST_F550_TRIBUTADA,                 // CST_PIS
            fmt.formatValue(0),                 // VL_DESC_PIS
            fmt.formatValue(f550.receita),      // VL_BC_PIS
            fmt.formatValue(aliq.pis * 100, 2), // ALIQ_PIS
            fmt.formatValue(f550.pis),          // VL_PIS
            CST_F550_TRIBUTADA,                 // CST_COFINS
            fmt.formatValue(0),                 // VL_DESC_COFINS
            fmt.formatValue(f550.receita),      // VL_BC_COFINS
            fmt.formatValue(aliq.cofins * 100, 2), // ALIQ_COFINS
            fmt.formatValue(f550.cofins),       // VL_COFINS
            '',  // COD_MOD    — vazios no arquivo aceito
            '',  // CFOP
            '',  // COD_CTA
            '',  // INFO_COMPL
        ]));
    }

    if (eventos.length) {
        // F010 — estabelecimento. O arquivo aceito traz só o CNPJ. Se o F550 já
        // abriu o estabelecimento, não abre de novo: dois F010 para o mesmo
        // CNPJ é o tipo de duplicidade que o PVA recusa.
        if (!f550 && !f100 && !fin) {
            linhas.push(fmt.buildLine(['F010', String(dados.empresa?.cnpj || '').replace(/\D/g, '')]));
        }
        // IND_NAT_REC acompanha o regime da apuração: cumulativa (Presumido)=1,
        // não-cumulativa=0 — o arquivo aceito da HS (Presumido) traz 1.
        const indNatRec = String(dados.regimeApuracao || '2') === '2' ? '1' : '0';
        for (const e of eventos) {
            linhas.push(fmt.buildLine([
                'F600',
                // IND_NAT_RET 03 = retenção por PJ de direito privado — o caso
                // destas notas (tomador PJ retendo CSRF) e o do arquivo aceito.
                // Retenção por órgão público (01/02) não está distinguida no
                // documento; se um dia aparecer, é cadastro, não dedução.
                '03',
                fmt.formatDate(e.data),
                fmt.formatValue(e.base),
                fmt.formatValue(e.pis + e.cofins),   // VL_RET = SÓ PIS+COFINS
                '5952',                              // COD_REC da CSRF (DARF) — fonte: arquivo aceito
                indNatRec,
                e.cnpjFonte,
                fmt.formatValue(e.pis),
                fmt.formatValue(e.cofins),
                '0',                                 // IND_DEC — fonte: arquivo aceito
            ]));
        }
    }

    linhas.push(fmt.buildLine(['F990', linhas.length + 1]));
    return linhas;
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO M — Apuracao PIS/COFINS
// ═══════════════════════════════════════════════════════════════════════

export function buildBlocoM(dados) {
    const linhas = [];
    const regimeApuracao = dados.regimeApuracao || '2';
    const aliq = getAliquotas(regimeApuracao);

    linhas.push(fmt.buildLine(['M001', '0']));

    // 🚨 RECEITA E BASE SÃO CAMPOS DIFERENTES DO M210, e o gerador punha o
    // MESMO número nos dois. O arquivo ACEITO da PWR (03/2026) traz
    // `VL_REC_BRT 19.580` e `VL_BC_CONT 16.055,60` — a diferença é o ICMS.
    // Juntar os dois apaga a exclusão do Tema 69 de dentro do registro que
    // deveria mostrá-la.
    let totalPisSaida = 0, totalCofinsSaida = 0, totalBcSaida = 0, totalReceitaSaida = 0;
    let totalPisEntrada = 0, totalCofinsEntrada = 0, totalBcEntrada = 0;
    /** Quanto de ICMS saiu da base — vai no aviso, para o número ser conferível. */
    let icmsExcluido = 0;
    /** Desconto incondicional tirado da receita — vai no aviso, com a contagem. */
    let descontoExcluido = 0;
    let docsComDesconto = 0;
    /** Documento sem valor legível em nenhuma das formas — sai do total e é DITO. */
    const semValor = [];

    for (const nota of (dados.notas || [])) {
        if (docCancelado(nota) || nota.status === 'denegado') continue;

        // 🚨 A ARMADILHA DAS DUAS FORMAS, TERCEIRA VEZ NO MESMO ARQUIVO.
        //
        // A NFS-e do portal de SP não tem `itens` e grava o valor em
        // `valorTotal` — nome que este trecho não lia. Resultado: `vlDoc` = 0
        // para TODA nota de serviço e **M200/M600 saindo 0,00** num arquivo com
        // 37 documentos e PIS/COFINS destacados no A100 (MANTOAN 07/2026).
        // Ou seja, o arquivo declarava à Receita que não havia contribuição a
        // pagar. A régua já existe num lugar só.
        // A régua da base mora num lugar só (`base-pis-cofins.js`): receita é
        // mercadoria MENOS desconto incondicional, e a base é a receita MENOS o
        // ICMS destacado (Tema 69). Documento sem itens (a NFS-e do portal) não
        // tem ICMS destacado — ali receita e base coincidem, e é o próprio
        // módulo que diz isso, em vez de este laço adivinhar.
        const semItens = !(nota.itens || []).length;
        const doDocumento = semItens ? valorDoDocumentoServico(nota) : 0;
        if (semItens && !Number.isFinite(doDocumento)) {
            // Ausência NÃO vira zero — foi o zero silencioso que produziu o
            // M200 zerado. A nota sai NOMEADA e fora da conta.
            semValor.push(String(nota.numero || nota.chave || '(sem número)'));
            continue;
        }
        const rb = receitaEBaseDoDocumento(nota, doDocumento);
        if (rb.receita === 0 && rb.base === 0) {
            semValor.push(String(nota.numero || nota.chave || '(sem número)'));
            continue;
        }

        // 🚨 A DIREÇÃO PELA RÉGUA (22/08): lida crua, a compra de produtor rural
        // (art. 136, gravada como 'saida') entrava como RECEITA — o arquivo
        // declarava PIS/COFINS a pagar sobre uma COMPRA.
        if (direcaoEfetivaDoc(nota) === 'saida') {
            totalBcSaida += rb.base;
            // 🚨 A RECEITA DO M210 É A LÍQUIDA — a mesma da FICHA FINANCEIRA.
            //
            // Paulo, 25/08 (PWR 1364 · 07/2026): *"o valor da receita não pode
            // ser esses 38.316,84 e sim 37.754,60 conforme a ficha financeira.
            // Tem que ajustar no C100."*
            //
            // ⚠️ E ESCREVER AQUI NÃO BASTAVA — foi o que custou a semana. O PVA
            // RECALCULA o M210 a partir dos documentos (medido: a tela dele
            // trazia Σ VL_ITEM dos C170 e Σ VL_BC_PIS, não os campos que a
            // gente escrevia). Por isso a correção mora no C100/C170: o
            // `VL_MERC` e o `VL_ITEM` saem líquidos do desconto incondicional,
            // com o `VL_DESC` informado ao lado. Aí os dois lados dizem
            // 37.754,60 — o arquivo e a tela do PVA.
            totalReceitaSaida += rb.receita;
            icmsExcluido += rb.icms;
            if (rb.desconto > 0) { descontoExcluido += rb.desconto; docsComDesconto += 1; }
            // ⚠️ O VALOR APURADO SEGUE A BASE, não o destacado no documento. O
            // `vPIS` do XML foi calculado pelo emitente sobre a mercadoria
            // cheia; somá-lo aqui declararia contribuição sobre uma base que o
            // próprio registro diz ser menor. No aceito de 03/2026 o M210 traz
            // 104,36 = 0,65% de 16.055,60 — e não os 127,27 do C100.
            totalPisSaida += rb.base * aliq.pis;
            totalCofinsSaida += rb.base * aliq.cofins;
        } else {
            // ⚠️ NA ENTRADA A EXCLUSÃO DO ICMS **NÃO** SE APLICA POR ANALOGIA.
            // O Tema 69 trata da RECEITA de quem vende; a base do CRÉDITO de
            // quem compra é o valor da aquisição, e o ICMS ali é custo. Ninguém
            // decidiu o contrário neste app, e decidir por simetria seria
            // inventar crédito. O que muda aqui é só o DESCONTO, que reduz o
            // valor da aquisição em qualquer leitura.
            const vlEntrada = rb.receita;
            totalBcEntrada += vlEntrada;
            let pis = 0, cofins = 0;
            for (const item of (nota.itens || [])) {
                pis += parseFloat(item.vPIS || 0);
                cofins += parseFloat(item.vCOFINS || 0);
            }
            if (pis === 0) pis = vlEntrada * aliq.pis;
            if (cofins === 0) cofins = vlEntrada * aliq.cofins;
            totalPisEntrada += pis;
            totalCofinsEntrada += cofins;
        }
    }

    // Documento que não teve valor lido não some calado: ele estaria FORA do
    // M200/M600, e um total a menor num arquivo entregue à Receita não tem como
    // ser percebido depois.
    // A EXCLUSÃO DO ICMS VAI DITA, com o número. Ela muda a contribuição
    // declarada, e mudança de valor sem causa escrita é o que faz alguém
    // desconfiar do número certo — a mesma régua do FUNRURAL que "some da
    // conta, não da tela".
    // 🚨 A RECEITA SEM DOCUMENTO ENTRA NA APURAÇÃO (AFFITTARE, 20/08).
    // Sem isto o F550 sairia declarando receita e o M200/M600 continuaria
    // ZERADO — o arquivo se desmentindo dentro de si mesmo, que é exatamente o
    // defeito que o M210 com COD_CONT do outro regime tinha.
    // ⚠️ Não há ICMS a excluir aqui: aluguel não tem ICMS destacado, então
    // receita e base coincidem — e é o valor da FICHA, não um derivado.
    const receitaSemDoc = Math.max(0, parseFloat(dados.receitaSemDocumento || 0) || 0);
    if (receitaSemDoc > 0) {
        totalReceitaSaida += receitaSemDoc;
        totalBcSaida += receitaSemDoc;
        totalPisSaida += receitaSemDoc * aliq.pis;
        totalCofinsSaida += receitaSemDoc * aliq.cofins;
    }

    // 🚨 O DESCONTO VAI DITO — com o número e a CONTAGEM de documentos.
    // O `VL_REC_BRT` é a receita LÍQUIDA do desconto incondicional, e quando
    // ele não aparece o arquivo declara receita a MAIOR (PWR 07/2026: 38.316,84
    // no lugar de 37.754,60). Sem esta linha, "a receita está errada" só se
    // responde lendo o código — e há empresa com desconto em quase toda nota.
    if (descontoExcluido > 0 && Array.isArray(dados.warnings)) {
        dados.warnings.push(
            `Receita do M210/M610: o DESCONTO incondicional está FORA — bruta `
            + `${(totalReceitaSaida + descontoExcluido).toFixed(2)} − desconto ${descontoExcluido.toFixed(2)} `
            + `= ${totalReceitaSaida.toFixed(2)} (${docsComDesconto} documento(s) com desconto). `
            + 'Ele sai já no C100/C170 — VL_MERC e VL_ITEM líquidos, com o VL_DESC informado ao lado —, '
            + 'porque o PVA recalcula o M210 a partir dos documentos: corrigir só o M210 não chegava na '
            + 'tela dele. Confira o "Valor total das mercadorias e serviços" do C100 no PVA.',
        );
    }

    if (icmsExcluido > 0 && Array.isArray(dados.warnings)) {
        dados.warnings.push(
            // ⚠️ A CONTA TEM DE FECHAR NA PRÓPRIA FRASE: `totalReceitaSaida` já
            // é a receita LÍQUIDA do desconto (o abatimento acontece lá no
            // C100/C170), então aqui só o ICMS é subtraído. Somar o desconto de
            // novo faria o aviso se desmentir — e aviso que não fecha é pior
            // que aviso nenhum.
            `Base do PIS/COFINS (Tema 69 · RE 574.706): o ICMS destacado nas saídas foi EXCLUÍDO da base — `
            + `receita ${totalReceitaSaida.toFixed(2)} − ICMS ${icmsExcluido.toFixed(2)} = base `
            + `${totalBcSaida.toFixed(2)}. É a mesma exclusão que a ficha do Lucro já fazia; antes desta `
            + 'competência o SPED declarava a base CHEIA, maior que a da guia.',
        );
    }

    if (semValor.length && Array.isArray(dados.warnings)) {
        dados.warnings.push(
            `Apuração PIS/COFINS (bloco M): ${semValor.length} documento(s) ficaram FORA da base porque o valor `
            + `não foi lido em nenhuma das formas — nº ${semValor.slice(0, 10).join(', ')}`
            + `${semValor.length > 10 ? ` e mais ${semValor.length - 10}` : ''}. `
            + 'O M200/M600 está a MENOR: confira esses documentos antes de transmitir.',
        );
    }

    const isNaoCumulativo = regimeApuracao === '1' || regimeApuracao === '3';
    // 🚨 COD_CONT DO M210/M610 — 01 é NÃO-CUMULATIVO, 51 é CUMULATIVO
    // (Tabela 4.3.5). O gerador cravava '01' para todo mundo, então o arquivo da
    // PWR (cumulativa, 0110 COD_INC_TRIB=2, M200 preenchido nos campos do
    // cumulativo) declarava a apuração com o CÓDIGO do regime errado — e se
    // desmentia dentro de si mesmo. O EFD-Contribuições ACEITO da mesma empresa
    // (03/2026) traz |M210|51|... e |M610|51|..., com as alíquotas de 0,65% e 3%.
    const codCont = isNaoCumulativo ? COD_CONT_NAO_CUMULATIVO : COD_CONT_CUMULATIVO;

    // Retenções na fonte (F600) abatem a contribuição — a MESMA coleta do
    // bloco F (warnings mudos aqui: o F já nomeou o que ficou de fora; nomear
    // duas vezes é ruído). Os totais têm que fechar com os F600 emitidos: no
    // arquivo aceito da HS (05/2026), Σ VL_RET_PIS = 114,40 = VL_RET_CUM do
    // M200 e Σ VL_RET_COFINS = 528,00 = VL_RET_CUM do M600, centavo a centavo.
    const ret = dados.retencoesF600 || coletarRetencoesF600(dados.notas, null);
    const retPis = ret.totalPis || 0;
    const retCofins = ret.totalCofins || 0;

    // M100 — Credito PIS (nao-cumulativo)
    if (isNaoCumulativo && totalPisEntrada > 0) {
        linhas.push(fmt.buildLine([
            'M100', '01', '0',
            fmt.formatValue(totalBcEntrada),
            fmt.formatValue(aliq.pis * 100, 4),
            '', '',
            fmt.formatValue(totalPisEntrada),
            fmt.formatValue(totalPisEntrada),
            fmt.formatValue(0),
            fmt.formatValue(totalPisEntrada),
            fmt.formatValue(0),
            '',
            fmt.formatValue(totalPisEntrada),
            '',
        ]));
    }

    // M200 — Contribuicao PIS do periodo
    //
    // 🚨 LEIAUTE PROVADO CONTRA ARQUIVO ACEITO (E-Fiscal da HS PROJETOS,
    // 05/2026, regime cumulativo):
    //   |M200|0|0|0|0|0|0|0|114,4|114,4|0|0|0|
    // Os 12 campos após REG são: VL_TOT_CONT_NC_PER · VL_TOT_CRED_DESC ·
    // VL_TOT_CRED_DESC_ANT · VL_TOT_CONT_NC_DEV · VL_RET_NC · VL_OUT_DED_NC ·
    // VL_CONT_NC_REC · VL_TOT_CONT_CUM_PER · VL_RET_CUM · VL_OUT_DED_CUM ·
    // VL_CONT_CUM_REC · VL_TOT_CONT_REC. Ou seja: a contribuição do regime
    // CUMULATIVO mora nos campos 8-12, e os 1-7 (não-cumulativo) saem zerados.
    // A versão anterior punha a BASE no campo 1 e a contribuição espalhada
    // pelos campos do NC — o PVA ACEITAVA (não cruza esses campos), mas
    // "aceito não é certo": declarava a apuração na seção do regime errado, e
    // sem VL_RET_CUM a retenção do F600 não abateria nada — a recolher MAIOR
    // que o devido para toda empresa com retenção na fonte.
    // 🚨 A CONTRIBUIÇÃO DA RECEITA FINANCEIRA entra no total do M200/M600 —
    // sem ela a empresa cuja receita inteira é rendimento (CF BANK) declarava
    // ZERO. Ela tem alíquota e código PRÓPRIOS, então vai numa LINHA SEPARADA
    // do M210/M610 (COD_CONT 02), não somada à apuração comum: juntar
    // declararia parte da receita sob a alíquota errada.
    const finM = montarReceitaFinanceira({ receita: dados.receitaAplicacaoFinanceira });
    const vlContribPis = totalPisSaida + (finM ? finM.pis : 0);
    const vlCredDescontPis = isNaoCumulativo ? Math.min(totalPisEntrada, vlContribPis) : 0;
    // A retenção declarada é a REAL (soma dos F600); o "a recolher" é que não
    // desce de zero. Cap na retenção esconderia o saldo a compensar.
    const vlRecNcPis = isNaoCumulativo ? Math.max(vlContribPis - vlCredDescontPis - retPis, 0) : 0;
    const vlRecCumPis = isNaoCumulativo ? 0 : Math.max(vlContribPis - retPis, 0);

    linhas.push(fmt.buildLine([
        'M200',
        fmt.formatValue(isNaoCumulativo ? vlContribPis : 0),      // VL_TOT_CONT_NC_PER
        fmt.formatValue(vlCredDescontPis),                        // VL_TOT_CRED_DESC
        fmt.formatValue(0),                                       // VL_TOT_CRED_DESC_ANT
        // 🚨 SAÍA 0 CRAVADO — e o registro se desmentia: campo 4 dizendo que
        // NADA é devido no não-cumulativo com o campo 7 (a recolher) cheio.
        // É a contribuição do período MENOS os créditos descontados; sem
        // crédito, é ela mesma. O EFD assinado do CF BANK (06/2026) traz
        // |M200|140,71|0|0|**140,71**|0|0|140,71|…
        fmt.formatValue(isNaoCumulativo
            ? Math.max(0, vlContribPis - vlCredDescontPis) : 0),  // VL_TOT_CONT_NC_DEV
        fmt.formatValue(isNaoCumulativo ? retPis : 0),            // VL_RET_NC
        fmt.formatValue(0),                                       // VL_OUT_DED_NC
        fmt.formatValue(vlRecNcPis),                              // VL_CONT_NC_REC
        fmt.formatValue(isNaoCumulativo ? 0 : vlContribPis),      // VL_TOT_CONT_CUM_PER
        fmt.formatValue(isNaoCumulativo ? 0 : retPis),            // VL_RET_CUM
        fmt.formatValue(0),                                       // VL_OUT_DED_CUM
        fmt.formatValue(vlRecCumPis),                             // VL_CONT_CUM_REC
        fmt.formatValue(vlRecNcPis + vlRecCumPis),                // VL_TOT_CONT_REC
    ]));

    // M210 — Detalhamento PIS por CST
    //
    // 🚨 ESTE REGISTRO SAÍA COM 8 CAMPOS, E O LEIAUTE TEM 16 (Paulo, 18/08, com
    // o recibo do PVA da MANTOAN 07/2026: *"O número de campos informado no
    // registro difere do número de campos especificado no leiaute"* — esperado
    // 16, veio 8 — e mais *"VL_BC_CONT: Registro/Campo não informado ou
    // inválido · Conteúdo 0,6500"*).
    //
    // A segunda recusa DIZ a causa da primeira: faltando os campos do meio, a
    // ALÍQUOTA (0,65) caía na posição da BASE DE CÁLCULO. Ou seja o arquivo
    // declarava base de R$ 0,65 sobre a qual saía contribuição de R$ 285,28.
    //
    // ⚠️ Os VALORES já estavam certos (base 43.890,00, PIS 285,28, conferidos
    // contra as 33 prestações do próprio arquivo) — o defeito era de FORMA. E é
    // a MESMA classe do 1010 de 17/08: registro emitido com contagem de campos
    // que não é a do leiaute. Por isso este PR não corrige só a linha: ele passa
    // a CONFERIR a contagem antes de o arquivo sair (sped-contrib-campos.js).
    //
    // Ordem oficial (Guia Prático EFD-Contribuições), com a posição 4 nomeada
    // pelo próprio PVA: REG · COD_CONT · VL_REC_BRT · VL_BC_CONT ·
    // VL_AJUS_ACRES_BC_PIS · VL_AJUS_REDUC_BC_PIS · VL_BC_CONT_AJUS · ALIQ_PIS ·
    // QUANT_BC_PIS · ALIQ_PIS_QUANT · VL_CONT_APUR · VL_AJUS_ACRES ·
    // VL_AJUS_REDUC · VL_CONT_DIFER · VL_CONT_DIFER_ANT · VL_CONT_PER.
    //
    // Campo de ajuste/diferimento que esta empresa não tem sai VAZIO, nunca
    // 0,00 inventado: campo de valor não recebe default (regra de 06/08).
    // M205 — Detalhamento por código de receita (visão DCTF).
    //
    // Paulo, 20/08: *"esse registro nós preenchemos manual, tem a possibilidade
    // de já puxar preenchido?"*. Dá — mas SÓ com código provado: os dois pares
    // vêm do EFD-Contribuições aceito da própria PWR (03/2026), e o regime
    // não-cumulativo, cujo código eu não tenho de arquivo aceito, fica de fora
    // NOMEADO em vez de sair com um número deduzido. Código errado aqui declara
    // o débito na receita errada da DCTF.
    // 🚨 O CÓDIGO DE RECEITA DA APURAÇÃO DIFERENCIADA está PROVADO (assinado
    // do CF BANK 06/2026: |M205|08|457401| e |M605|08|798701|), então a receita
    // financeira NÃO cai no aviso do "não-cumulativo sem código provado".
    // ⚠️ Ele vale só para ESTA apuração — reaproveitá-lo no não-cumulativo
    // comum declararia o débito na receita errada da DCTF.
    if (finM) {
        linhas.push(fmt.buildLine([
            'M205', CODIGOS_RECEITA_APLICACAO_FINANCEIRA.numCampo,
            CODIGOS_RECEITA_APLICACAO_FINANCEIRA.pis, fmt.formatValue(finM.pis),
        ]));
    }

    const m205 = codigosReceitaM205(isNaoCumulativo);
    if (m205 && vlRecCumPis > 0) {
        linhas.push(fmt.buildLine(['M205', m205.numCampo, m205.pis, fmt.formatValue(vlRecCumPis)]));
    } else if (!m205 && vlRecNcPis > 0 && Array.isArray(dados.warnings)) {
        dados.warnings.push(
            'M205/M605 (detalhamento por código de receita, visão DCTF) NÃO foi gerado: o código de receita do '
            + 'regime NÃO-CUMULATIVO não está provado contra nenhum arquivo aceito, e este app não deduz código '
            + 'de tabela oficial. Preencha os dois registros no PVA, ou mande um EFD-Contribuições não-cumulativo '
            + 'já aceito para o código entrar no gerador.',
        );
    }

    if (totalPisSaida > 0) {
        linhas.push(fmt.buildLine([
            'M210', codCont,
            // 🚨 RECEITA BRUTA ≠ BASE. Aqui os dois campos recebiam o MESMO
            // número, o que apagava a exclusão do ICMS de dentro do registro
            // que deveria mostrá-la. No aceito de 03/2026: VL_REC_BRT 19.580 ×
            // VL_BC_CONT 16.055,60.
            fmt.formatValue(totalReceitaSaida),  // VL_REC_BRT
            fmt.formatValue(totalBcSaida),      // VL_BC_CONT  ← recebia a alíquota
            '', '',                             // ajustes de BC (acréscimo/redução)
            fmt.formatValue(totalBcSaida),      // VL_BC_CONT_AJUS (sem ajuste = a própria BC)
            fmt.formatValue(aliq.pis * 100, 4), // ALIQ_PIS
            '', '',                             // QUANT_BC_PIS · ALIQ_PIS_QUANT
            fmt.formatValue(totalPisSaida),     // VL_CONT_APUR
            '', '',                             // ajustes de contribuição
            '', '',                             // diferimento (período e anterior)
            fmt.formatValue(totalPisSaida),     // VL_CONT_PER
        ]));
    }

    // 🚨 A RECEITA FINANCEIRA É UMA LINHA SEPARADA — COD_CONT 02 (alíquota
    // DIFERENCIADA). Somá-la à apuração comum declararia parte da receita sob
    // a alíquota errada; o M210 é "detalhamento POR código de contribuição",
    // e é para isso que ele aceita mais de uma linha. Leiaute e códigos: EFD
    // ASSINADO do CF BANK 06/2026.
    if (finM) {
        linhas.push(fmt.buildLine([
            'M210', COD_CONT_APLICACAO_FINANCEIRA,
            fmt.formatValue(finM.receita),          // VL_REC_BRT
            fmt.formatValue(finM.receita),          // VL_BC_CONT — sem exclusão aqui
            '', '',
            fmt.formatValue(finM.receita),          // VL_BC_CONT_AJUS
            fmt.formatValue(finM.aliqPis * 100, 4), // ALIQ_PIS (0,65)
            '', '',
            fmt.formatValue(finM.pis),              // VL_CONT_APUR
            '', '', '', '',
            fmt.formatValue(finM.pis),              // VL_CONT_PER
        ]));
    }

    // M500 — Credito COFINS (nao-cumulativo)
    if (isNaoCumulativo && totalCofinsEntrada > 0) {
        linhas.push(fmt.buildLine([
            'M500', '01', '0',
            fmt.formatValue(totalBcEntrada),
            fmt.formatValue(aliq.cofins * 100, 4),
            '', '',
            fmt.formatValue(totalCofinsEntrada),
            fmt.formatValue(totalCofinsEntrada),
            fmt.formatValue(0),
            fmt.formatValue(totalCofinsEntrada),
            fmt.formatValue(0),
            '',
            fmt.formatValue(totalCofinsEntrada),
            '',
        ]));
    }

    // M600 — Contribuicao COFINS do periodo. Mesmo leiaute do M200 (provado no
    // mesmo arquivo aceito: |M600|0|0|0|0|0|0|0|528|528|0|0|0|).
    const vlContribCofins = totalCofinsSaida + (finM ? finM.cofins : 0);
    const vlCredDescontCofins = isNaoCumulativo ? Math.min(totalCofinsEntrada, vlContribCofins) : 0;
    const vlRecNcCofins = isNaoCumulativo ? Math.max(vlContribCofins - vlCredDescontCofins - retCofins, 0) : 0;
    const vlRecCumCofins = isNaoCumulativo ? 0 : Math.max(vlContribCofins - retCofins, 0);

    linhas.push(fmt.buildLine([
        'M600',
        fmt.formatValue(isNaoCumulativo ? vlContribCofins : 0),   // VL_TOT_CONT_NC_PER
        fmt.formatValue(vlCredDescontCofins),                     // VL_TOT_CRED_DESC
        fmt.formatValue(0),                                       // VL_TOT_CRED_DESC_ANT
        // Espelho do M200 — ver o comentário lá (campo 4 saía 0 cravado).
        fmt.formatValue(isNaoCumulativo
            ? Math.max(0, vlContribCofins - vlCredDescontCofins) : 0), // VL_TOT_CONT_NC_DEV
        fmt.formatValue(isNaoCumulativo ? retCofins : 0),         // VL_RET_NC
        fmt.formatValue(0),                                       // VL_OUT_DED_NC
        fmt.formatValue(vlRecNcCofins),                           // VL_CONT_NC_REC
        fmt.formatValue(isNaoCumulativo ? 0 : vlContribCofins),   // VL_TOT_CONT_CUM_PER
        fmt.formatValue(isNaoCumulativo ? 0 : retCofins),         // VL_RET_CUM
        fmt.formatValue(0),                                       // VL_OUT_DED_CUM
        fmt.formatValue(vlRecCumCofins),                          // VL_CONT_CUM_REC
        fmt.formatValue(vlRecNcCofins + vlRecCumCofins),          // VL_TOT_CONT_REC
    ]));

    // M605 — o par do M205, do lado da COFINS. Mesmo código provado, mesma
    // recusa em deduzir o do não-cumulativo (o aviso já saiu no M205; repetir
    // aqui seria ruído).
    if (m205 && vlRecCumCofins > 0) {
        linhas.push(fmt.buildLine(['M605', m205.numCampo, m205.cofins, fmt.formatValue(vlRecCumCofins)]));
    }
    // O par do M205 da apuração diferenciada (receita financeira).
    if (finM) {
        linhas.push(fmt.buildLine([
            'M605', CODIGOS_RECEITA_APLICACAO_FINANCEIRA.numCampo,
            CODIGOS_RECEITA_APLICACAO_FINANCEIRA.cofins, fmt.formatValue(finM.cofins),
        ]));
    }

    // M610 — Detalhamento COFINS por CST. Mesmo defeito, mesma correção: o PVA
    // recusou com "esperado 16, veio 8" e "VL_BC_CONT · Conteúdo 3,0000" — a
    // alíquota da COFINS ocupando a casa da base.
    if (totalCofinsSaida > 0) {
        linhas.push(fmt.buildLine([
            'M610', codCont,
            fmt.formatValue(totalReceitaSaida),    // VL_REC_BRT — receita ≠ base
            fmt.formatValue(totalBcSaida),         // VL_BC_CONT
            '', '',                                // ajustes de BC
            fmt.formatValue(totalBcSaida),         // VL_BC_CONT_AJUS
            fmt.formatValue(aliq.cofins * 100, 4), // ALIQ_COFINS
            '', '',                                // QUANT_BC · ALIQ_QUANT
            fmt.formatValue(totalCofinsSaida),     // VL_CONT_APUR
            '', '',                                // ajustes de contribuição
            '', '',                                // diferimento
            fmt.formatValue(totalCofinsSaida),     // VL_CONT_PER
        ]));
    }

    // A linha de COFINS da receita financeira — espelho do M210 acima, com a
    // alíquota de 4% do assinado.
    if (finM) {
        linhas.push(fmt.buildLine([
            'M610', COD_CONT_APLICACAO_FINANCEIRA,
            fmt.formatValue(finM.receita),
            fmt.formatValue(finM.receita),
            '', '',
            fmt.formatValue(finM.receita),
            fmt.formatValue(finM.aliqCofins * 100, 4),
            '', '',
            fmt.formatValue(finM.cofins),
            '', '', '', '',
            fmt.formatValue(finM.cofins),
        ]));
    }

    const totalBloco = linhas.length + 1;
    linhas.push(fmt.buildLine(['M990', totalBloco]));
    return linhas;
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO 1 — Complemento da Escrituracao
// ═══════════════════════════════════════════════════════════════════════

export function buildBloco1_Contrib(dados = {}) {
    // 🚨 O 1010 QUE ESTAVA AQUI ERA DE OUTRO ARQUIVO.
    //
    // Paulo, 17/08 (MANTOAN 07/2026), com o recibo do PVA: *"O número de campos
    // informado no registro difere do número de campos especificado no leiaute"*
    // — esperado 7, veio 9 — e mais duas recusas em `IND_NAT_ACAO` e
    // `DT_SENT_JUD` recebendo 'N'.
    //
    // A causa: **1010 existe nos DOIS arquivos, com leiautes diferentes.**
    //   EFD ICMS/IPI      1010 = Obrigatoriedade de registros do Bloco 1
    //                     (IND_EXP, IND_CCRF, IND_COMB… — a fileira de 'N')
    //   EFD Contribuições 1010 = Processo Referenciado — AÇÃO JUDICIAL
    //                     (NUM_PROC, ID_SEC_JUD, ID_VARA, IND_NAT_ACAO,
    //                      DESC_DEC_JUD, DT_SENT_JUD) = 7 campos
    //
    // Ou seja, o gerador declarava um PROCESSO JUDICIAL preenchendo os campos
    // com 'N'. Número igual, arquivo diferente — a mesma família do IPI que foi
    // parar em E200/E210 (04/08), que são registros do ICMS-ST.
    //
    // ⚠️ E NÃO SE INVENTA O 1010 CERTO: ele só existe quando a empresa TEM ação
    // judicial referenciada, e isso é dado que ninguém cadastrou. Bloco sem
    // dados se declara SEM DADOS.
    const conteudo = [];

    // 🚨 HAVENDO F550, O 1900 É OBRIGATÓRIO — recusa do PVA na AFFITTARE
    // 07/2026 (24/08), literal: *"Se o somatório do campo Valor Total da
    // Receita Auferida do registro F550 e F560 for maior que zero o registro
    // 1900 deve ser preenchido."*
    //
    // Este bloco saía SEMPRE `|1001|1|` (sem dados) — ele ficou vazio quando o
    // 1010 de ação judicial foi removido (17/08) e nunca ganhou conteúdo. Com
    // o F550 no ar desde 21/08, bloco 1 vazio virou recusa: o arquivo declara
    // receita e não a consolida.
    // ⚠️ O 1900 é consequência do **F550**, e a recusa do PVA fala só de
    // "F550 e F560". No arquivo DETALHADO o aluguel vai no F100 e o bloco 1
    // fica sem dados — é o que o EFD assinado da PEC 05/2026 faz
    // (`|1001|1|`, sem 1900), e ele tem aluguel. Emitir o 1900 ali seria
    // inventar obrigação que a recusa não criou.
    const receita = (dados.escrituracaoConsolidada !== false)
        ? Number(dados.receitaSemDocumento || 0)
        : 0;
    if (receita > 0) {
        const r = montar1900({
            cnpj: dados.empresa?.cnpj,
            receita,
            codMod: dados.contrib1900CodMod,
            codSit: dados.contrib1900CodSit,
        });
        if (r?.campos) {
            const c = r.campos;
            conteudo.push(fmt.buildLine([
                '1900', c.cnpj, c.codMod, c.serie, c.subSerie, c.codSit,
                fmt.formatValue(c.valorTotalReceita), c.quantDoc,
                c.cstPis, c.cstCofins, c.cfop, c.infoCompl, c.codCta,
            ]));
        } else if (r?.falta) {
            // ⚠️ NÃO SAI COM CAMPO INVENTADO. COD_MOD e COD_SIT são tabela
            // oficial e dependem de QUAL documento a empresa emite pelo
            // aluguel — o app não sabe, e chutar é a família do 1405. Sem
            // cadastro o registro não sai e a falta é DITA, com a recusa
            // literal do PVA e o lugar de preencher (o desenho do 0002).
            dados.warnings?.push(
                'Bloco 1: o registro 1900 NÃO foi gerado por falta de cadastro — '
                + `${r.falta.join(' e ')}. O PVA vai RECUSAR o arquivo com: "Se o somatório do campo `
                + 'Valor Total da Receita Auferida do registro F550 e F560 for maior que zero o registro '
                + '1900 deve ser preenchido." Preencha em Empresas → Dados Fiscais → '
                + '"EFD-Contribuições: consolidação da receita (1900)". '
                + 'O app não escolhe esses códigos: eles são de tabela oficial e dependem de qual '
                + 'documento a empresa emite pelo aluguel.',
            );
        }
    }

    // IND_MOV: 0 = bloco COM dados · 1 = sem dados. Sai do que foi REALMENTE
    // produzido — registro novo aqui vira '0' sozinho, sem ninguém lembrar.
    return [
        fmt.buildLine(['1001', conteudo.length ? '0' : '1']),
        ...conteudo,
        fmt.buildLine(['1990', String(conteudo.length + 2)]),
    ];
}

// ═══════════════════════════════════════════════════════════════════════
// BLOCO 9 — Controle e Encerramento do Arquivo
//
// 🚨 ERA UMA SEGUNDA CÓPIA, LINHA POR LINHA (22/08). O bloco 9 é ARITMÉTICA DE
// FECHAMENTO — o 9900 conta cada tipo de registro, o 9990 conta as linhas do
// próprio bloco e o 9999 conta o ARQUIVO INTEIRO. O PVA confere os três, e o
// mecanismo é o MESMO nas duas famílias: ele lê os registros que de fato
// saíram, não uma lista.
//
// As duas implementações eram idênticas — e é justamente aí que a segunda
// cópia é perigosa: não há defeito HOJE, e a próxima correção entra numa só.
// É o que aconteceu com o `getContadorPadrao` (20/08) e com o
// `UNIDADES_PADRAO`, nesta mesma dupla de arquivos.
// ═══════════════════════════════════════════════════════════════════════
export { buildBloco9 as buildBloco9_Contrib } from './sped-fiscal-bloco9.js';
