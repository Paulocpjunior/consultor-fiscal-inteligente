// ============================================================================
// sped-fiscal-c190-autofix.js  (PURO — testavel)
//
// AUTO-CORRECAO do totalizador C190 do SPED Fiscal (EFD ICMS/IPI).
//
// O C190 agrupa as linhas C170 do MESMO documento (mesmo C100 pai) por
// (CST_ICMS, CFOP, ALIQ_ICMS). VL_OPR/VL_BC_ICMS/VL_ICMS do C190 DEVEM ser a
// soma dos C170 daquela combinacao. Quando o contador edita um C170 a mao
// (corrige um VL_ITEM, por ex) e esquece de refazer o C190, o PVA rejeita.
//
// O validador (sped-fiscal-regras-tributarias.js R8) so APONTA a divergencia.
// Este modulo CORRIGE: recalcula os 3 valores do C190 a partir dos C170 e
// devolve a lista de edicoes (pro reconstruirSped) + a lista de AJUSTES
// (de/para por campo) pra exibir como aviso ao usuario.
//
// Conservador de proposito:
//  - So corrige C190 que JA EXISTE e cujo valor diverge alem da tolerancia.
//  - NAO cria C190 faltante (isso muda estrutura — fica como aviso do R8).
//  - So mexe nos 3 campos que o R8 valida (VL_OPR, VL_BC_ICMS, VL_ICMS).
//    Campos de ST/IPI/RED_BC ficam intactos (nao sao somados do C170 aqui).
//  - C170 e a FONTE DE VERDADE (item a item); C190 e derivado.
//
// Layout C190 (campos[N], 0-based onde [0]='C190'):
//   1=CST_ICMS 2=CFOP 3=ALIQ_ICMS 4=VL_OPR 5=VL_BC_ICMS 6=VL_ICMS ...
// Layout C170:
//   6=VL_ITEM 9=CST_ICMS 10=CFOP 12=VL_BC_ICMS 13=ALIQ_ICMS 14=VL_ICMS
// ============================================================================

const TOL = 0.02; // 2 centavos — mesmo do validador R8.

function num(v) {
    if (v == null || v === '') return 0;
    const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

function aliqNum(v) {
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

/** Formata valor numerico pra string SPED (virgula decimal, sem milhar, 2 casas). */
function fmtValor(n) {
    return Number(n).toFixed(2).replace('.', ',');
}

/**
 * @param {{ tipoSped?:string, linhas: Array<{idx:number,tipo:string,campos:string[]}> }} parsed
 * @returns {{
 *   edicoes: Array<{idx:number, campos:string[]}>,
 *   ajustes: Array<{registro:string, idx:number, doc:string, combinacao:string, campo:string, de:string, para:string, mensagem:string}>,
 *   resumo: { c190Corrigidos:number, camposAjustados:number }
 * }}
 */
export function corrigirC190(parsed) {
    const out = { edicoes: [], ajustes: [], resumo: { c190Corrigidos: 0, camposAjustados: 0 } };
    if (!parsed || !Array.isArray(parsed.linhas)) return out;
    // C190/C170 sao do EFD ICMS/IPI. Em Contribuicoes nao se aplica.
    if (parsed.tipoSped && parsed.tipoSped !== 'fiscal') return out;

    let docNum = null;
    let c170Por = null;   // Map<chave, {vlOpr, vlBc, vlIcms}>
    let c190Linhas = null; // Array<{idx, campos, chave}>

    const flush = () => {
        if (!c170Por || !c190Linhas) return;
        for (const c190 of c190Linhas) {
            const t170 = c170Por.get(c190.chave);
            if (!t170) continue; // C190 sem C170: caso do R8 (nao corrige aqui)

            const campos = c190.campos.slice();
            const atualOpr = num(campos[4]);
            const atualBc = num(campos[5]);
            const atualIcms = num(campos[6]);

            const mudancas = [];
            if (Math.abs(atualOpr - t170.vlOpr) > TOL) {
                mudancas.push({ campo: 'VL_OPR', de: campos[4], para: fmtValor(t170.vlOpr) });
                campos[4] = fmtValor(t170.vlOpr);
            }
            if (Math.abs(atualBc - t170.vlBc) > TOL) {
                mudancas.push({ campo: 'VL_BC_ICMS', de: campos[5], para: fmtValor(t170.vlBc) });
                campos[5] = fmtValor(t170.vlBc);
            }
            if (Math.abs(atualIcms - t170.vlIcms) > TOL) {
                mudancas.push({ campo: 'VL_ICMS', de: campos[6], para: fmtValor(t170.vlIcms) });
                campos[6] = fmtValor(t170.vlIcms);
            }

            if (mudancas.length > 0) {
                out.edicoes.push({ idx: c190.idx, campos });
                out.resumo.c190Corrigidos++;
                for (const m of mudancas) {
                    out.resumo.camposAjustados++;
                    out.ajustes.push({
                        registro: 'C190',
                        idx: c190.idx,
                        doc: docNum || '?',
                        combinacao: c190.chave,
                        campo: m.campo,
                        de: m.de,
                        para: m.para,
                        mensagem: `Doc ${docNum} ${c190.chave}: ${m.campo} ${m.de} → ${m.para} (recalculado da soma dos C170).`,
                    });
                }
            }
        }
    };

    for (const l of parsed.linhas) {
        if (l.tipo === 'C100') {
            flush();
            docNum = l.campos[7] || '?';
            c170Por = new Map();
            c190Linhas = [];
            continue;
        }
        if (l.tipo === 'C170' && c170Por) {
            const c = l.campos;
            const cst = String(c[9] || '');
            const cfop = String(c[10] || '');
            const aliq = aliqNum(c[13]);
            const chave = `${cst}|${cfop}|${aliq != null ? aliq.toFixed(2) : '0.00'}`;
            const acc = c170Por.get(chave) || { vlOpr: 0, vlBc: 0, vlIcms: 0 };
            acc.vlOpr += num(c[6]);   // VL_ITEM
            acc.vlBc += num(c[12]);   // VL_BC_ICMS
            acc.vlIcms += num(c[14]); // VL_ICMS
            c170Por.set(chave, acc);
            continue;
        }
        if (l.tipo === 'C190' && c190Linhas) {
            const c = l.campos;
            const cst = String(c[1] || '');
            const cfop = String(c[2] || '');
            const aliq = aliqNum(c[3]);
            const chave = `${cst}|${cfop}|${aliq != null ? aliq.toFixed(2) : '0.00'}`;
            c190Linhas.push({ idx: l.idx, campos: c, chave });
            continue;
        }
    }
    flush();
    return out;
}
