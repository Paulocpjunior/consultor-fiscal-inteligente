// ============================================================================
// efd-reinf-parser.js  (PURO — sem firebase/fetch, testavel em jest)
//
// Le um evento EFD-Reinf (XML assinado ou nao) e devolve um shape estavel com
// as RETENCOES declaradas, pra cruzar depois contra a DCTFWeb (que e alimentada
// automaticamente pelos eventos da Reinf). Divergencia tipica = evento que NAO
// foi transmitido/processado -> debito some na DCTFWeb -> risco fiscal.
//
// HONESTIDADE sobre cobertura (regra do projeto: nada pode ser fake):
//   Calibrado celula-a-celula contra DOIS arquivos REAIS:
//     - R-2010 (evtServTom)  — retencao previdenciaria (INSS) sobre serv. tomados
//     - R-4099 (evt4099FechamentoDirf) — fechamento da serie R-4000 (fechRet)
//   Esses dois sao EXTRAIDOS com valor exato. Os demais eventos (R-2020, serie
//   R-4000 de IR/CSLL/PIS/COFINS, R-5001/R-5011) sao RECONHECIDOS pelo namespace
//   e tem meta extraida, mas a extracao financeira fica marcada como
//   "naoCalibrado" — NAO inventamos campos de leiaute que nao verificamos contra
//   arquivo real. Quando chegar um XML real desses, calibra-se e remove a flag.
//
// Namespace-agnostico: navega por localName (funciona com ns default OU prefixo
// ds:/reinf:), entao a assinatura XMLDSig nao atrapalha.
// ============================================================================

import { DOMParser } from '@xmldom/xmldom';

// Token do schema (segmento apos /schemas/ na URI do namespace) -> codigo Reinf.
// So os que temos confianca. Verificados contra arquivo real marcados com ✓.
const SCHEMA_CODIGO = {
    evtTomadorServicos: 'R-2010',       // ✓ verificado
    evt4099FechamentoDirf: 'R-4099',    // ✓ verificado
    evtServicosPrestados: 'R-2020',
    evtFechamento: 'R-2099',
    evtTotalContrib: 'R-5001',
    evtTotal: 'R-5011',
};

// Eventos cuja extracao financeira foi calibrada contra arquivo real.
const CALIBRADOS = new Set(['R-2010', 'R-4099']);

// ── helpers de DOM (namespace-agnosticos) ──────────────────────────────────
function localName(node) {
    return node.localName || String(node.nodeName || '').replace(/^.*:/, '');
}
function elemChildren(node) {
    return Array.from(node.childNodes || []).filter((n) => n.nodeType === 1);
}
function childrenByTag(node, name) {
    return elemChildren(node).filter((n) => localName(n) === name);
}
// Primeiro descendente (BFS) com dado localName.
function deepFirst(node, name) {
    const fila = elemChildren(node);
    while (fila.length) {
        const n = fila.shift();
        if (localName(n) === name) return n;
        fila.push(...elemChildren(n));
    }
    return null;
}
// Texto do primeiro descendente <name>, ou '' se ausente.
function textOf(node, name) {
    const e = deepFirst(node, name);
    return e ? String(e.textContent || '').trim() : '';
}

// Numero em formato BR ("5.954,00" / "523,95" / "0,00") ou ja decimal.
function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    let s = String(v).trim();
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s.replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
}
const r2 = (n) => Math.round(n * 100) / 100;

function totaisZerados() {
    return { inssRetPrinc: 0, inssRetAdic: 0, baseRet: 0, bruto: 0, irrf: 0, csll: 0, pis: 0, cofins: 0 };
}

// ── deteccao do evento ──────────────────────────────────────────────────────
// Pega o elemento do evento (primeiro filho de <Reinf> cujo localName comeca
// com "evt") e o token de schema a partir do namespace dele.
function acharEvento(doc) {
    const reinf = doc.documentElement;
    if (!reinf) return null;
    for (const filho of elemChildren(reinf)) {
        const ln = localName(filho);
        if (ln && ln.toLowerCase().startsWith('evt')) {
            return filho;
        }
    }
    return null;
}
function schemaTokenDe(evento) {
    // namespaceURI tipo http://.../schemas/evtTomadorServicos/v2_01_02
    const ns = evento.namespaceURI || '';
    const m = ns.match(/\/schemas\/([^/]+)\//);
    return m ? m[1] : '';
}

// ── extratores por tipo ─────────────────────────────────────────────────────

// R-2010: retencao previdenciaria (INSS) — tomador de servicos.
function extrairR2010(evento) {
    const retencoes = [];
    const totais = totaisZerados();
    const infoServTom = deepFirst(evento, 'infoServTom');
    if (!infoServTom) return { retencoes, totais };

    for (const estab of childrenByTag(infoServTom, 'ideEstabObra')) {
        const nrInscEstab = textOf(estab, 'nrInscEstab');
        const indObra = textOf(estab, 'indObra');
        for (const prest of childrenByTag(estab, 'idePrestServ')) {
            const vlrTotalBruto = num(textOf(prest, 'vlrTotalBruto'));
            const vlrTotalBaseRet = num(textOf(prest, 'vlrTotalBaseRet'));
            const vlrTotalRetPrinc = num(textOf(prest, 'vlrTotalRetPrinc'));
            const vlrTotalRetAdic = num(textOf(prest, 'vlrTotalRetAdic'));

            totais.inssRetPrinc += vlrTotalRetPrinc;
            totais.inssRetAdic += vlrTotalRetAdic;
            totais.baseRet += vlrTotalBaseRet;
            totais.bruto += vlrTotalBruto;

            const notas = childrenByTag(prest, 'nfs').map((nf) => ({
                serie: textOf(nf, 'serie'),
                numDocto: textOf(nf, 'numDocto'),
                dtEmissaoNF: textOf(nf, 'dtEmissaoNF'),
                vlrBruto: num(textOf(nf, 'vlrBruto')),
                servicos: childrenByTag(nf, 'infoTpServ').map((s) => ({
                    tpServico: textOf(s, 'tpServico'),
                    vlrBaseRet: num(textOf(s, 'vlrBaseRet')),
                    vlrRetencao: num(textOf(s, 'vlrRetencao')),
                    vlrRetSub: num(textOf(s, 'vlrRetSub')),
                })),
            }));

            retencoes.push({
                nrInscEstab,
                indObra,
                cnpjPrestador: textOf(prest, 'cnpjPrestador'),
                vlrTotalBruto, vlrTotalBaseRet, vlrTotalRetPrinc, vlrTotalRetAdic,
                indCPRB: textOf(prest, 'indCPRB'),
                notas,
            });
        }
    }
    totais.inssRetPrinc = r2(totais.inssRetPrinc);
    totais.inssRetAdic = r2(totais.inssRetAdic);
    totais.baseRet = r2(totais.baseRet);
    totais.bruto = r2(totais.bruto);
    return { retencoes, totais };
}

// R-4099 / R-2099: eventos de FECHAMENTO. fechRet indica se houve retencao.
function extrairFechamento(evento) {
    const infoFech = deepFirst(evento, 'infoFech');
    const resp = deepFirst(evento, 'ideRespInf');
    return {
        // R-4099: fechRet "0" = NAO houve retencao na serie R-4000 no periodo;
        //         "1" = houve. (string preservada; consolidacao interpreta)
        fechRet: infoFech ? textOf(infoFech, 'fechRet') : null,
        responsavel: resp
            ? { nome: textOf(resp, 'nmResp'), cpf: textOf(resp, 'cpfResp'), telefone: textOf(resp, 'telefone') }
            : null,
    };
}

// ── API publica ─────────────────────────────────────────────────────────────

/**
 * Parseia um XML de evento EFD-Reinf.
 * @param {string} xml
 * @returns {{
 *   ok: boolean,
 *   codigo: string|null,           // 'R-2010' | 'R-4099' | ...
 *   schemaToken: string,
 *   tipoRetorno: 'retencao'|'fechamento'|'desconhecido',
 *   calibrado: boolean,
 *   id: string|null,
 *   ideEvento: { perApur:string, indRetif:string, tpAmb:string, procEmi:string, verProc:string },
 *   contribuinte: { tpInsc:string, nrInsc:string },
 *   retencoes: Array<object>,
 *   totais: object,
 *   fechamento: object|null,
 *   observacoes: string[]
 * }}
 */
export function parseEventoReinf(xml) {
    const observacoes = [];
    let doc;
    try {
        doc = new DOMParser({ onError: () => {} }).parseFromString(String(xml || ''), 'text/xml');
    } catch (e) {
        return erro('XML ilegivel: ' + e.message);
    }
    const evento = doc && acharEvento(doc);
    if (!evento) return erro('Nao encontrei elemento de evento (evt*) sob <Reinf>.');

    const schemaToken = schemaTokenDe(evento);
    const codigo = SCHEMA_CODIGO[schemaToken] || null;
    if (!codigo) observacoes.push(`Evento de schema "${schemaToken || '?'}" nao mapeado — meta extraida, sem extracao financeira.`);

    const ideEvento = (() => {
        const e = deepFirst(evento, 'ideEvento');
        return {
            perApur: e ? textOf(e, 'perApur') : '',
            indRetif: e ? textOf(e, 'indRetif') : '',
            tpAmb: e ? textOf(e, 'tpAmb') : '',
            procEmi: e ? textOf(e, 'procEmi') : '',
            verProc: e ? textOf(e, 'verProc') : '',
        };
    })();
    const contribuinte = (() => {
        const e = deepFirst(evento, 'ideContri');
        return { tpInsc: e ? textOf(e, 'tpInsc') : '', nrInsc: e ? textOf(e, 'nrInsc') : '' };
    })();

    let tipoRetorno = 'desconhecido';
    let retencoes = [];
    let totais = totaisZerados();
    let fechamento = null;
    const calibrado = CALIBRADOS.has(codigo);

    if (codigo === 'R-2010') {
        tipoRetorno = 'retencao';
        const r = extrairR2010(evento);
        retencoes = r.retencoes; totais = r.totais;
    } else if (codigo === 'R-4099' || codigo === 'R-2099') {
        tipoRetorno = 'fechamento';
        fechamento = extrairFechamento(evento);
    } else if (codigo) {
        // Evento reconhecido mas extracao financeira nao calibrada contra real.
        tipoRetorno = (codigo.startsWith('R-50')) ? 'fechamento' : 'retencao';
        observacoes.push(`Evento ${codigo}: extracao financeira ainda nao calibrada contra arquivo real.`);
    }

    return {
        ok: true,
        codigo,
        schemaToken,
        tipoRetorno,
        calibrado,
        id: evento.getAttribute ? (evento.getAttribute('id') || null) : null,
        ideEvento,
        contribuinte,
        retencoes,
        totais,
        fechamento,
        observacoes,
    };

    function erro(motivo) {
        return {
            ok: false, codigo: null, schemaToken: '', tipoRetorno: 'desconhecido', calibrado: false,
            id: null, ideEvento: { perApur: '', indRetif: '', tpAmb: '', procEmi: '', verProc: '' },
            contribuinte: { tpInsc: '', nrInsc: '' }, retencoes: [], totais: totaisZerados(),
            fechamento: null, observacoes: [motivo],
        };
    }
}

/**
 * Validacao de COERENCIA interna de um evento ja parseado (R-2010).
 *  - soma das notas (vlrRetencao) deve casar com vlrTotalRetPrinc do prestador;
 *  - aliquota retPrinc/baseRet deve ficar ~11% (faixa 0,10–0,115) — fora disso, aviso.
 * @returns {{ valido:boolean, erros:string[], avisos:string[] }}
 */
export function validarEventoReinf(parsed) {
    const erros = [];
    const avisos = [];
    if (!parsed || !parsed.ok) {
        return { valido: false, erros: [(parsed && parsed.observacoes && parsed.observacoes[0]) || 'evento invalido'], avisos };
    }
    if (parsed.codigo === 'R-2010') {
        for (const ret of parsed.retencoes) {
            const somaNotas = r2((ret.notas || []).reduce((acc, nf) =>
                acc + (nf.servicos || []).reduce((a, s) => a + (s.vlrRetencao || 0), 0), 0));
            if (somaNotas > 0 && Math.abs(somaNotas - ret.vlrTotalRetPrinc) > 0.02) {
                erros.push(`Prestador ${ret.cnpjPrestador}: soma das notas (${somaNotas.toFixed(2)}) != vlrTotalRetPrinc (${ret.vlrTotalRetPrinc.toFixed(2)}).`);
            }
            if (ret.vlrTotalBaseRet > 0) {
                const aliq = ret.vlrTotalRetPrinc / ret.vlrTotalBaseRet;
                if (aliq < 0.10 || aliq > 0.115) {
                    avisos.push(`Prestador ${ret.cnpjPrestador}: aliquota INSS ${(aliq * 100).toFixed(2)}% fora da faixa usual de 11% — conferir.`);
                }
            }
        }
    }
    return { valido: erros.length === 0, erros, avisos };
}

/**
 * Consolida varios eventos da MESMA competencia/contribuinte e cruza o
 * FECHAMENTO contra os eventos de retencao detalhados.
 *
 * Cruzamento honesto que da pra fazer com os dados que temos:
 *   - se ha eventos de retencao (R-2010 etc) com valor > 0 no periodo MAS o
 *     fechamento (R-4099) diz fechRet=0, isso e incoerente (debito pode sumir
 *     na DCTFWeb). Vira ALERTA. (Obs: R-4099 fecha a serie R-4000 — IR/CSLL/
 *     PIS/COFINS; INSS do R-2010 fecha via R-2099. O alerta respeita isso.)
 *
 * @param {Array} parsedList
 * @returns {{
 *   competencia:string, contribuinte:string,
 *   totais: object, qtdEventos:number,
 *   fechamentos: Array<{codigo:string, fechRet:string|null}>,
 *   alertas: string[]
 * }}
 */
export function consolidarReinf(parsedList) {
    const list = (parsedList || []).filter((p) => p && p.ok);
    const totais = totaisZerados();
    const fechamentos = [];
    const alertas = [];
    const perApurSet = new Set();
    const contribSet = new Set();
    let retInssTotal = 0;
    let temR4000Retencao = false;

    for (const p of list) {
        if (p.ideEvento && p.ideEvento.perApur) perApurSet.add(p.ideEvento.perApur);
        if (p.contribuinte && p.contribuinte.nrInsc) contribSet.add(p.contribuinte.nrInsc);

        if (p.tipoRetorno === 'fechamento' && p.fechamento) {
            fechamentos.push({ codigo: p.codigo, fechRet: p.fechamento.fechRet });
        }
        if (p.codigo === 'R-2010') {
            totais.inssRetPrinc = r2(totais.inssRetPrinc + p.totais.inssRetPrinc);
            totais.inssRetAdic = r2(totais.inssRetAdic + p.totais.inssRetAdic);
            totais.baseRet = r2(totais.baseRet + p.totais.baseRet);
            totais.bruto = r2(totais.bruto + p.totais.bruto);
            retInssTotal = r2(retInssTotal + p.totais.inssRetPrinc + p.totais.inssRetAdic);
        }
        // serie R-4000 (IR/CSLL/PIS/COFINS) — quando calibrarmos, soma aqui.
        if (/^R-40(10|20|40|80)$/.test(p.codigo || '')) {
            const r4000 = (p.totais.irrf + p.totais.csll + p.totais.pis + p.totais.cofins);
            if (r4000 > 0) temR4000Retencao = true;
        }
    }

    // Coerencia fechamento da serie R-4000 (R-4099).
    const fech4099 = fechamentos.find((f) => f.codigo === 'R-4099');
    if (fech4099 && fech4099.fechRet === '0' && temR4000Retencao) {
        alertas.push('R-4099 declara fechRet=0 (sem retencao na serie R-4000), mas ha eventos R-4010/4020/4040/4080 com retencao no periodo. Debito pode nao chegar a DCTFWeb.');
    }

    if (perApurSet.size > 1) alertas.push('Eventos de competencias diferentes consolidados juntos: ' + Array.from(perApurSet).join(', '));
    if (contribSet.size > 1) alertas.push('Eventos de contribuintes diferentes consolidados juntos: ' + Array.from(contribSet).join(', '));

    return {
        competencia: Array.from(perApurSet)[0] || '',
        contribuinte: Array.from(contribSet)[0] || '',
        totais,
        retInssTotal,
        qtdEventos: list.length,
        fechamentos,
        alertas,
    };
}

export const _internals = { num, localName, schemaTokenDe, SCHEMA_CODIGO, CALIBRADOS };
