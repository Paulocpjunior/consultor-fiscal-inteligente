// ============================================================================
// sefaz-backend/sped-fiscal-blocoB.js  (PURO — testável)
// ----------------------------------------------------------------------------
// BLOCO B DO EFD ICMS/IPI — ESCRITURAÇÃO E APURAÇÃO DO ISS (Distrito Federal).
//
// ═══ O CASO QUE CRIOU ISTO (Paulo, 11/09, LEGACY · 08/2026) ════════════════
//
// O PVA recusou o arquivo da LEGACY (DF) com *"Registro filho obrigatório não
// foi informado — B470"*, e ele mandou o arquivo ANTERIOR, aceito, gerado pelo
// e-Fiscal em 10/2025: `|B001|0|` + `|B470|0|0|0|0|0|0|0|0|0|0|0|0|0|0|`.
// Palavras dele: *"esse bloco B470 tem que preencher … são para todas as
// empresas de BRASILIA que entrega SPED ICMS IPI"*.
//
// O gerador emitia o bloco B VAZIO (`B001|1`) para TODO mundo — ele nasceu
// como "bloco vazio" em `sped-fiscal-blocos-vazios.js` e nunca soube que o DF
// é diferente.
//
// ═══ A FONTE ═══════════════════════════════════════════════════════════════
//
// 📖 Guia Prático 3.2.3, Seção 2 (Bloco B): *"Bloco B incluído para vigorar a
// partir do período de apuração de janeiro de 2019 — Apuração do ISS,
// exclusivo para contribuintes do Distrito Federal."* E no B001: *"Os
// estabelecimentos NÃO domiciliados no Distrito Federal deverão informar apenas
// os registros B001 e B990 (abertura – bloco sem dados informados e
// fechamento)."*
//
// 📖 B470 — *"Este registro deve ser gerado para registrar os totais referentes
// às prestações de serviço do declarante e para apurar os valores a recolher do
// ISS próprio, do ISS retido pelo declarante na condição de tomador e do ISS
// Uniprofissional."* Campos 02-15, todos `Obrig O`, `Ocorrência – um (por
// arquivo)`.
//
// ═══ A RÉGUA ═══════════════════════════════════════════════════════════════
//
// · UF do estabelecimento ≠ DF ⇒ `B001|1` + `B990|2` — literal no Guia.
// · UF = DF ⇒ `B001|0` + `B470` + `B990|3`.
//
// 🚨 O QUE VAI NO B470, e de ONDE vem: as prestações de SERVIÇO do declarante
// (NFS-e de SAÍDA do período — `ehNotaDeServico` + `direcaoEfetivaDoc`, os
// donos de sempre) somadas em VL_CONT / VL_BC_ISS / VL_ISS / VL_ISS_RT; e o ISS
// que o declarante RETEVE como tomador (NFS-e de ENTRADA com retenção) no
// VL_ISS_ST. Cancelada fica de fora (`docCancelado`), e a lápide já foi
// aplicada por quem carregou as notas.
//
// ⚠️ ZERO SÓ ENTRA QUANDO ZERO É A RESPOSTA (regra de 06/08). Numa empresa do
// DF SEM nota de serviço no mês — o caso LEGACY, comércio de livros — os
// quatorze zeros são a afirmação certa (*"não houve prestação"*), e é
// exatamente o que o arquivo ACEITO do e-Fiscal declara. Material de terceiros,
// material próprio, subempreitada e sociedade uniprofissional (campos 03, 04,
// 05 e 15) saem ZERO porque o app não tem esse dado em lugar nenhum — e isso
// vai DITO no aviso quando há prestação no mês, senão o zero passaria por
// conferido.
//
// 🚩 O QUE ESTE MÓDULO NÃO FAZ, e diz: o B020/B025 (um por documento) NÃO é
// gerado. O único arquivo aceito na mão é o da LEGACY sem movimento; montar o
// registro por documento sem leiaute provado seria o `1405` num registro que a
// SEFAZ-DF cruza. Quando o mês TEM prestação, o aviso nomeia isso — e a rodada
// do PVA é o que prova (ou cobra) o próximo degrau. Provado por arquivo aceito
// vence leiaute deduzido, sempre.
// ============================================================================

import * as fmt from './sped-fiscal-format.js';
import { ehNotaDeServico } from './sped-selecao-documentos.js';
import {
    direcaoEfetivaDoc, docCancelado, valorDoDocumento, issDoDocumento, issRetidoEfetivoDoc,
} from './xml-metadata-helper.js';

/** A UF cujo Bloco B tem conteúdo — exclusivo do DF (Guia 3.2.3, Seção 2). */
export const UF_BLOCO_B = 'DF';

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);

/** O bloco B leva conteúdo para esta UF? (`'DF'` em qualquer caixa/espaço). */
export function blocoBAplicaNaUf(uf) {
    return String(uf ?? '').trim().toUpperCase() === UF_BLOCO_B;
}

/**
 * Base de cálculo do ISS do documento — nas formas gravadas (XML ABRASF grava
 * `valores.baseCalculo`; o ADN grava `baseCalculo` na raiz; o portal de SP e a
 * nota digitada não trazem base separada, e ali a base é o valor do serviço).
 * Ausente devolve NaN — quem soma decide; nunca zero.
 */
export function baseIssDoDocumento(doc) {
    const d = doc || {};
    for (const c of [d.valores?.baseCalculo, d.baseCalculo, d.totais?.vBC]) {
        const n = num(c);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return NaN;
}

/**
 * Os totais do B470 a partir das notas do período.
 *
 * @param {object} p
 * @param {object[]} p.notas        documentos do período (já sem a lápide)
 * @param {string}   [p.empresaCnpj]
 * @returns {{
 *   prestadas: number, tomadasComRetencao: number, semValor: number,
 *   valores: {
 *     vlCont:number, vlMatTerc:number, vlMatProp:number, vlSub:number, vlIsnt:number,
 *     vlDedBc:number, vlBcIss:number, vlBcIssRt:number, vlIss:number, vlIssRt:number,
 *     vlDed:number, vlIssRec:number, vlIssSt:number, vlIssRecUni:number,
 *   },
 * }}
 */
export function apurarIssBlocoB({ notas } = {}) {
    let vlCont = 0, vlBcIss = 0, vlBcIssRt = 0, vlIss = 0, vlIssRt = 0, vlIssSt = 0;
    let prestadas = 0, tomadasComRetencao = 0, semValor = 0;

    for (const n of notas || []) {
        if (!ehNotaDeServico(n)) continue;
        if (docCancelado(n)) continue;
        const direcao = direcaoEfetivaDoc(n);
        if (direcao === 'saida') {
            prestadas += 1;
            const valor = valorDoDocumento(n);
            if (!Number.isFinite(valor)) { semValor += 1; continue; }
            const base = baseIssDoDocumento(n);
            const baseEfetiva = Number.isFinite(base) ? base : valor;
            const iss = issDoDocumento(n);
            const retido = issRetidoEfetivoDoc(n);
            vlCont += valor;
            vlBcIss += baseEfetiva;
            if (Number.isFinite(iss)) vlIss += iss;
            // J — o ISS que o TOMADOR reteve nas prestações do declarante.
            if (Number.isFinite(retido.valor) && retido.valor > 0) {
                vlIssRt += retido.valor;
                vlBcIssRt += baseEfetiva;
            }
        } else if (direcao === 'entrada') {
            // M — o ISS que o declarante reteve como TOMADOR (substituto).
            const retido = issRetidoEfetivoDoc(n);
            if (Number.isFinite(retido.valor) && retido.valor > 0) {
                tomadasComRetencao += 1;
                vlIssSt += retido.valor;
            }
        }
    }

    // Campos que o app NÃO tem em lugar nenhum — saem zero e vão DITOS no aviso
    // quando há prestação no mês (ver `avisosDoBlocoB`).
    const vlMatTerc = 0, vlMatProp = 0, vlSub = 0, vlIsnt = 0, vlDed = 0, vlIssRecUni = 0;
    const vlDedBc = r2(vlMatTerc + vlMatProp + vlSub + vlIsnt);   // F = B + C + D + E
    const vlIssRec = r2(vlIss - vlIssRt - vlDed);                // L = I - J - K

    return {
        prestadas, tomadasComRetencao, semValor,
        valores: {
            vlCont: r2(vlCont), vlMatTerc, vlMatProp, vlSub, vlIsnt, vlDedBc,
            vlBcIss: r2(vlBcIss), vlBcIssRt: r2(vlBcIssRt), vlIss: r2(vlIss), vlIssRt: r2(vlIssRt),
            vlDed, vlIssRec, vlIssSt: r2(vlIssSt), vlIssRecUni,
        },
    };
}

/** A ordem dos 14 campos de valor do B470 (Guia 3.2.3, campos 02-15). */
export const CAMPOS_B470 = [
    'vlCont', 'vlMatTerc', 'vlMatProp', 'vlSub', 'vlIsnt', 'vlDedBc', 'vlBcIss',
    'vlBcIssRt', 'vlIss', 'vlIssRt', 'vlDed', 'vlIssRec', 'vlIssSt', 'vlIssRecUni',
];

/** O que sai DITO na geração — só quando há algo a dizer. */
export function avisosDoBlocoB({ uf, apuracao } = {}) {
    const avisos = [];
    if (!blocoBAplicaNaUf(uf)) return avisos;
    const a = apuracao || { prestadas: 0, tomadasComRetencao: 0, semValor: 0 };
    if (a.prestadas > 0 || a.tomadasComRetencao > 0) {
        avisos.push(
            `Bloco B (ISS do DF): o B470 somou ${a.prestadas} NFS-e prestada(s)`
            + (a.tomadasComRetencao ? ` e ${a.tomadasComRetencao} tomada(s) com ISS retido pelo declarante` : '')
            + '. Material de terceiros/próprio, subempreitada, isentas e sociedade uniprofissional saem ZERO '
            + 'porque o app não tem esse dado — confira antes de transmitir. O B020/B025 (um por documento) '
            + 'NÃO é gerado: o único arquivo aceito na mão é sem movimento, e leiaute deduzido não entra. '
            + 'Se o PVA cobrar, mande o arquivo aceito com prestação de serviço.',
        );
    }
    if (a.semValor > 0) {
        avisos.push(
            `Bloco B (ISS do DF): ${a.semValor} NFS-e prestada(s) sem valor legível ficaram FORA do B470 — `
            + 'o total das prestações está a MENOR. Reimporte o documento (♻️) antes de transmitir.',
        );
    }
    return avisos;
}

/**
 * Bloco B do arquivo.
 *
 * Fora do DF: `B001|1` + `B990|2` (Guia). No DF: `B001|0` + `B470` + `B990|3`.
 * Lê `dados.blocoB` quando o orquestrador já apurou (e já avisou); sem ele,
 * apura aqui — a régua é a MESMA, um dono só.
 */
export function buildBlocoB(dados = {}) {
    const uf = dados?.empresa?.dadosFiscais?.uf ?? dados?.empresa?.uf ?? '';
    if (!blocoBAplicaNaUf(uf)) {
        return [
            fmt.buildLine(['B001', '1']),   // 1 = bloco SEM dados (Guia: só abertura e encerramento)
            fmt.buildLine(['B990', '2']),
        ];
    }
    const apuracao = dados.blocoB || apurarIssBlocoB({ notas: dados.notas, empresaCnpj: dados?.empresa?.cnpj });
    const v = apuracao.valores;
    const linhas = [
        fmt.buildLine(['B001', '0']),   // 0 = bloco COM dados (o B470 é o filho obrigatório no DF)
        fmt.buildLine(['B470', ...CAMPOS_B470.map((c) => fmt.formatValue(v[c]))]),
    ];
    linhas.push(fmt.buildLine(['B990', String(linhas.length + 1)]));
    return linhas;
}
