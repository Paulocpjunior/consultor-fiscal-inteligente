// ============================================================================
// dctfweb-retencao-normalizer.js  (PURO — sem io/firebase, testavel)
//
// Normaliza a RETENCAO consolidada na DCTFWeb (Geral Mensal) num shape estavel
// { retencoes: {INSS, IRRF, CSLL, PIS, COFINS}, ... } pra cruzar contra a
// EFD-Reinf (que ALIMENTA a DCTFWeb). Divergencia = evento Reinf que nao chegou.
//
// HONESTIDADE sobre o shape (mesma postura do dctfweb-mit-normalizer):
//   O SERPRO entrega a declaracao DCTFWeb via CONSXMLDECLARACAO como XML. NAO
//   temos um XML real DESSE servico em maos pra fixar os nomes EXATOS das tags
//   de retencao. Por isso este normalizador e DEFENSIVO:
//     - aceita XML (string) OU objeto ja parseado;
//     - soma SO tags de uma ALLOWLIST de retencao (nunca inventa valor);
//     - reporta `camposUsados` (transparencia: o que de fato somou);
//     - se NAO achar nenhuma tag de retencao conhecida, retorna { lido:false,
//       motivo } — NUNCA zeros falsos (que virariam divergencia fake).
//   O serpro-smoke (CONSXMLDECLARACAO) captura o XML real pra confirmar/ampliar
//   a allowlist. Calibrado = quando bater contra arquivo real.
//
// Namespace-agnostico: varre por localName. Funciona com ns default OU prefixo.
// ============================================================================

import { DOMParser } from '@xmldom/xmldom';

// Allowlist de tags de retencao -> familia. Nomes vindos do dominio EFD-Reinf/
// DCTFWeb (a DCTFWeb ingere os mesmos campos da Reinf). Conservador: so o que
// e claramente "valor retido". Ampliar com base no XML real do serpro-smoke.
const TAG_FAMILIA = {
    // INSS (previdenciaria) — R-2010/R-2020 consolidados
    vlrtotalretprinc: 'INSS',
    vlrtotalretadic: 'INSS',
    vlrretprinc: 'INSS',
    vlrretadic: 'INSS',
    inssretido: 'INSS',
    valorretidoinss: 'INSS',
    vlrcpretido: 'INSS',
    // IRRF / IR retido (serie R-4000)
    valorretidoir: 'IRRF',
    vlrirrf: 'IRRF',
    vlrretidoir: 'IRRF',
    // CSLL retida
    valorretidocsll: 'CSLL',
    vlrretidocsll: 'CSLL',
    // PIS retido
    valorretidopis: 'PIS',
    vlrretidopis: 'PIS',
    // COFINS retida
    valorretidocofins: 'COFINS',
    vlrretidocofins: 'COFINS',
};

const FAMILIAS = ['INSS', 'IRRF', 'CSLL', 'PIS', 'COFINS'];

function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    let s = String(v).trim();
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s.replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
}
const r2 = (n) => Math.round(n * 100) / 100;

function localName(node) {
    return (node.localName || String(node.nodeName || '').replace(/^.*:/, '')).toLowerCase();
}

// Coleta pares { tag(lowercase) -> [valoresTexto] } de todo o XML.
function coletarTagsXml(xml) {
    let doc;
    try {
        doc = new DOMParser({ onError: () => {} }).parseFromString(String(xml || ''), 'text/xml');
    } catch {
        return null;
    }
    if (!doc || !doc.documentElement) return null;
    const out = [];
    const fila = [doc.documentElement];
    while (fila.length) {
        const n = fila.shift();
        const filhos = Array.from(n.childNodes || []).filter((c) => c.nodeType === 1);
        // folha com texto: candidata a valor
        if (filhos.length === 0) {
            const txt = String(n.textContent || '').trim();
            if (txt) out.push({ tag: localName(n), valor: txt });
        }
        fila.push(...filhos);
    }
    return out;
}

// Coleta pares de um objeto JS (caso o provider ja devolva estrutura).
function coletarTagsObj(obj, acc = []) {
    if (!obj || typeof obj !== 'object') return acc;
    for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') coletarTagsObj(v, acc);
        else if (v != null && v !== '') acc.push({ tag: String(k).toLowerCase(), valor: v });
    }
    return acc;
}

/**
 * @param {string|object} entrada  XML (CONSXMLDECLARACAO) ou objeto parseado.
 * @returns {{
 *   lido: boolean, motivo: string|null,
 *   retencoes: {INSS:number,IRRF:number,CSLL:number,PIS:number,COFINS:number},
 *   camposUsados: Array<{tag:string, familia:string, valor:number}>,
 *   totalReconhecido: number
 * }}
 */
export function normalizarRetencaoDctfweb(entrada) {
    const vazio = { INSS: 0, IRRF: 0, CSLL: 0, PIS: 0, COFINS: 0 };
    if (entrada == null || entrada === '') {
        return { lido: false, motivo: 'Declaracao DCTFWeb ausente.', retencoes: { ...vazio }, camposUsados: [], totalReconhecido: 0 };
    }

    let pares = null;
    if (typeof entrada === 'string') {
        pares = coletarTagsXml(entrada);
        if (pares == null) {
            return { lido: false, motivo: 'XML da declaracao DCTFWeb ilegivel.', retencoes: { ...vazio }, camposUsados: [], totalReconhecido: 0 };
        }
    } else {
        pares = coletarTagsObj(entrada);
    }

    const retencoes = { ...vazio };
    const camposUsados = [];
    let total = 0;

    for (const { tag, valor } of pares) {
        const familia = TAG_FAMILIA[tag];
        if (!familia) continue;
        const v = num(valor);
        if (!v) continue;
        retencoes[familia] = r2(retencoes[familia] + v);
        total = r2(total + v);
        camposUsados.push({ tag, familia, valor: v });
    }

    if (camposUsados.length === 0) {
        return {
            lido: false,
            motivo: 'Nenhuma tag de retencao reconhecida na declaracao DCTFWeb. '
                + 'Shape diferente do esperado — rode o serpro-smoke (CONSXMLDECLARACAO) e amplie a allowlist.',
            retencoes: { ...vazio }, camposUsados: [], totalReconhecido: 0,
        };
    }

    return { lido: true, motivo: null, retencoes, camposUsados, totalReconhecido: total };
}

export const _internals = { num, TAG_FAMILIA, FAMILIAS };
