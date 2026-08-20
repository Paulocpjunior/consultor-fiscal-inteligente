// ============================================================================
// sped-fiscal-c190-autofix.js  (PURO — testavel)
//
// AUTO-CORRECAO do totalizador C190 do SPED Fiscal (EFD ICMS/IPI).
//
// O C190 agrupa as linhas C170 do MESMO documento (mesmo C100 pai) por
// (CST_ICMS, CFOP, ALIQ_ICMS). VL_BC_ICMS/VL_ICMS do C190 sao a soma dos C170
// daquela combinacao. Quando o contador edita um C170 a mao (corrige um
// VL_ITEM, por ex) e esquece de refazer o C190, o PVA rejeita.
//
// 🚨 O VL_OPR E A EXCECAO, e este arquivo dizia o contrario (corrigido 20/08,
// caso PWR): ele NAO e a soma dos VL_ITEM — inclui ICMS-ST, IPI destacado e as
// despesas acessorias, menos o desconto incondicional (Guia Pratico 3.2.3,
// C190 campo 05). A regua mora em `valor-operacao-c190.js`. E como frete,
// seguro e outras despesas moram no C100 e nao no C170, o derivado aqui e um
// PISO: com despesas na nota este modulo NAO reescreve o VL_OPR, so DIZ.
//
// O validador (sped-fiscal-regras-tributarias.js R8) so APONTA a divergencia.
// Este modulo CORRIGE: recalcula os 3 valores do C190 a partir dos C170 e
// devolve a lista de edicoes (pro reconstruirSped) + a lista de AJUSTES
// (de/para por campo) pra exibir como aviso ao usuario.
//
// Conservador de proposito:
//  - Corrige C190 que JA EXISTE e cujo valor diverge alem da tolerancia.
//  - Cria C190 faltante quando ha C170 correspondente no mesmo C100.
//  - Em C190 existente, so mexe nos 3 campos que o R8 valida
//    (VL_OPR, VL_BC_ICMS, VL_ICMS). Campos de ST/IPI/RED_BC ficam intactos.
//  - Em C190 criado, preenche tambem ST/IPI quando constarem dos C170.
//  - C170 e a FONTE DE VERDADE (item a item); C190 e derivado.
//
// Layout C190 (campos[N], 0-based onde [0]='C190'):
//   1=CST_ICMS 2=CFOP 3=ALIQ_ICMS 4=VL_OPR 5=VL_BC_ICMS 6=VL_ICMS ...
// Layout C170:
//   6=VL_ITEM 9=CST_ICMS 10=CFOP 12=VL_BC_ICMS 13=ALIQ_ICMS 14=VL_ICMS
// ============================================================================

// O VL_OPR tem DONO (Guia 3.2.3, C190 campo 05): ele NÃO é a soma dos VL_ITEM.
import { pisoDoValorOperacaoDoC170, acessoriasDoC100, faixaDoValorOperacao } from './valor-operacao-c190.js';

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
 *   edicoes: Array<{idx?:number, insertAfterIdx?:number, campos:string[]}>,
 *   ajustes: Array<{registro:string, idx:number, doc:string, combinacao:string, campo:string, de:string, para:string, mensagem:string}>,
 *   resumo: { c190Corrigidos:number, c190Criados:number, camposAjustados:number }
 * }}
 */
export function corrigirC190(parsed) {
    const out = { edicoes: [], ajustes: [], resumo: { c190Corrigidos: 0, c190Criados: 0, camposAjustados: 0 } };
    if (!parsed || !Array.isArray(parsed.linhas)) return out;
    // C190/C170 sao do EFD ICMS/IPI. Em Contribuicoes nao se aplica.
    if (parsed.tipoSped && parsed.tipoSped !== 'fiscal') return out;

    let docNum = null;
    let c170Por = null;   // Map<chave, totais dos C170>
    let c190Linhas = null; // Array<{idx, campos, chave}>
    let lastC170Idx = null;
    let lastC190Idx = null;
    /** Despesas acessórias do C100 pai — elas entram no VL_OPR e não no C170. */
    let acessoriasDoDoc = 0;

    const flush = () => {
        if (!c170Por || !c190Linhas) return;
        const chavesC190 = new Set(c190Linhas.map(c190 => c190.chave));
        const insertAfterIdx = Math.max(lastC170Idx ?? -1, lastC190Idx ?? -1);
        for (const [chave, t170] of c170Por) {
            if (chavesC190.has(chave) || insertAfterIdx < 0) continue;
            const campos = [
                'C190',
                t170.cst,
                t170.cfop,
                t170.aliqTexto,
                fmtValor(t170.vlOpr),
                fmtValor(t170.vlBc),
                fmtValor(t170.vlIcms),
                fmtValor(t170.vlBcSt),
                fmtValor(t170.vlIcmsSt),
                '0,00',
                fmtValor(t170.vlIpi),
                '',
            ];
            out.edicoes.push({ insertAfterIdx, campos });
            out.resumo.c190Criados++;
            out.ajustes.push({
                registro: 'C190',
                idx: insertAfterIdx,
                doc: docNum || '?',
                combinacao: chave,
                campo: 'REGISTRO',
                de: '',
                para: campos.join('|'),
                mensagem: `Doc ${docNum} ${chave}: C190 faltante criado a partir dos C170.`
                    + (acessoriasDoDoc > 0
                        ? ' ⚠️ O VL_OPR saiu SEM as despesas acessorias do C100 (frete/seguro/outras), que nao '
                          + 'existem no C170 e nao se rateiam por CST/CFOP — confira esse campo a mao.'
                        : ''),
            });
        }

        for (const c190 of c190Linhas) {
            const t170 = c170Por.get(c190.chave);
            if (!t170) continue; // C190 sem C170: caso do R8 (nao corrige aqui)

            const campos = c190.campos.slice();
            const atualOpr = num(campos[4]);
            const atualBc = num(campos[5]);
            const atualIcms = num(campos[6]);

            const mudancas = [];
            // ⚠️ SÓ SE REESCREVE O QUE SE CONSEGUE PROVAR. Frete, seguro e
            // outras despesas acessórias entram no VL_OPR e moram no C100, não
            // no C170 — não dá para saber quanto delas cabe a ESTA combinação
            // de CST/CFOP/alíquota, e ratear seria inventar. Com despesas na
            // nota o campo fica INTACTO e o motivo vai escrito; sem elas, o
            // valor é exato e a correção é segura.
            const faixa = faixaDoValorOperacao(t170.vlOpr, acessoriasDoDoc);
            if (Math.abs(atualOpr - t170.vlOpr) > TOL) {
                if (faixa.exato) {
                    mudancas.push({ campo: 'VL_OPR', de: campos[4], para: fmtValor(t170.vlOpr) });
                    campos[4] = fmtValor(t170.vlOpr);
                } else if (atualOpr < faixa.piso - TOL || atualOpr > faixa.teto + TOL) {
                    out.ajustes.push({
                        registro: 'C190',
                        idx: c190.idx,
                        doc: docNum || '?',
                        combinacao: c190.chave,
                        campo: 'VL_OPR',
                        de: campos[4],
                        para: campos[4],
                        mensagem: `Doc ${docNum} ${c190.chave}: VL_OPR=${atualOpr.toFixed(2)} fora do esperado `
                            + `(${faixa.piso.toFixed(2)} a ${faixa.teto.toFixed(2)}). NAO corrigido: a nota tem `
                            + 'frete/seguro/outras despesas, que sao do C100 e nao se rateiam por CST/CFOP. '
                            + 'Confira a mao.',
                    });
                }
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
            acessoriasDoDoc = acessoriasDoC100(l.campos);
            c170Por = new Map();
            c190Linhas = [];
            lastC170Idx = null;
            lastC190Idx = null;
            continue;
        }
        if (l.tipo === 'C170' && c170Por) {
            const c = l.campos;
            const cst = String(c[9] || '');
            const cfop = String(c[10] || '');
            const aliq = aliqNum(c[13]);
            const chave = `${cst}|${cfop}|${aliq != null ? aliq.toFixed(2) : '0.00'}`;
            const acc = c170Por.get(chave) || {
                cst,
                cfop,
                aliqTexto: aliq != null ? fmtValor(aliq) : '',
                vlOpr: 0,
                vlBc: 0,
                vlIcms: 0,
                vlBcSt: 0,
                vlIcmsSt: 0,
                vlIpi: 0,
            };
            // 🚨 VL_OPR NÃO É VL_ITEM. Régua única em valor-operacao-c190.js
            // (Guia 3.2.3, C190 campo 05). Aqui era `num(c[6])`, e depois da
            // correção do gerador (PWR, 20/08) este autofix DESFARIA a correção
            // — reescrevendo o VL_OPR certo com um valor sem o IPI.
            acc.vlOpr += pisoDoValorOperacaoDoC170(c);
            acc.vlBc += num(c[12]);   // VL_BC_ICMS
            acc.vlIcms += num(c[14]); // VL_ICMS
            acc.vlBcSt += num(c[15]); // VL_BC_ICMS_ST
            acc.vlIcmsSt += num(c[17]); // VL_ICMS_ST
            acc.vlIpi += num(c[23]); // VL_IPI
            c170Por.set(chave, acc);
            lastC170Idx = l.idx;
            continue;
        }
        if (l.tipo === 'C190' && c190Linhas) {
            const c = l.campos;
            const cst = String(c[1] || '');
            const cfop = String(c[2] || '');
            const aliq = aliqNum(c[3]);
            const chave = `${cst}|${cfop}|${aliq != null ? aliq.toFixed(2) : '0.00'}`;
            c190Linhas.push({ idx: l.idx, campos: c, chave });
            lastC190Idx = l.idx;
            continue;
        }
    }
    flush();
    return out;
}
