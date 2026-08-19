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
    for (const n of notas || []) {
        if (!ehNotaDeMercadoria(n)) continue;
        // Cancelada entra COM C100 e sem filhos (Guia Prático) — ela não
        // precisa de item, e tirá-la esconderia a numeração do talão.
        if (docCancelado(n)) { escrituradas.push(n); continue; }
        if (ehResumoSefaz(n)) { soResumo.push(rotuloDoDoc(n)); continue; }
        if (!Array.isArray(n.itens) || n.itens.length === 0) { semItens.push(rotuloDoDoc(n)); continue; }
        escrituradas.push(n);
    }
    return { notas: escrituradas, soResumo, semItens };
}

/** CT-e do período (bloco D), sem os resumos. */
export function selecionarCtesBlocoD(notas) {
    return (notas || []).filter(ehConhecimentoDeTransporte);
}

/**
 * Avisos do que ficou de FORA do arquivo — nota que some sem ninguém saber é
 * livro a menor, e foi assim que a PS VIDROS perdeu 100 das 131.
 */
export function avisosDaSelecao({ soResumo = [], semItens = [] } = {}) {
    const avisos = [];
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
