// ============================================================================
// sefaz-backend/sped-selecao-documentos.js  (PURO — testável)
// ----------------------------------------------------------------------------
// QUAL DOCUMENTO ENTRA EM QUAL BLOCO DO SPED — lendo o modelo pela RÉGUA, nunca
// pelo campo cru.
//
// ═══ POR QUE EXISTE (Paulo, 19/08 — PRONTO SOCORRO 0896, 07/2026) ═══════════
//
// *"No consultor está puxando 131 notas de saída NF-e e NFC-e; quando gerei o
// SPED me dá isso aqui apenas"* — e o relatório de saídas do PVA trazia DOIS
// CFOPs, R$ 30.833,16, contra R$ 74.213,10 do recorte.
//
// A CAUSA: os filtros dos blocos liam o CAMPO CRU `n.modelo`…
//
//     if (!['55','65'].includes(String(n.modelo))) return false;
//
// …e o importer PRINCIPAL (`xml-importer.js` — captura SEFAZ, cofre de e-mail,
// XML manual do backend) **NUNCA GRAVOU esse campo**. Ele grava `tipo`,
// `tipoDoc`, `chave` — e o modelo mora dentro da CHAVE (posições 21-22).
// Só o import manual pelo navegador (`xmlParserService`) e o `sync-routes`
// gravam `modelo`, e eram essas as poucas notas que sobravam no arquivo.
//
// ⚠️ O ALCANCE ERA MAIOR QUE O BLOCO C: a MESMA leitura estava no bloco D
// (CT-e), no bloco C do EFD-Contribuições e — o pior — em
// `somarImpostoPorDirecao`, que é quem soma o **débito e o crédito de ICMS do
// E110** e o **IPI do E520**. Nota fora do bloco é nota fora da APURAÇÃO.
//
// É a família de `docCancelado` e `direcaoEfetivaDoc`: **o campo gravado pode
// não existir, e quem responde é a régua na LEITURA**.
//
// ⚠️ E o `modeloDoDoc` tem uma armadilha própria, já registrada: ele CAI EM
// '55' quando não há modelo nem chave legível. Por isso o tipo do documento é
// julgado ANTES — senão uma NFS-e sem modelo entraria no bloco C como se fosse
// NF-e (o defeito que a régua do FUNRURAL pegou em 13/08).
//
// 📌 RESUMO NÃO SE ESCRITURA: o resNFe (~531 bytes) não tem itens, então não
// produz C190/C170 — um C100 solto é arquivo recusado. Ele sai NOMEADO, com a
// ação certa (importar o XML completo, ou o ♻️ Reler XMLs guardados), em vez de
// sumir calado. Nota CANCELADA é a exceção: o Guia Prático manda escriturar só
// o C100, sem filhos — ela ENTRA.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';
import { modeloDoDoc } from './participante-doc-helper.js';
import { isResumoSchema, isResumoTipoDoc } from './gravacao-nfe-regua.js';
import { docCancelado } from './xml-metadata-helper.js';

/** Rótulos de tipo que NUNCA são mercadoria (bloco C). */
const RE_NAO_MERCADORIA = /CTe|MDFe|NFSe|NFS-e/i;

const rotuloTipo = (d) => `${String(d?.tipoDoc || '')} ${String(d?.tipo || '')}`;

/** Como a nota aparece num aviso: o número é o que a pessoa procura na tela. */
export const rotuloDoDoc = (d) => String(d?.numero || d?.chave || '(sem número)');

/** O documento é um RESUMO da SEFAZ (sem itens, por natureza)? */
export const ehResumoSefaz = (d) => isResumoSchema(d?.schema) || isResumoTipoDoc(d?.tipoDoc);

/**
 * NF-e (55) ou NFC-e (65) — o que vai ao bloco C.
 *
 * O tipo é julgado ANTES do modelo porque o fallback do `modeloDoDoc` é '55'.
 */
export function ehNotaDeMercadoria(d) {
    if (!d) return false;
    if (RE_NAO_MERCADORIA.test(rotuloTipo(d))) return false;
    // Blocos que só existem em nota de serviço — a mesma leitura do FUNRURAL.
    if (d.prestador || d.tomador) return false;
    return ['55', '65'].includes(modeloDoDoc(d));
}

/**
 * NFS-e — o que vai ao bloco A do EFD-Contribuições.
 *
 * 🚨 O IRMÃO QUE FALTAVA (21/08, varredura dos leitores de documento). O filtro
 * do bloco A perguntava `n.tipo === 'NFSe' || String(n.modelo) === 'NFSE'` — as
 * DUAS formas mais raras. A NFS-e do portal de SP entra por CSV/TXT e grava
 * `prestador`/`tomador`; a do ADN grava `tipoDoc`. Documento que chegasse por
 * esses trilhos sem o `tipo` cravado sumia do bloco A — e sumir do bloco A é
 * sumir da apuração de PIS/COFINS, calada.
 *
 * ⚠️ CT-e NÃO ENTRA, e é por isso que esta régua não é a `ehDocumentoDeServico`
 * do FUNRURAL: aquela responde "é serviço?" (e o CT-e é), enquanto aqui a
 * pergunta é "vai ao bloco A?" — o CT-e vai ao **D**. Trocar uma pela outra
 * mandaria todo conhecimento de transporte para o bloco errado.
 */
export function ehNotaDeServico(d) {
    if (!d) return false;
    if (ehConhecimentoDeTransporte(d)) return false;
    const rotulo = rotuloTipo(d);
    if (/MDFe/i.test(rotulo)) return false;
    // ⚠️ `NFS-?e`, nunca `NFS?e`: com o `?` no S o padrão casa "NFe" e a nota
    // de MERCADORIA entraria no bloco A (pego pelo teste antes de subir).
    if (/NFS-?e|servico|serviço/i.test(rotulo)) return true;
    // Blocos que SÓ existem em nota de serviço — é como o próprio app já
    // normaliza a NFS-e do portal (prestador/tomador) e o que o FUNRURAL usa.
    if (d.prestador || d.tomador) return true;
    if (d.codigoServicoMunicipal || d.itemLc116 || d.discriminacao) return true;
    return false;
}

/** CT-e (57) / CT-e OS (67) — o que vai ao bloco D. */
export function ehConhecimentoDeTransporte(d) {
    if (!d) return false;
    const rotulo = rotuloTipo(d);
    if (/MDFe|NFSe/i.test(rotulo)) return false;
    if (/CTe/i.test(rotulo)) return !ehResumoSefaz(d);
    return ['57', '67'].includes(modeloDoDoc(d));
}

/** COD_MOD da NFC-e — cupom eletrônico, venda ao consumidor. */
export const COD_MOD_NFCE = '65';

/** A NFC-e (COD_MOD 65). */
export function ehNfce(d) {
    return modeloDoDoc(d) === COD_MOD_NFCE;
}

/**
 * O documento leva **C170** (detalhe do item) no EFD-**Contribuições**?
 *
 * 🚨 NÃO, quando é NFC-e. Recusa do PVA, LITERAL (HYPE CAFE 1385 · 07/2026,
 * 24/08): *"O registro não deve ser informado para o modelo de documento do
 * 'Registro Pai'."* e *"O registro não deve ser informado para esse perfil
 * e/ou tipo de operação"* — **286 C170, cada um com as duas mensagens, 572
 * recusas**, todos filhos de um C100 com COD_MOD 65. Os 5 C170 das três notas
 * modelo 55 do mesmo arquivo passaram.
 *
 * ⚠️ **E ISSO NÃO TIRA UM CENTAVO DA APURAÇÃO**: a receita da NFC-e é declarada
 * no C100 (VL_DOC/VL_PIS/VL_COFINS) e no bloco M, que sai de
 * `receitaEBaseDoDocumento` — não do C170. No arquivo da HYPE, os 179 C100 de
 * NFC-e somam exatamente o `VL_REC_BRT 19.722,70` do M210.
 *
 * 🚨 **A CONSEQUÊNCIA OBRIGATÓRIA, no MESMO PR**: item que só existia em NFC-e
 * sai do **0200**, senão vira item ÓRFÃO — declarado na Tabela de Identificação
 * e referenciado por ninguém, que é a recusa que a PWR já pagou em 19/08. Na
 * HYPE são quatro (`10`, `11`, `20`, `101`). Vale igual para a UNID do 0190.
 *
 * ⚠️ **Isto é do EFD-Contribuições.** No EFD ICMS/IPI a NFC-e tem restrições
 * PRÓPRIAS, e elas são de CAMPO do C100 (`COD_PART`, ST, IPI, PIS, COFINS —
 * regra R2 da prevalidação, PS VIDROS 19/08), não de existência do C170.
 * Portar uma família para a outra é o defeito que o 0500 acabou de cobrar.
 */
export function levaC170NoContribuicoes(nota) {
    return !ehNfce(nota);
}

/**
 * Separa as notas do bloco C entre as que se escrituram e as que NÃO têm como
 * ser escrituradas — cada grupo com ação própria.
 *
 * @returns {{notas: object[], soResumo: string[], semItens: string[]}}
 */
export function selecionarNotasBlocoC(notas) {
    const escrituradas = [];
    const soResumo = [];
    const semItens = [];
    const nfceEmEntrada = [];
    for (const n of notas || []) {
        if (!ehNotaDeMercadoria(n)) continue;
        // 📖 Guia Prático 3.2.3, C100: *"As NFC-e (código 65) não devem ser
        // escrituradas nas ENTRADAS"*. Cupom é venda ao consumidor — recebê-lo
        // como documento de entrada não é operação que se escritura no bloco C.
        if (modeloDoDoc(n) === '65' && n.direcao === 'entrada') {
            nfceEmEntrada.push(rotuloDoDoc(n));
            continue;
        }
        // Cancelada entra COM C100 e sem filhos (Guia Prático) — ela não
        // precisa de item, e tirá-la esconderia a numeração do talão.
        if (docCancelado(n)) { escrituradas.push(n); continue; }
        // 🚨 QUEM DECIDE É O ITEM, NUNCA O RÓTULO (defeito MEU, pego pelo PVA da
        // PWR 07/2026 no mesmo dia): o import pelo NAVEGADOR não grava `schema`
        // nem `tipoDoc`, então a nota COMPLETADA por cima de um resumo continua
        // rotulada `resNFe` — com itens, modelo e número. Excluí-la pelo rótulo
        // tirou do bloco C três notas inteiras (GLOBAL COMPANY, POXPUR, BENCO) e
        // o PVA acusou na hora: participante e item declarados no 0150/0200 sem
        // C100 que os referencie, e o crédito do E110/E520 sem origem.
        // O rótulo de resumo só serve para EXPLICAR a ausência de item.
        if (Array.isArray(n.itens) && n.itens.length > 0) { escrituradas.push(n); continue; }
        if (ehResumoSefaz(n)) { soResumo.push(rotuloDoDoc(n)); continue; }
        semItens.push(rotuloDoDoc(n));
    }
    return { notas: escrituradas, soResumo, semItens, nfceEmEntrada };
}

/** CT-e do período (bloco D), sem os resumos. */
export function selecionarCtesBlocoD(notas) {
    return (notas || []).filter(ehConhecimentoDeTransporte);
}

/**
 * Avisos do que ficou de FORA do arquivo — nota que some sem ninguém saber é
 * livro a menor, e foi assim que a PS VIDROS perdeu 100 das 131.
 */
export function avisosDaSelecao({ soResumo = [], semItens = [], nfceEmEntrada = [] } = {}) {
    const avisos = [];
    if (nfceEmEntrada.length) {
        avisos.push(
            `SPED: ${nfceEmEntrada.length} NFC-e ficaram fora por estarem como ENTRADA — `
            + `nº ${nfceEmEntrada.slice(0, 8).join(', ')}${nfceEmEntrada.length > 8 ? '…' : ''}. `
            + 'O Guia Prático diz que "as NFC-e (código 65) não devem ser escrituradas nas entradas". '
            + 'Se a direção estiver errada no cadastro do documento, corrija na Central de XMLs.',
        );
    }
    if (soResumo.length) {
        avisos.push(
            `SPED: ${soResumo.length} nota(s) ficaram FORA do arquivo porque a base só tem o RESUMO da SEFAZ `
            + `(sem itens, e sem itens não há C170/C190) — nº ${soResumo.slice(0, 8).join(', ')}`
            + `${soResumo.length > 8 ? '…' : ''}. Importe o XML completo (Central de XMLs → Importar) ou rode o `
            + '♻️ Reler XMLs guardados na aba ✏️ CFOP por nota. Até lá o livro está a MENOS.',
        );
    }
    if (semItens.length) {
        avisos.push(
            `SPED: ${semItens.length} nota(s) válidas SEM itens capturados ficaram fora — `
            + `nº ${semItens.slice(0, 8).join(', ')}${semItens.length > 8 ? '…' : ''}. `
            + 'Elas produziriam um C100 sem C190, que o PVA recusa. Reimporte o XML dessas notas.',
        );
    }
    return avisos;
}


// ═══ COD_SIT — a SITUAÇÃO do documento, régua ÚNICA ════════════════════════
//
// 🚨 Existiam DUAS (21/08, varredura dos defaults): o bloco C mandava '00'
// (regular) quando não reconhecia o status e o bloco D mandava **'08'** —
// que significa *"documento emitido por regime especial ou norma específica"*
// e tem regras PRÓPRIAS de preenchimento (Guia 3.2.3, C100, Exceção 4).
// Declarar regime especial porque o status veio desconhecido é afirmar sobre a
// natureza do documento — a mesma família do 'PARTSEM' e do CFOP '5352'.
// A tabela do COD_SIT é a MESMA para C100 e D100, então a régua é uma só.

/** CFOPs da nota em substituição ao cupom fiscal (Exceção 4 → COD_SIT 08). */
const CFOPS_SUBSTITUICAO_CUPOM = new Set(['5929', '6929']);

const SITUACAO_POR_STATUS = {
    autorizado: '00',
    extemporaneo: '01',
    cancelado: '02',
    denegado: '04',
    inutilizado: '05',
};

/**
 * COD_SIT do documento (C100 e D100 — mesma tabela).
 *
 * @param {object} nota
 * @param {string} [uf] UF da empresa — o PARANÁ escritura a nota em
 *   substituição ao cupom por outra regra, ressalva do próprio manual.
 */
export function codSitDoDocumento(nota, uf) {
    // ⚠️ O STATUS ESPECÍFICO VEM PRIMEIRO, e a ordem é o conserto de um defeito
    // pré-existente: `docCancelado` trata denegado/inutilizado como cancelamento
    // (para efeito de "não conta no livro", que é o uso dela), então perguntar
    // por ela antes fazia a nota DENEGADA sair com COD_SIT **02** em vez de
    // **04**. São fatos diferentes: denegada é a SEFAZ RECUSANDO a autorização
    // (a nota nunca valeu); cancelada é a nota que existiu e foi cancelada.
    const doStatus = SITUACAO_POR_STATUS[String(nota?.status || '').toLowerCase()];
    if (doStatus && doStatus !== '00') return doStatus;
    // Só então o cancelamento por EVENTO — nele o campo `status` continua
    // 'autorizado', e é a régua que responde.
    if (docCancelado(nota)) return '02';
    // Status que ninguém reconhece é REGULAR ('00'), nunca regime especial:
    // '08' declara um fato sobre o documento que ninguém verificou.
    const base = '00';
    if (String(uf || '').toUpperCase() === 'PR') return base;
    const ehSubstituicaoCupom = (nota?.itens || []).some(
        (i) => CFOPS_SUBSTITUICAO_CUPOM.has(String(i?.cfop || i?.CFOP || '').replace(/\D/g, '')),
    );
    return ehSubstituicaoCupom ? '08' : base;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 TIPO_ITEM — o 0200 declarava SERVIÇO como "mercadoria para revenda"
//
// Varredura noturna dos leitores de DOCUMENTO (21/08). Os DOIS orquestradores
// montavam o item do 0200 com `tipo: '00'` cravado, e '00' é **Mercadoria para
// Revenda** — inclusive no item SINTÉTICO que representa a NFS-e sem
// discriminação (`SERV-GENERICO`), que existe justamente porque o documento é
// de SERVIÇO. É a família do COD_GEN '00' e do 'PARTSEM': default de campo
// fiscal é invenção com outro nome.
//
// O Guia Prático 3.2.3 é literal sobre o serviço (registro C321, ao explicar o
// serviço de competência municipal): *"deverá ser criado o correspondente item
// no registro 0200, cujo conteúdo do campo TIPO_ITEM será igual '09'
// (Serviços)"*. E o campo 08 do mesmo 0200: *"Não existe COD-NCM para
// serviços"* — por isso o NCM do item de serviço sai VAZIO, nunca o
// '00000000' que o gerador escrevia (NCM fabricado é a mesma invenção, um
// campo adiante).
//
// ⚠️ O QUE ESTA RÉGUA **NÃO** FAZ, de propósito: adivinhar o tipo da
// MERCADORIA. Numa indústria, matéria-prima é 01 e produto acabado é 04 — e
// isso **não está no XML** (o fornecedor não declara a destinação que a
// mercadoria terá aqui, exatamente como no caso KALUNGA do CFOP). Deduzir pelo
// ramo produziria o 1405 de novo, num campo que o Bloco K cruza. Enquanto não
// houver cadastro por item, mercadoria continua '00' — pendência NOMEADA aqui,
// não conserto silencioso.
// ═══════════════════════════════════════════════════════════════════════════

/** Tabela 4.1.1 — Tipo do Item. Só os dois que esta régua decide. */
export const TIPO_ITEM_SERVICO = '09';
export const TIPO_ITEM_MERCADORIA_REVENDA = '00';

/**
 * TIPO_ITEM do item, pelo DOCUMENTO em que ele veio.
 *
 * ⚠️ Lê pelo mesmo `ehNotaDeServico` do bloco A. O CT-e não passa por aqui
 * porque não tem `itens[]` — se um dia tiver, ele é serviço igualmente, e a
 * régua a usar é a do FUNRURAL (`ehDocumentoDeServico`), não esta.
 */
export function tipoItemDoDocumento(nota) {
    return ehNotaDeServico(nota) ? TIPO_ITEM_SERVICO : TIPO_ITEM_MERCADORIA_REVENDA;
}

/** O item é de serviço? (o 0200 dele não leva NCM — Guia 3.2.3, 0200 campo 08) */
export function ehItemDeServico(item) {
    return String(item?.tipo || '') === TIPO_ITEM_SERVICO;
}

/**
 * O `00` está sendo AFIRMADO em quem provavelmente não revende — diga isso.
 *
 * 🚨 A PENDÊNCIA ACIMA ERA REAL E ESTAVA **CALADA** (fechado em 29/08). O Guia
 * dá ONZE valores ao TIPO_ITEM (00 revenda · 01 matéria-prima · 02 embalagem ·
 * 03 produto em processo · 04 produto acabado · 05 subproduto · 06 produto
 * intermediário · 07 uso e consumo · 08 ativo imobilizado · 09 serviços · 10
 * outros insumos · 99 outras), e o app declara **00 em toda mercadoria**.
 *
 * ⚠️ **E ISSO É CERTO NO CASO COMUM**: num COMÉRCIO, "mercadoria para revenda"
 * é exatamente o que o item é. Acender ali seria alarme sobre arquivo correto
 * na carteira inteira — o jeito conhecido de a equipe desligar o aviso.
 *
 * 🚨 **QUEM ACENDE É A INDÚSTRIA**, e por prova do CADASTRO (`contribuinteIpi`
 * = sim), nunca por dedução do ramo: numa indústria a matéria-prima é 01 e o
 * produto acabado é 04, e **isso não está no XML** — o fornecedor não declara a
 * destinação que a mercadoria terá aqui (o caso KALUNGA do CFOP, um campo
 * adiante). Deduzir produziria o `1405` num campo que o **Bloco K cruza**.
 *
 * 📌 Por isso o app **não escolhe**: ele DIZ quantos itens saíram com o `00`
 * afirmado e o que isso significa.
 *
 * ✅ **DECISÃO DO PAULO (30/08): o aviso mensal fica, e o CADASTRO POR ITEM
 * NÃO se constrói** — perguntado se preferia aceitar o aviso todo mês ou mandar
 * fazer o cadastro, respondeu *"1 aceito"*. É a mesma fronteira do calendário
 * municipal (*"eu não vou fazer nada manual"*, 16/08): seriam milhares de
 * linhas para digitar.
 *
 * 🚩 **NÃO RESSUSCITAR COMO PENDÊNCIA.** Isto não é lacuna esperando conserto —
 * é desenho escolhido pelo dono. Construir o cadastro "para silenciar o aviso"
 * seria extensão minha por cima de uma decisão dele, que é o vício do FGTS
 * (18/08). Só volta a ser questão se ELE pedir.
 */
export function avisoDeTipoItemPresumido(itens, ctx) {
    const marcado = String(ctx?.contribuinteIpi || '').toLowerCase();
    if (marcado !== 'sim') return '';
    const mercadorias = (Array.isArray(itens) ? itens : [])
        .filter((i) => String(i?.tipo || '') === TIPO_ITEM_MERCADORIA_REVENDA);
    if (!mercadorias.length) return '';
    return `0200: ${mercadorias.length} item(ns) saíram com TIPO_ITEM "00 — Mercadoria para Revenda", `
        + 'que é o padrão do app, numa empresa marcada como CONTRIBUINTE DE IPI. Numa indústria o item '
        + 'costuma ser 01 (matéria-prima), 03 (produto em processo), 04 (produto acabado) ou 07 '
        + '(uso e consumo) — e a destinação NÃO vem no XML, então o app não a deduz: o fornecedor não '
        + 'sabe o que a mercadoria vira aqui. O PVA ACEITA o 00; quem cruza este campo é o Bloco K. '
        + 'Confira os itens antes de transmitir e, se o TIPO_ITEM precisar ser outro, avise para virar '
        + 'cadastro por item.';
}

/**
 * SER — a série do documento, com as TRÊS posições que o PVA cobra.
 *
 * 🚨 O bloco D escrevia `nota.serie || '1'`: série **1 INVENTADA** em todo CT-e
 * que chegasse sem o campo gravado. E o C100 caía em '000' na mesma situação —
 * o que é o certo quando a nota realmente não tem série, e é uma DIVERGÊNCIA
 * quando ela tem: *"o PVA confere a série contra a que está DENTRO da chave"*
 * (recusa de 20/08, PWR).
 *
 * A chave não mente: a série mora nas posições **23-25** dela, ao lado do
 * modelo (21-22) e do número (26-34) — as mesmas posições que o ♻️ já usa para
 * recuperar o número da nota que chegou só como resumo.
 *
 * Guia Prático 3.2.3, C100 campo 07: *"campo de preenchimento obrigatório com
 * três posições … Se não existir Série … informar 000"* — por isso '000' é a
 * resposta final, nunca '1'.
 */
export function serieDoDocumento(nota) {
    const gravada = String(nota?.serie ?? '').replace(/\D/g, '');
    if (gravada) return gravada.padStart(3, '0').slice(-3);
    const chave = String(nota?.chave || nota?.chaveAcesso || nota?.chNFe || nota?.chCTe || '')
        .replace(/\D/g, '');
    if (chave.length === 44) return chave.slice(22, 25);
    return '000';
}

/**
 * COD_ITEM — a CHAVE que liga o item ao cadastro do 0200.
 *
 * 🚨 ELA TINHA QUATRO CÓPIAS, E AS QUATRO DIVERGIAM (22/08). O 0200 é a Tabela
 * de Identificação do Item; C170 e A170 APONTAM para ela. Quando os dois lados
 * respondem coisas diferentes, o PVA devolve as DUAS recusas que esta casa já
 * pagou — *"Campo obrigatório · COD_ITEM"* (MANTOAN, 36 recusas, 18/08) e o
 * item ÓRFÃO, declarado no 0200 e referenciado por ninguém (PWR, 19/08).
 *
 * O retrato de antes:
 *
 *   · **0200** (os DOIS orquestradores): `cProd || codigo || cFiscal || ITEM-n`
 *   · **C170 do EFD ICMS/IPI**: `cProd || codigo || ITEM-n` — **sem o cFiscal**
 *   · **C170 do EFD-Contribuições**: `cProd || codigo || ''` — **pode sair VAZIO**
 *   · **A170 do EFD-Contribuições**: `cProd || codigo || ''` — idem
 *
 * E havia uma quinta divergência escondida no `ITEM-n`: o 0200 usa o `nItem`
 * que veio no XML, e o C170 do ICMS/IPI usava o **contador do laço**. Item que
 * chegasse com `nItem` "3" na terceira posição do array batia por coincidência;
 * fora disso, o 0200 dizia `ITEM-3` e o C170 `ITEM-1` — órfão garantido.
 *
 * Quem manda é o 0200, porque ele é o CADASTRO: quem aponta se ajusta a quem é
 * apontado. Nunca devolve vazio — campo obrigatório sem valor é recusa certa.
 *
 * ⚠️ **A PENDÊNCIA FOI RE-MEDIDA EM 29/08, E ELA ESTAVA MAL NOMEADA.** Ficou
 * escrito aqui que *"item sem `nItem` cai em `ITEM-?`"* — e medir os QUATRO
 * trilhos que criam item mostrou que **todos preenchem o `nItem`**, com o
 * índice do laço como reserva (`xml-importer.js:102`, `xmlParserService.ts:269`
 * e `:671`, `notaDigitada.ts:258`). O `?` é **inalcançável**, e a trava por
 * varredura ao lado impede que um trilho novo o alcance.
 *
 * 🚨 **O QUE É REAL É OUTRA COISA, e é pior porque acontece calada**: o
 * `ITEM-n` é numerado **POR DOCUMENTO** e o 0200 é a tabela do **ARQUIVO
 * INTEIRO**. Dois produtos SEM `cProd`, cada um o item 1 do seu documento,
 * viram os dois `ITEM-1` — e o coletor do 0200 faz `if (!map.has(cod))`, ou
 * seja **o primeiro vence e o segundo desaparece dentro dele**. O arquivo
 * declara um item onde havia dois, e os C170 dos dois apontam para a descrição
 * de um só.
 *
 * ⚠️ **E A CHAVE NÃO MUDA AQUI, de propósito.** Ela é o que o C170/A170
 * REFERENCIA: mexer nela sem um caso real medido troca uma colisão silenciosa
 * por um item ÓRFÃO em todo cliente cujo XML não traz `cProd` — a recusa que a
 * PWR já pagou (19/08). O que a casa faz com o que não sabe decidir é
 * **DENUNCIAR**: `conferirColisaoDeItem` abaixo acusa a fusão, com os dois
 * nomes, para quem gera decidir.
 */
export function codItemDoItem(item) {
    const i = item || {};
    const direto = i.cProd || i.codigo || i.cFiscal;
    if (direto) return String(direto);
    return `ITEM-${i.nItem || '?'}`;
}

/**
 * Dois itens caíram no MESMO `COD_ITEM` — eles são o mesmo produto?
 *
 * Devolve o nome do campo que DIVERGE (ou `null` quando são o mesmo item). O
 * caso normal — o mesmo produto aparecendo em vinte documentos com o mesmo
 * `cProd` — responde `null` e não gera ruído; alarme sobre arquivo correto é o
 * jeito conhecido de a equipe desligar a trava.
 *
 * ⚠️ Compara **descrição e NCM**, que é o que o 0200 declara e o que muda de
 * verdade entre dois produtos. Campo VAZIO de um dos lados não acusa: ausência
 * não é divergência (é captura incompleta, e tem trilho próprio).
 */
export function conferirColisaoDeItem(existente, novo) {
    const a = existente || {};
    const b = novo || {};
    for (const campo of ['descricao', 'ncm']) {
        const x = String(a[campo] ?? '').trim().toUpperCase();
        const y = String(b[campo] ?? '').trim().toUpperCase();
        if (x && y && x !== y) return campo;
    }
    return null;
}

/**
 * A frase da colisão — UMA só, para as duas famílias.
 *
 * Duas mensagens fariam o mesmo defeito ser descrito de dois jeitos, e quem lê
 * o aviso do EFD ICMS/IPI e o do Contribuições no mesmo dia concluiria que são
 * problemas diferentes.
 */
export function avisoDeColisaoDeItem(colisoes) {
    if (!Array.isArray(colisoes) || !colisoes.length) return '';
    const amostra = colisoes.slice(0, 5)
        .map((c) => `${c.codItem} ("${c.de}" × "${c.para}")`)
        .join('; ');
    return `0200: ${colisoes.length} item(ns) DIFERENTE(s) caíram no mesmo COD_ITEM e o arquivo `
        + `declara só o primeiro — ${amostra}${colisoes.length > 5 ? ` e mais ${colisoes.length - 5}` : ''}. `
        + 'Acontece quando o XML não traz o código do produto (cProd): o item passa a ser numerado '
        + 'por documento (ITEM-1, ITEM-2…) e dois produtos de documentos diferentes colidem. '
        + 'O PVA ACEITA — o livro é que sai com a descrição errada. Corrija o cadastro do produto '
        + 'na origem ou lance o item pelo ✏️ para ele ganhar código próprio.';
}

/**
 * UNID — a outra CHAVE do mesmo par: ela liga o item ao cadastro do **0190**.
 *
 * 🚨 MESMA DOENÇA DO `COD_ITEM`, um campo adiante (22/08). O 0190 é a Tabela de
 * Unidade de Medida; C170, H010 e o UNID_INV do 0200 apontam para ela — e as
 * cinco escritas normalizavam de jeitos diferentes:
 *
 *   · **0190** (os dois orquestradores): `.toUpperCase().substring(0,6)` —
 *     **sem trim**, então `'UN '` do XML era cadastrado COM o espaço;
 *   · **C170** (as duas famílias): `sanitizeString(upper, 6)` — **com trim**,
 *     referenciando `'UN'`. Cadastro `'UN '` × referência `'UN'`: o C170
 *     aponta para unidade que o 0190 não tem, e o 0190 declara uma que
 *     ninguém referencia. As DUAS recusas do PVA, de uma vez;
 *   · **UNID_INV do 0200**: `sanitizeString(item.unidade || 'UN', 6)` — **sem
 *     `toUpperCase`**, então `'un'` no cadastro do item nunca casava com o
 *     `'UN'` do 0190;
 *   · e a rota do editor tinha uma quarta forma (`String(...).slice(0,6)`).
 *
 * O próprio validador do app já sabia a consequência — *"C170: UNID 'X' nao
 * cadastrada no 0190"* —, mas ele roda DEPOIS, sobre o arquivo pronto.
 *
 * ⚠️ **Devolve '' para ausência, de propósito**: o default `'UN'` continua onde
 * já estava (0190, 0200 e C170), e o **H010 segue sem default** — inventar a
 * unidade do inventário mudaria a leitura da QUANTIDADE, que é outra ordem de
 * erro. O que esta régua uniformiza é a FORMA da chave, não a política de
 * ausência.
 */
export function normalizarUnidade(u) {
    return fmt.sanitizeString(String(u ?? '').toUpperCase(), 6);
}

/** A unidade do item de documento, já na forma que o 0190 cadastra. */
export function unidadeDoItem(item) {
    const i = item || {};
    return normalizarUnidade(i.uCom || i.unidade) || 'UN';
}

/**
 * DESCR_UNID do 0190 — a descrição da unidade.
 *
 * 🚨 A tabela existia em DUAS cópias, uma em cada orquestrador, e elas já
 * divergiam: a do EFD ICMS/IPI tinha **`CM: CENTIMETRO`** e a do
 * EFD-Contribuições não. Um item em CM saía descrito como *"CENTIMETRO"* num
 * arquivo e *"CM"* no outro — **dois arquivos do mesmo mês descrevendo a mesma
 * unidade de dois jeitos**, que é a divergência do `getContadorPadrao` (20/08)
 * na mesma dupla de orquestradores.
 *
 * Unidade fora da tabela repete o próprio código: descrever no escuro seria
 * inventar, e o código já é a informação.
 */
const UNIDADES_PADRAO = {
    UN: 'UNIDADE', KG: 'QUILOGRAMA', L: 'LITRO', LT: 'LITRO',
    M: 'METRO', M2: 'METRO QUADRADO', M3: 'METRO CUBICO',
    CX: 'CAIXA', PC: 'PECA', PCT: 'PACOTE', PAR: 'PAR',
    DZ: 'DUZIA', TON: 'TONELADA', G: 'GRAMA', ML: 'MILILITRO',
    CM: 'CENTIMETRO',
};

export function descreverUnidade(codigo) {
    const c = normalizarUnidade(codigo);
    return UNIDADES_PADRAO[c] || c;
}
