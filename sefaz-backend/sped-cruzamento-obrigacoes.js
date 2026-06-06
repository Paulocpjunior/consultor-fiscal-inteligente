// ============================================================================
// sped-cruzamento-obrigacoes.js  (PURO — sem io/firebase, testavel)
//
// Cruza o SPED Fiscal (EFD ICMS/IPI) contra o SPED Contribuicoes (EFD PIS/
// COFINS) da MESMA empresa/competencia. As NF-e (registro C100) sao
// escrituradas nas DUAS obrigacoes — entao a mesma chave deve aparecer nos dois
// arquivos, com o MESMO valor de documento. Divergencia = risco de malha.
//
// e-Auditoria vende isso como "cruzamento entre obrigacoes". Aqui e honesto:
//   - chave em AMBOS com VL_DOC diferente  -> ERRO (mesma nota, valor divergente)
//   - chave SO no Fiscal                    -> AVISO (pode ser legitimo: operacao
//                                              sem PIS/COFINS — contador decide)
//   - chave SO no Contribuicoes             -> AVISO (idem, sentido inverso)
//
// So cruza C100 com chave de 44 digitos. Notas CANCELADAS/DENEGADAS/INUTILIZADAS
// (COD_SIT 02/03/04/05) ficam de fora — nao representam operacao efetiva e
// podem legitimamente diferir. NFS-e (servico, bloco A) NAO entra (nao tem
// equivalente no Fiscal) — por isso so olhamos C100, nunca A100.
// ============================================================================

// Posicoes no C100 (campos[0]='C100'): mesmas no Fiscal e no Contribuicoes.
const C100 = { IND_OPER: 1, COD_SIT: 5, NUM_DOC: 7, CHV_NFE: 8, VL_DOC: 11 };

// COD_SIT que representam documento com operacao efetiva (cruzaveis).
const COD_SIT_EFETIVO = new Set(['00', '01', '06', '07', '08']);

function num(v) {
    if (v == null || v === '') return 0;
    const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}
const round2 = (n) => Math.round(n * 100) / 100;

// Indexa C100 por chave (44 digitos), so docs efetivos. Mantem 1a ocorrencia
// e soma nada — chave e unica por documento.
function indexarC100(parsed) {
    const idx = new Map();
    let semChave = 0, ignoradosSit = 0;
    for (const l of (parsed.linhas || [])) {
        if (l.tipo !== 'C100') continue;
        const c = l.campos;
        const codSit = String(c[C100.COD_SIT] || '').padStart(2, '0');
        if (!COD_SIT_EFETIVO.has(codSit)) { ignoradosSit++; continue; }
        const chave = String(c[C100.CHV_NFE] || '').replace(/\D/g, '');
        if (chave.length !== 44) { semChave++; continue; }
        if (!idx.has(chave)) {
            idx.set(chave, {
                chave,
                numDoc: c[C100.NUM_DOC] || '',
                indOper: c[C100.IND_OPER] || '',
                vlDoc: num(c[C100.VL_DOC]),
                idx: l.idx,
            });
        }
    }
    return { idx, semChave, ignoradosSit };
}

/**
 * Cruza dois SPEDs parseados (parseSpedFiscalParaEdicao). Aceita em qualquer
 * ordem — detecta qual e fiscal e qual e contribuicoes pelo tipoSped.
 *
 * @returns {{
 *   aplicavel: boolean, motivo?: string,
 *   resumo: { totalFiscal:number, totalContrib:number, emAmbos:number,
 *             soFiscal:number, soContrib:number, divergenciasValor:number,
 *             semChaveFiscal:number, semChaveContrib:number },
 *   achados: Array<{ tipo:string, severidade:'erro'|'aviso', chave:string,
 *             numDoc:string, vlFiscal:number, vlContrib:number, diferenca:number,
 *             mensagem:string }>
 * }}
 */
export function cruzarSpedFiscalContrib(a, b, opts = {}) {
    const tol = opts.toleranciaCentavos ?? 0.01;
    const lista = [a, b].filter(Boolean);
    const fiscal = lista.find((p) => p && p.tipoSped === 'fiscal');
    const contrib = lista.find((p) => p && p.tipoSped === 'contribuicoes');

    if (!fiscal || !contrib) {
        return {
            aplicavel: false,
            motivo: 'Cruzamento exige 1 SPED Fiscal (EFD ICMS/IPI) e 1 SPED Contribuicoes (EFD PIS/COFINS).',
            resumo: zerResumo(), achados: [],
        };
    }

    const F = indexarC100(fiscal);
    const C = indexarC100(contrib);
    const achados = [];
    let emAmbos = 0, divergenciasValor = 0;

    // Percorre Fiscal: classifica em-ambos (com check de valor) ou so-fiscal.
    for (const [chave, f] of F.idx) {
        const c = C.idx.get(chave);
        if (c) {
            emAmbos++;
            const dif = round2(f.vlDoc - c.vlDoc);
            if (Math.abs(dif) > tol) {
                divergenciasValor++;
                achados.push({
                    tipo: 'DIVERGENCIA_VALOR', severidade: 'erro', chave,
                    numDoc: f.numDoc, vlFiscal: f.vlDoc, vlContrib: c.vlDoc, diferenca: dif,
                    mensagem: `Nota ${f.numDoc}: VL_DOC diverge entre Fiscal (${f.vlDoc.toFixed(2)}) e Contribuicoes (${c.vlDoc.toFixed(2)}).`,
                });
            }
        } else {
            achados.push({
                tipo: 'SO_FISCAL', severidade: 'aviso', chave,
                numDoc: f.numDoc, vlFiscal: f.vlDoc, vlContrib: 0, diferenca: f.vlDoc,
                mensagem: `Nota ${f.numDoc} escriturada no Fiscal e AUSENTE no Contribuicoes. Conferir se ha PIS/COFINS devido.`,
            });
        }
    }
    // Percorre Contribuicoes: o que nao esta no Fiscal e so-contrib.
    for (const [chave, c] of C.idx) {
        if (F.idx.has(chave)) continue;
        achados.push({
            tipo: 'SO_CONTRIB', severidade: 'aviso', chave,
            numDoc: c.numDoc, vlFiscal: 0, vlContrib: c.vlDoc, diferenca: -c.vlDoc,
            mensagem: `Nota ${c.numDoc} escriturada no Contribuicoes e AUSENTE no Fiscal. Conferir se ha ICMS/IPI a escriturar.`,
        });
    }

    const soFiscal = achados.filter((x) => x.tipo === 'SO_FISCAL').length;
    const soContrib = achados.filter((x) => x.tipo === 'SO_CONTRIB').length;

    return {
        aplicavel: true,
        resumo: {
            totalFiscal: F.idx.size,
            totalContrib: C.idx.size,
            emAmbos,
            soFiscal,
            soContrib,
            divergenciasValor,
            semChaveFiscal: F.semChave,
            semChaveContrib: C.semChave,
        },
        achados,
    };
}

function zerResumo() {
    return {
        totalFiscal: 0, totalContrib: 0, emAmbos: 0, soFiscal: 0, soContrib: 0,
        divergenciasValor: 0, semChaveFiscal: 0, semChaveContrib: 0,
    };
}

export const _internals = { num, indexarC100, C100, COD_SIT_EFETIVO };
