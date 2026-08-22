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
