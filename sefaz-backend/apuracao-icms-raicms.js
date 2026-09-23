// ============================================================================
// sefaz-backend/apuracao-icms-raicms.js  (PURO — testável)
//
// 📒 O REGISTRO DE APURAÇÃO DO ICMS (RAICMS, modelo do e-Fiscal) SEM GERAR O
// SPED — e o E110 do arquivo SAINDO DA MESMA APURAÇÃO.
//
// 14/09, Paulo, HYPE CAFÉ · Lucro Presumido · 08/2026, com o print do
// "Registro de Apuração do ICMS" do e-Fiscal: *"crie um relatório conforme
// modelo acima, porque por exemplo, o valor de difal só aparece lá no ajuste
// E111, ou eu tenho que gerar o SPED para conferir o valor do ICMS a pagar ou
// credor"*.
//
// MEDIDO: a apuração (débito das saídas, crédito das entradas, os E111 —
// inclusive o par do DIFAL art. 117 —, o saldo credor anterior, as deduções e
// o saldo devedor/credor) só existia DENTRO do `buildBlocoE`, a caminho do
// E110. Quem quisesse o número tinha de gerar o arquivo e ler a linha.
//
// ✂️ ESTE MÓDULO É O DONO DA APURAÇÃO DO ICMS PRÓPRIO:
//   · `apurarIcmsProprio(dados)` — a conta, UMA vez. O bloco E lê daqui para
//     escrever o E110; o relatório lê daqui para imprimir o RAICMS. Duas
//     contas fariam a tela prometer um imposto e o arquivo declarar outro —
//     a divergência que esta casa mais paga (regra de 12/08: relatório NUNCA
//     tem conta própria).
//   · `montarRaicms(...)` — as 14 linhas do modelo do e-Fiscal (Históricos ·
//     Coluna Auxiliar · Somas), com cada ajuste E111 nomeado no histórico da
//     linha 002/003/006/007/012, como o e-Fiscal imprime "Artigo 117, II do
//     RICMS/00" ao lado de 32,09.
//
// 📖 AS CONTAS SÃO AS DO GUIA PRÁTICO (E110), não deste módulo: quem soma os
// débitos e créditos é `somarIcmsNoArquivo` (bloco C — a mesma soma dos
// C190) e quem fecha o saldo é `aplicarAjustesApuracao` (o dono do E111).
// Aqui não se soma nada por conta própria: as linhas 004, 008, 010 são
// somas de linhas já calculadas, e o teste prova que fecham com o E110.
// ============================================================================

import { classificarAjustes, aplicarAjustesApuracao } from './sped-ajustes-apuracao.js';
import { somarIcmsNoArquivo } from './sped-fiscal-blocoC.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * A apuração do ICMS próprio do período — a MESMA que vira o E110.
 *
 * @param {object} dados  o contexto do arquivo (o que `coletarDadosEmpresa`
 *   devolve): `empresa._regime`, `empresa.dadosFiscais.uf`, `notas`,
 *   `ajustesApuracao` (E111 lançados + par do DIFAL art. 117),
 *   `saldoCredorIcmsAnterior`, `origemSaldoIcms`, `regimeEscrituracao`.
 * @returns {{ ap: object, cls: object, uf: string, regime: string }}
 *   `ap` é o objeto de `aplicarAjustesApuracao` (os campos do E110);
 *   `cls` é a classificação dos ajustes (válidos com tipo + erros).
 */
export function apurarIcmsProprio(dados) {
    const regime = dados?.empresa?._regime;
    const uf = String(dados?.empresa?.dadosFiscais?.uf || '').toUpperCase();
    const cls = classificarAjustes(regime === 'lucro' ? (dados?.ajustesApuracao || []) : [], uf);
    let ap = {
        vlTotDebitos: 0, vlTotAjDebitos: 0, vlEstornosCred: 0,
        vlTotCreditos: 0, vlTotAjCreditos: 0, vlEstornosDeb: 0,
        vlSldCredorAnt: 0, vlSldApurado: 0, vlTotDed: 0,
        vlIcmsRecolher: 0, vlSldCredorTransportar: 0, vlDebEsp: 0,
        deducaoExcedente: 0,
    };
    if (regime === 'lucro') {
        ap = aplicarAjustesApuracao({
            // O contexto (`dados`) é OBRIGATÓRIO: é ele que zera o crédito que
            // o C190 zera (regime/CST informado) — registro `consumidoresMedidos`.
            vlTotDebitos: somarIcmsNoArquivo(dados.notas, 'saida', dados),
            vlTotCreditos: somarIcmsNoArquivo(dados.notas, 'entrada', dados),
            vlSldCredorAnt: parseFloat(dados.saldoCredorIcmsAnterior || 0),
        }, cls);
    }
    return { ap, cls, uf, regime };
}

/** Rótulos do modelo do e-Fiscal (Registro de Apuração do ICMS, RICMS/SP). */
export const HISTORICOS_RAICMS = {
    '001': 'Por Saídas/Prestações com Débito do Imposto',
    '002': 'Outros Débitos',
    '003': 'Estornos de Crédito',
    '004': 'Total (001+002+003)',
    '005': 'Por Entradas/Aquisições com Crédito do Imposto',
    '006': 'Outros Créditos',
    '007': 'Estornos de Débito',
    '008': 'Subtotal (005+006+007)',
    '009': 'Saldo Credor do Período Anterior',
    '010': 'Total (008+009)',
    '011': 'Saldo Devedor (Débito − Crédito)',
    '012': 'Deduções',
    '013': 'Imposto a Recolher',
    '014': 'Saldo Credor (Crédito − Débito) a Transportar para o Período Seguinte',
};

/** Que linha do RAICMS recebe cada TIPO de E111 (4º caractere do código). */
const LINHA_DO_TIPO = { 0: '002', 1: '003', 2: '006', 3: '007', 4: '012' };

/** O histórico de um ajuste: a descrição lançada, ou o código quando ela falta. */
export function historicoDoAjuste(a) {
    const d = String(a?.descricao || '').trim();
    return d || String(a?.codigo || '').trim().toUpperCase();
}

/**
 * As 14 linhas do Registro de Apuração do ICMS a partir da apuração.
 *
 * Cada linha: `{ codigo, historico, itens: [{ historico, codigo, valor }], soma }`.
 * `itens` é a COLUNA AUXILIAR — um item por ajuste E111 válido daquela
 * linha (é onde o "Artigo 117, II do RICMS/00 · 32,09" aparece). Linha sem
 * itens sai com `itens: []`; o e-Fiscal imprime vazio, não zero, e o leitor
 * decide como mostrar.
 *
 * @param {{ ap: object, cls: object }} apuracao  o retorno de `apurarIcmsProprio`.
 * @param {{ origemSaldoAnterior?: string }} [extra]
 */
export function montarRaicms({ ap, cls }, extra = {}) {
    const itensDo = (linha) => (cls?.validos || [])
        .filter((a) => LINHA_DO_TIPO[a.tipo] === linha)
        .map((a) => ({ historico: historicoDoAjuste(a), codigo: a.codigo, valor: r2(a.valor) }));

    const l = (codigo, soma, itens = []) => ({
        codigo, historico: HISTORICOS_RAICMS[codigo], itens, soma: r2(soma),
    });

    const totalDebito = r2(ap.vlTotDebitos + ap.vlTotAjDebitos + ap.vlEstornosCred);
    const subtotalCredito = r2(ap.vlTotCreditos + ap.vlTotAjCreditos + ap.vlEstornosDeb);
    const totalCredito = r2(subtotalCredito + ap.vlSldCredorAnt);

    const linhas = [
        l('001', ap.vlTotDebitos),
        l('002', ap.vlTotAjDebitos, itensDo('002')),
        l('003', ap.vlEstornosCred, itensDo('003')),
        l('004', totalDebito),
        l('005', ap.vlTotCreditos),
        l('006', ap.vlTotAjCreditos, itensDo('006')),
        l('007', ap.vlEstornosDeb, itensDo('007')),
        l('008', subtotalCredito),
        l('009', ap.vlSldCredorAnt),
        l('010', totalCredito),
        l('011', ap.vlSldApurado),
        l('012', ap.vlTotDed, itensDo('012')),
        l('013', ap.vlIcmsRecolher),
        l('014', ap.vlSldCredorTransportar),
    ];

    // A conta do Guia, dita para quem confere: 011 = 004 − 010 quando devedor;
    // 014 = 010 − 004 quando credor. É a R17 da prevalidação, aqui na tela.
    const devedor = r2(totalDebito - totalCredito) >= 0;

    const avisos = [];
    for (const e of cls?.erros || []) avisos.push(`Ajuste E111 IGNORADO (não entra na apuração nem no arquivo): ${e}`);
    if (ap.deducaoExcedente > 0) {
        avisos.push(
            `Dedução de ${ap.deducaoExcedente.toFixed(2)} NÃO abateu nada: dedução só reduz saldo DEVEDOR e o `
            + 'excedente não vira crédito (Guia Prático, E110 c.12).',
        );
    }
    if (ap.vlDebEsp > 0) {
        avisos.push(
            `Débitos especiais (E111 tipo 5) de ${ap.vlDebEsp.toFixed(2)} ficam FORA desta apuração — `
            + 'saem no E110 c.15 (DEB_ESP) e não entram no Imposto a Recolher da linha 013.',
        );
    }
    const itensAjuste = linhas.reduce((s, x) => s + x.itens.length, 0);
    if (itensAjuste === 0 && (ap.vlTotDebitos > 0 || ap.vlTotCreditos > 0)) {
        avisos.push('Nenhum ajuste E111 nesta competência — as linhas 002/003/006/007/012 saem vazias. '
            + 'Se há DIFAL de aquisição (art. 117) ou outro ajuste a lançar, é na aba Ajustes E111 do card SPED Fiscal.');
    }

    return {
        linhas,
        devedor,
        impostoARecolher: ap.vlIcmsRecolher,
        saldoCredorATransportar: ap.vlSldCredorTransportar,
        debitosEspeciais: ap.vlDebEsp,
        origemSaldoAnterior: extra.origemSaldoAnterior || '',
        avisos,
    };
}
