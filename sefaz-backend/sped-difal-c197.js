// ============================================================================
// sefaz-backend/sped-difal-c197.js  (PURO — testável)
// ----------------------------------------------------------------------------
// DIFAL de aquisição no bloco C da EFD ICMS/IPI — registros C195/C197.
//
// Fecha a lacuna que o Paulo apontou no F0 (03/08): "DIFAL de aquisição EXISTE
// — clientes compram de fora e pagam". A fase 1 (consolidado do Simples) e a
// fase 2 (426-A por documento) já estão no ar; falta a ESCRITURAÇÃO do débito
// no arquivo do Lucro, que é POR DOCUMENTO:
//
//   C195 — observação do lançamento fiscal (aponta pro 0460)
//   C197 — o ajuste em si (base, alíquota e valor do DIFAL daquela nota)
//
// O DÉBITO NA APURAÇÃO NÃO SAI DAQUI: ele entra no E110 pela aba Ajustes E111
// (o C197 é a origem documental, não a conta). Escriturar nos dois lugares
// sem o E111 correspondente deixa o E110 sem o débito; por isso o resultado
// devolve `totalDifal` pra tela conferir contra o ajuste lançado.
//
// REGRA QUE NÃO PODE CAIR — o COD_AJ da tabela 5.3 é ESTADUAL e não se
// inventa (mesma regra do código de receita da GNRE no E250 e do código de
// tributo do MIT). Sem o código cadastrado, o C197 NÃO é gerado: vira aviso
// com a ação. Um código errado o PVA aceita e o Fisco glosa depois.
//
// ATENÇÃO AO LEIAUTE: o Guia Prático é inacessível deste ambiente. A ordem dos
// campos vem do leiaute conhecido e PRECISA passar pelo PVA antes de ir a
// cliente — igual ao G125 e ao bloco de ST. Os testes travam a estrutura.
// ============================================================================

import { ufEmitente, cfopNaOticaDeEntrada } from './participante-doc-helper.js';
// Régua única do cancelamento (status + cStat + evento 110111) e da direção.
import { docCancelado, direcaoEfetivaDoc } from './xml-metadata-helper.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const CANCELADOS = new Set(['cancelado', 'cancelada', 'denegado', 'denegada', 'inutilizado']);

/**
 * CFOPs de entrada interestadual que geram DIFAL de aquisição: material de
 * uso/consumo e ativo imobilizado. Mercadoria para REVENDA (2102/2403…) não
 * entra — nessa o imposto é o da própria operação (ou a antecipação do 426-A,
 * que é outro trilho).
 */
export const CFOPS_DIFAL_AQUISICAO = new Set([
    '2551', // compra de bem para o ativo imobilizado
    '2552', // transferência de bem do ativo
    '2555', // bem do ativo recebido de terceiro
    '2556', // compra de material para uso ou consumo
    '2557', // transferência de material de uso ou consumo
]);

/** UFs cuja saída para SP/Sul-Sudeste é 12%; demais, 7%. */
const UF_INTER_12 = new Set(['SP', 'RJ', 'MG', 'RS', 'SC', 'PR']);
const ORIG_4PCT = new Set(['1', '2', '3', '8']);

// O XML traz o CFOP do EMITENTE (venda interestadual = 6xxx); pra quem
// RECEBE, a mesma operação é 2xxx. Comparar direto com o CFOP do XML não
// acha nada — foi o que escondeu a NF 110497 (6101) do painel de DIFAL.
const cfopDoItem = (item) => cfopNaOticaDeEntrada(item?.cfop);

/** A nota é entrada interestadual com pelo menos um item de uso/consumo ou ativo? */
export function notaGeraDifalAquisicao(nota, ufEmpresa) {
    if (!nota) return false;
    if (direcaoEfetivaDoc(nota) !== 'entrada') return false;
    // O campo cru mente no cancelamento por evento; o `situacao` derivado
    // continua honrado para quem já vem classificado.
    if (docCancelado(nota)) return false;
    if (CANCELADOS.has(String(nota.situacao || nota.status || '').toLowerCase())) return false;

    const ufOrigem = ufEmitente(nota);
    const ufDestino = String(ufEmpresa || '').toUpperCase();
    if (!ufOrigem || !ufDestino || ufOrigem === ufDestino) return false;

    return (nota.itens || []).some((i) => CFOPS_DIFAL_AQUISICAO.has(cfopDoItem(i)));
}

/** Alíquota interestadual do item: a destacada vence; senão deriva da UF/origem. */
export function aliqInterestadual(item, ufOrigem) {
    const destacada = num(item?.aliqIcms) || num(item?.pICMS);
    if (destacada > 0) return { aliq: destacada, derivada: false };
    if (ORIG_4PCT.has(String(item?.orig ?? ''))) return { aliq: 4, derivada: true };
    return { aliq: UF_INTER_12.has(String(ufOrigem || '').toUpperCase()) ? 12 : 7, derivada: true };
}

/**
 * DIFAL de UMA nota: só os itens de uso/consumo e ativo entram na base.
 *
 * @param {object} nota
 * @param {object} p
 * @param {number} p.aliqInterna       alíquota interna do destino (editável)
 * @param {string} p.ufEmpresa
 * @returns {{base:number, difal:number, aliqInterna:number, itens:number,
 *            aliqInterDerivada:boolean, aliqInterMedia:number}}
 */
export function calcularDifalDaNota(nota, { aliqInterna, ufEmpresa }) {
    const ufOrigem = ufEmitente(nota);
    let base = 0;
    let difal = 0;
    let itens = 0;
    let derivada = false;
    let somaInter = 0;

    for (const item of (nota?.itens || [])) {
        if (!CFOPS_DIFAL_AQUISICAO.has(cfopDoItem(item))) continue;
        // Base do DIFAL = valor da operação daquele item (o que foi cobrado).
        const vItem = num(item?.vBC) || num(item?.vProd);
        if (vItem <= 0) continue;

        const { aliq: inter, derivada: dv } = aliqInterestadual(item, ufOrigem);
        const diff = num(aliqInterna) - inter;

        itens += 1;
        somaInter += inter;
        derivada = derivada || dv;
        base = r2(base + vItem);
        // Diferença negativa (interna menor que a interestadual) NÃO vira
        // crédito automático — não há DIFAL a recolher nessa operação.
        if (diff > 0) difal = r2(difal + (vItem * diff) / 100);
    }

    return {
        base,
        difal,
        itens,
        aliqInterna: num(aliqInterna),
        aliqInterDerivada: derivada,
        aliqInterMedia: itens > 0 ? r2(somaInter / itens) : 0,
    };
}

const dec = (n, casas = 2) => (Number.isFinite(Number(n)) ? Number(n) : 0)
    .toFixed(casas).replace('.', ',');

/**
 * Monta C195 + C197 das notas com DIFAL de aquisição.
 *
 * @param {object} p
 * @param {Array}  p.notas
 * @param {string} p.ufEmpresa
 * @param {number} [p.aliqInternaPadrao]  default 18 (SP). EDITÁVEL por nota.
 * @param {object} [p.aliqInternaPorChave] { chave: aliquota } — sobrescreve.
 * @param {string} [p.codigoAjuste]       COD_AJ da tabela 5.3 do estado.
 * @param {string} [p.codObservacao]      COD_OBS do registro 0460 (opcional).
 * @returns {{porNota: object[], linhasPorChave: object, avisos: string[], totalDifal: number}}
 */
export function montarC197Difal({
    notas, ufEmpresa, aliqInternaPadrao = 18, aliqInternaPorChave = {},
    codigoAjuste = '', codObservacao = '',
}) {
    const avisos = [];
    const porNota = [];
    const linhasPorChave = {};
    let totalDifal = 0;

    const candidatas = (notas || []).filter((n) => notaGeraDifalAquisicao(n, ufEmpresa));
    if (candidatas.length === 0) return { porNota, linhasPorChave, avisos, totalDifal: 0 };

    const temCodigo = !!String(codigoAjuste || '').trim();

    for (const nota of candidatas) {
        const chave = String(nota.chave || nota.id || '');
        const aliqInterna = num(aliqInternaPorChave[chave]) || num(aliqInternaPadrao);
        const calc = calcularDifalDaNota(nota, { aliqInterna, ufEmpresa });
        if (calc.difal <= 0) continue;

        totalDifal = r2(totalDifal + calc.difal);
        porNota.push({ chave, numero: String(nota.numero || ''), ...calc });

        if (!temCodigo) continue;

        const linhas = [];
        if (codObservacao) {
            linhas.push(['C195', codObservacao, 'DIFAL aquisicao interestadual', ''].join('|'));
        }
        linhas.push([
            'C197',
            String(codigoAjuste).trim(),      // COD_AJ (tabela 5.3 do estado)
            'DIFAL aquisicao interestadual',  // DESCR_COMPL_AJ
            '',                               // COD_ITEM (ajuste do documento, não do item)
            dec(calc.base),                   // VL_BC_ICMS
            dec(aliqInterna),                 // ALIQ_ICMS
            dec(calc.difal),                  // VL_ICMS
            dec(0),                           // VL_OUTROS
            '',
        ].join('|'));
        linhasPorChave[chave] = linhas;
    }

    if (porNota.length === 0) return { porNota, linhasPorChave, avisos, totalDifal: 0 };

    if (!temCodigo) {
        avisos.push(
            `${porNota.length} nota(s) de entrada interestadual geram DIFAL de aquisição `
            + `(R$ ${dec(totalDifal)}), mas o C197 não foi gerado — falta o código de ajuste `
            + '(tabela 5.3 do seu estado) no cadastro. Informe-o ou lance o ajuste no PVA. '
            + 'Código de ajuste não se inventa: errado, o PVA aceita e o Fisco glosa depois.',
        );
    }

    if (porNota.some((n) => n.aliqInterDerivada)) {
        avisos.push(
            'Em pelo menos uma nota a alíquota interestadual não estava destacada no item e foi '
            + 'DERIVADA da UF de origem/procedência. Confira antes de transmitir.',
        );
    }

    avisos.push(
        `DIFAL de aquisição escriturado: R$ ${dec(totalDifal)}. O DÉBITO na apuração não vem do `
        + 'C197 — lance o ajuste correspondente na aba "Ajustes E111" para que ele entre no E110.',
    );

    return { porNota, linhasPorChave, avisos, totalDifal };
}
