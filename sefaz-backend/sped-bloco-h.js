// ============================================================================
// sefaz-backend/sped-bloco-h.js  (PURO — testável)
// ----------------------------------------------------------------------------
// Decide o que o Bloco H (Inventário Físico) pode declarar — e o que ele NÃO
// pode inventar.
//
// O QUE ESTAVA ERRADO (achado 06/08): o gerador montava H010 pra TODOS os itens
// do 0200 com `qtdInventario` e `vlUnitInventario` default ZERO — e não existe
// UM lugar no app inteiro que grave esses campos (`grep` em todo o repo: zero
// ocorrências fora do próprio gerador). Ou seja: em dezembro, ou com a flag
// `gerarInventario` ligada, o CFI produzia um INVENTÁRIO INTEIRO ZERADO,
// estruturalmente válido, que o PVA aceita e a fiscalização lê como "a empresa
// declarou que não tinha estoque em 31/12". Ninguém gerou bloco H ainda — a
// mesma sorte do IPI que estava em E200/E210 (04/08).
//
// A REGRA QUE MANDA (Paulo, 06/08): falta de informação ACENDE ALERTA e alguém
// arruma. Ela nunca vira zero. Inventário é contagem física do cliente: não sai
// das notas, não se estima do histórico de compras, não se deduz. Sem contagem
// informada, o bloco sai VAZIO e o gerador GRITA — porque bloco vazio é
// "não declarei", e zerado é "declarei que não tenho", e a segunda é mentira.
//
// LEIAUTE: H005 = REG|DT_INV|VL_INV|MOT_INV. O gerador antigo punha
// VL_AJ_PERDA/VL_AJ_GANHO no lugar do VL_INV — e computava o total do
// inventário numa variável que DESCARTAVA no fim (prova de que o campo é o
// total). Como a doc oficial é bloqueada pela rede do ambiente, vale o mesmo
// tratamento do ST/IPI: os testes travam a estrutura e o arquivo PRECISA passar
// pelo PVA antes de transmitir.
// ============================================================================

/** Motivos válidos do inventário (MOT_INV) — código fora da lista não se inventa. */
export const MOTIVOS_INVENTARIO = ['01', '02', '03', '04', '05', '06'];

const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
};

/** O item tem contagem INFORMADA? Zero informado é diferente de não informado. */
export function inventarioInformado(item) {
    const q = item?.qtdInventario;
    const v = item?.vlUnitInventario;
    const preenchido = (x) => x !== undefined && x !== null && x !== '' && Number.isFinite(Number(x));
    // Quantidade é o que define a contagem. Item contado com quantidade 0
    // (produto que zerou no estoque) É uma informação legítima — o que não
    // vale é a AUSÊNCIA virar zero.
    return preenchido(q) && preenchido(v);
}

/**
 * Decide se e como o Bloco H sai.
 *
 * @param {object} p
 * @param {Array}  p.itens        itens do 0200
 * @param {boolean} p.exigido     dezembro ou flag gerarInventario
 * @param {string} [p.motInv]     MOT_INV do cadastro
 */
export function planejarBlocoH({ itens, exigido, motInv } = {}) {
    const lista = itens || [];
    const avisos = [];

    if (!exigido) {
        return { gerar: false, itens: [], valorTotal: 0, motInv: null, avisos, motivo: 'Competência não exige inventário.' };
    }

    if (lista.length === 0) {
        avisos.push('Inventário exigido nesta competência, mas a empresa não tem itens cadastrados (0200) — o bloco sai vazio.');
        return { gerar: false, itens: [], valorTotal: 0, motInv: null, avisos, motivo: 'Sem itens cadastrados.' };
    }

    const informados = lista.filter(inventarioInformado);
    const semContagem = lista.length - informados.length;

    // NENHUM item contado: o bloco NÃO sai. Sair zerado seria declarar estoque
    // zero — informação falsa que o PVA aceita sem reclamar.
    if (informados.length === 0) {
        avisos.push(
            `INVENTÁRIO NÃO INFORMADO: nenhum dos ${lista.length} itens tem quantidade e valor unitário de inventário. `
            + 'O bloco H sai VAZIO de propósito — preenchê-lo com zero declararia ao Fisco que a empresa não tinha estoque. '
            + 'Informe a contagem física em SPED Fiscal → aba 📦 Inventário (Bloco H) antes de transmitir.',
        );
        return { gerar: false, itens: [], valorTotal: 0, motInv: null, avisos, motivo: 'Contagem não informada.' };
    }

    // Contagem PARCIAL: sai só o que foi contado, e o que ficou de fora é dito.
    // Completar com zero seria a mesma mentira, item a item.
    if (semContagem > 0) {
        avisos.push(
            `${semContagem} de ${lista.length} item(ns) sem contagem informada ficaram FORA do inventário — `
            + 'não foram zerados. Confirme se eles realmente não estavam em estoque ou complete a contagem.',
        );
    }

    const codigo = String(motInv || '01').padStart(2, '0');
    if (!MOTIVOS_INVENTARIO.includes(codigo)) {
        avisos.push(
            `Motivo do inventário "${motInv}" não é um MOT_INV válido (${MOTIVOS_INVENTARIO.join(', ')}) — `
            + 'o bloco não sai. Corrija o cadastro; código de leiaute não se inventa.',
        );
        return { gerar: false, itens: [], valorTotal: 0, motInv: null, avisos, motivo: 'MOT_INV inválido.' };
    }

    const itensH010 = informados.map((it) => {
        const qtd = n(it.qtdInventario);
        const vlUnit = n(it.vlUnitInventario);
        const indProp = String(it.indPropInventario || '0');
        return {
            codItem: it.codItem,
            // SEM default: inventar a unidade do inventário muda a leitura da
            // QUANTIDADE (a decisão está em sped-selecao-documentos.js). Vazio
            // sai vazio, e o PVA acusa — CX contado como UN ele não acusa.
            unidade: it.unidade || '',
            qtd,
            vlUnit,
            vlItem: Math.round(qtd * vlUnit * 100) / 100,
            indProp,
            // COD_PART é obrigatório quando o bem não é do informante.
            codPart: indProp !== '0' ? (it.codPartInventario || '') : '',
            txtCompl: it.txtComplInventario || '',
            codCta: it.codCtaInventario || '',
            vlItemIr: it.vlItemIr ?? '',
        };
    });

    for (const it of itensH010) {
        if (it.indProp !== '0' && !it.codPart) {
            avisos.push(
                `Item ${it.codItem}: estoque em poder de/pertencente a terceiro (IND_PROP ${it.indProp}) exige o `
                + 'participante (COD_PART) — informe o participante ou corrija o tipo de propriedade.',
            );
        }
    }

    const valorTotal = Math.round(itensH010.reduce((t, i) => t + i.vlItem, 0) * 100) / 100;

    return { gerar: true, itens: itensH010, valorTotal, motInv: codigo, avisos, motivo: null };
}

/**
 * Data do inventário: último dia da competência final.
 * @param {string} competenciaFim 'AAAA-MM'
 */
export function dataInventario(competenciaFim) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(competenciaFim || ''));
    if (!m) return '';
    const ano = Number(m[1]);
    const mes = Number(m[2]);
    if (mes < 1 || mes > 12) return '';
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return `${m[1]}-${m[2]}-${String(ultimo).padStart(2, '0')}`;
}

/** O inventário é exigido nesta competência? */
export function inventarioExigido({ competenciaFim, gerarInventario } = {}) {
    return String(competenciaFim || '').endsWith('-12') || !!gerarInventario;
}
