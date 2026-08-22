// ============================================================================
// sped-cruzamento-xml-capturados.js  (PURO — sem io/firebase, testavel)
//
// Cruza o SPED Fiscal (EFD ICMS/IPI) contra as NF-e CAPTURADAS no sistema
// (XMLs da empresa que o ja-captura via sharepoint-sync ou outras fontes).
// Detecta:
//   - NF-e capturada AUTORIZADA mas NAO escriturada no SPED -> ERRO ALTO
//     (omissao de escrituracao — risco direto de malha fiscal)
//   - NF-e escriturada no SPED mas SEM XML capturado -> AVISO
//     (pode ser legitimo: captura incompleta. Contador decide.)
//   - NF-e escriturada com VL_DOC diferente do valor do XML capturado -> ERRO
//
// HONESTIDADE: so cruza NF-e capturadas com status='autorizado' (canceladas,
// denegadas, inutilizadas nao devem estar no SPED — incluir geraria falso-
// positivo). NFS-e nao entra (so o que tem chave 44-dig de NF-e modelo 55).
// ============================================================================

const C100 = { COD_SIT: 5, NUM_DOC: 7, CHV_NFE: 8, VL_DOC: 11 };
// Valor do documento em TODAS as formas (o import pelo navegador grava só
// `totais.vNF`) — régua única.
import { valorDoDocumento } from './xml-metadata-helper.js';

const COD_SIT_EFETIVO = new Set(['00', '01', '06', '07', '08']);

function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}
const round2 = (n) => Math.round(n * 100) / 100;

// Indexa C100 do SPED por chave (so docs com operacao efetiva).
function indexarSpedFiscal(parsed) {
    const idx = new Map();
    let ignorados = 0;
    for (const l of (parsed.linhas || [])) {
        if (l.tipo !== 'C100') continue;
        const c = l.campos;
        const codSit = String(c[C100.COD_SIT] || '').padStart(2, '0');
        if (!COD_SIT_EFETIVO.has(codSit)) { ignorados++; continue; }
        const chave = String(c[C100.CHV_NFE] || '').replace(/\D/g, '');
        if (chave.length !== 44) continue;
        if (!idx.has(chave)) {
            idx.set(chave, {
                chave,
                numDoc: c[C100.NUM_DOC] || '',
                vlDoc: num(c[C100.VL_DOC]),
                idx: l.idx,
            });
        }
    }
    return { idx, ignorados };
}

// Normaliza lista de NF-e capturadas: aceita varios shapes (chave / chaveAcesso,
// valorTotal / vNF / valor). So mantem autorizadas.
function indexarCapturadas(nfes) {
    const idx = new Map();
    let descartadas = 0;
    for (const n of (nfes || [])) {
        if (!n) continue;
        const status = String(n.status || '').toLowerCase();
        if (status && status !== 'autorizado' && status !== 'autorizada') { descartadas++; continue; }
        const chave = String(n.chave || n.chaveAcesso || n.chNFe || '').replace(/\D/g, '');
        if (chave.length !== 44) { descartadas++; continue; }
        // Valor pela RÉGUA: o import pelo NAVEGADOR grava só `totais.vNF`, e
        // ler as formas na mão fazia essas notas valerem 0,00 aqui — o
        // cruzamento acusaria divergência contra um SPED CERTO, que é o alarme
        // falso que ensina a equipe a ignorar a conferência.
        const valor = num(valorDoDocumento(n) ?? 0) || num(n.vlDoc ?? 0);
        if (!idx.has(chave)) {
            idx.set(chave, {
                chave,
                numDoc: String(n.numero || n.nNF || n.numDoc || ''),
                direcao: n.direcao || null,
                valor,
                competencia: n.competencia || null,
            });
        }
    }
    return { idx, descartadas };
}

/**
 * @param {object} parsedSped       resultado do parseSpedFiscalParaEdicao
 * @param {Array} nfesCapturadas    lista de NF-e capturadas (firestore)
 * @param {object} [opts]
 * @returns {{
 *   aplicavel: boolean, motivo?: string,
 *   resumo: { totalSped:number, totalCapturadas:number, emAmbos:number,
 *             naoEscrituradas:number, semCaptura:number, divergenciasValor:number },
 *   achados: Array<{ tipo:string, severidade:'erro'|'aviso', chave:string,
 *             numDoc:string, vlSped:number, vlCapturado:number, diferenca:number,
 *             direcao:string|null, mensagem:string }>
 * }}
 */
export function cruzarSpedComCapturadas(parsedSped, nfesCapturadas, opts = {}) {
    const tol = opts.toleranciaCentavos ?? 0.01;
    if (!parsedSped || parsedSped.tipoSped !== 'fiscal') {
        return {
            aplicavel: false,
            motivo: 'Cruzamento exige SPED Fiscal (EFD ICMS/IPI).',
            resumo: zerResumo(), achados: [],
        };
    }
    const S = indexarSpedFiscal(parsedSped);
    const X = indexarCapturadas(nfesCapturadas);
    const achados = [];
    let emAmbos = 0, divergenciasValor = 0;

    for (const [chave, x] of X.idx) {
        const s = S.idx.get(chave);
        if (!s) {
            achados.push({
                tipo: 'NAO_ESCRITURADA', severidade: 'erro', chave,
                numDoc: x.numDoc, vlSped: 0, vlCapturado: x.valor, diferenca: -x.valor,
                direcao: x.direcao,
                mensagem: `NF-e ${x.numDoc} capturada (autorizada) e NAO encontrada na escrituracao do SPED Fiscal.`,
            });
        } else {
            emAmbos++;
            const dif = round2(s.vlDoc - x.valor);
            if (x.valor === 0) {
                // XML capturado sem valor (parser nao extraiu vNF, ou doc legado):
                // NAO conseguimos comparar — aviso explicito em vez de "tudo certo".
                achados.push({
                    tipo: 'SEM_VALOR_CAPTURADO', severidade: 'aviso', chave,
                    numDoc: s.numDoc || x.numDoc,
                    vlSped: s.vlDoc, vlCapturado: 0, diferenca: 0,
                    direcao: x.direcao,
                    mensagem: `NF-e ${s.numDoc || x.numDoc}: XML capturado sem valor — comparacao indisponivel.`,
                });
            } else if (Math.abs(dif) > tol) {
                divergenciasValor++;
                achados.push({
                    tipo: 'DIVERGENCIA_VALOR', severidade: 'erro', chave,
                    numDoc: s.numDoc || x.numDoc,
                    vlSped: s.vlDoc, vlCapturado: x.valor, diferenca: dif,
                    direcao: x.direcao,
                    mensagem: `NF-e ${s.numDoc || x.numDoc}: VL_DOC no SPED (${s.vlDoc.toFixed(2)}) diverge do XML capturado (${x.valor.toFixed(2)}).`,
                });
            }
        }
    }
    for (const [chave, s] of S.idx) {
        if (X.idx.has(chave)) continue;
        achados.push({
            tipo: 'SEM_CAPTURA', severidade: 'aviso', chave,
            numDoc: s.numDoc, vlSped: s.vlDoc, vlCapturado: 0, diferenca: s.vlDoc,
            direcao: null,
            mensagem: `NF-e ${s.numDoc} escriturada no SPED mas sem XML capturado no sistema.`,
        });
    }

    return {
        aplicavel: true,
        resumo: {
            totalSped: S.idx.size,
            totalCapturadas: X.idx.size,
            emAmbos,
            naoEscrituradas: achados.filter(a => a.tipo === 'NAO_ESCRITURADA').length,
            semCaptura: achados.filter(a => a.tipo === 'SEM_CAPTURA').length,
            semValorCapturado: achados.filter(a => a.tipo === 'SEM_VALOR_CAPTURADO').length,
            divergenciasValor,
            descartadasCapturadas: X.descartadas,
            ignoradosSped: S.ignorados,
        },
        achados,
    };
}

function zerResumo() {
    return {
        totalSped: 0, totalCapturadas: 0, emAmbos: 0,
        naoEscrituradas: 0, semCaptura: 0, divergenciasValor: 0,
        descartadasCapturadas: 0, ignoradosSped: 0,
    };
}

export const _internals = { indexarSpedFiscal, indexarCapturadas, num };
