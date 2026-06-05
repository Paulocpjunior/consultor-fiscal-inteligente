// ============================================================================
// sped-contrib-recuperacao.js  (PURO)
//
// Analise de RECUPERACAO de creditos PIS/COFINS no regime MONOFASICO — o que
// o e-Auditoria vende como "recuperacao de creditos". Detecta itens onde a
// empresa pode ter PAGO PIS/COFINS indevidamente sobre produto monofasico
// (que ja foi tributado na origem — fabricante/importador).
//
// Regra do monofasico (Leis 10.147/2000, 10.485/2002, 10.560/2002,
// 10.833/2003, 13.097/2015): em produtos monofasicos, PIS/COFINS sao cobrados
// UMA vez na industria/importador. O REVENDEDOR deve usar CST 04 (monofasica)
// ou 06 (aliquota zero) na SAIDA — NAO paga de novo. Se usou CST 01/02
// (tributavel), PAGOU INDEVIDO -> credito recuperavel.
//
// CONSERVADOR: lista so as familias de NCM monofasicas de ALTA confianca
// (combustivel, farma, cosmetico, bebida fria, pneu). Autopecas (8708) ficam
// FORA da v1 — sao nuancadas (so parte do Anexo II e monofasica) e dariam
// falso-positivo. Cada achado e POTENCIAL: o contador confirma se a empresa
// e revendedora (e nao industria/importadora, que DEVE tributar).
//
// Calibrado contra arquivo real (industria de plasticos, NCM 3901/3902 —
// NAO monofasico): da ~0 achados, sem falso-positivo.
// ============================================================================

// Prefixos de NCM monofasicos de alta confianca. Match por prefixo (startsWith).
const NCM_MONOFASICO_PREFIXOS = [
    // Combustiveis (Lei 9.718/98, 10.336/01) — monofasico/CIDE
    '2710', // derivados de petroleo (gasolina, diesel, oleos)
    '2207', // alcool etilico (etanol combustivel)
    '2711', // gases de petroleo (GLP) — uso combustivel
    // Farmaceuticos e cosmeticos (Lei 10.147/2000)
    '3001', '3002', '3003', '3004', '3005', '3006', // medicamentos
    '3303', '3304', '3305', '3306', '3307',          // perfumaria/cosmeticos
    '3401',                                           // sabonetes/dentifricios (parte)
    '9603',                                           // escovas de dente (parte)
    // Bebidas frias (Lei 13.097/2015)
    '2201', '2202', '2203',                           // aguas, refrigerantes, cerveja
    '2106',                                           // preparacoes p/ bebidas (parte: 2106.90.10)
    // Pneus e cameras (Lei 10.485/2002)
    '4011', '4013',
];

function ehNcmMonofasico(ncm) {
    const n = String(ncm || '').replace(/\D/g, '');
    if (n.length < 4) return false;
    return NCM_MONOFASICO_PREFIXOS.some(pref => n.startsWith(pref));
}

// CST PIS/COFINS de SAIDA TRIBUTADA (onde o monofasico revendedor NAO deveria
// estar — deveria ser 04 monofasica ou 06 aliquota zero).
const CST_TRIBUTADO_SAIDA = new Set(['01', '02']);

function num(v) {
    if (v == null || v === '') return 0;
    const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {{ tipoSped:string, linhas: Array<{idx:number,tipo:string,campos:string[]}> }} parsed
 * @returns {{
 *   aplicavel: boolean,
 *   itens: Array<{idx:number, numItem:string, codItem:string, ncm:string, cstPis:string, cstCofins:string, vlPis:number, vlCofins:number}>,
 *   totalPis:number, totalCofins:number, total:number,
 *   resumo: { qtdItens:number, motivo?:string }
 * }}
 */
export function analisarRecuperacaoMonofasico(parsed) {
    const linhas = (parsed && parsed.linhas) || [];
    if (parsed && parsed.tipoSped && parsed.tipoSped !== 'contribuicoes') {
        return { aplicavel: false, itens: [], totalPis: 0, totalCofins: 0, total: 0,
            resumo: { qtdItens: 0, motivo: 'Analise so se aplica a EFD Contribuicoes.' } };
    }

    // Mapa COD_ITEM -> NCM (do 0200).
    const ncmPorItem = new Map();
    for (const l of linhas) {
        if (l.tipo === '0200') ncmPorItem.set(l.campos[1], l.campos[7]);
    }

    // Layout contrib C170 (= Fiscal sem VL_ABAT_NT): data fields 1-based.
    // CST_PIS = 24, VL_PIS = 29, CST_COFINS = 30, VL_COFINS = 35.
    // campos[] e 0-based com campos[0]=tipo, entao data field N = campos[N].
    const itens = [];
    let totalPis = 0, totalCofins = 0;

    for (const l of linhas) {
        if (l.tipo !== 'C170') continue;
        const c = l.campos;
        const codItem = c[2];
        const ncm = ncmPorItem.get(codItem) || '';
        if (!ehNcmMonofasico(ncm)) continue;

        const cstPis = String(c[24] || '');
        const cstCofins = String(c[30] || '');
        const vlPis = num(c[29]);
        const vlCofins = num(c[35]);

        const pisIndevido = CST_TRIBUTADO_SAIDA.has(cstPis) && vlPis > 0;
        const cofinsIndevido = CST_TRIBUTADO_SAIDA.has(cstCofins) && vlCofins > 0;
        if (!pisIndevido && !cofinsIndevido) continue;

        const itemPis = pisIndevido ? vlPis : 0;
        const itemCofins = cofinsIndevido ? vlCofins : 0;
        totalPis += itemPis;
        totalCofins += itemCofins;
        itens.push({
            idx: l.idx, numItem: c[1], codItem, ncm,
            cstPis, cstCofins,
            vlPis: itemPis, vlCofins: itemCofins,
        });
    }

    totalPis = round2(totalPis);
    totalCofins = round2(totalCofins);
    return {
        aplicavel: true,
        itens,
        totalPis, totalCofins, total: round2(totalPis + totalCofins),
        resumo: {
            qtdItens: itens.length,
            motivo: itens.length === 0
                ? 'Nenhum item monofasico com CST tributado encontrado.'
                : 'POTENCIAL: confirme se a empresa e REVENDEDORA (nao industria/importadora). '
                + 'Se for revenda, esses PIS/COFINS foram pagos indevido (CST deveria ser 04/06) e sao recuperaveis.',
        },
    };
}

export const _ncmMonofasicoPrefixos = NCM_MONOFASICO_PREFIXOS;
export { ehNcmMonofasico };
