// ============================================================================
// dctfweb-retencao-normalizer.js  (PURO — sem io/firebase, testavel)
//
// Normaliza a RETENCAO consolidada na DCTFWeb (Geral Mensal) pra cruzar contra
// a EFD-Reinf (que ALIMENTA a DCTFWeb). Divergencia = evento Reinf que nao
// chegou na DCTFWeb -> debito a menor (risco).
//
// CALIBRADO contra XML REAL do CONSXMLDECLARACAO (XMLSaida_..._042026_40.xml),
// mesmo contribuinte/competencia do R-2010 real. Estrutura confirmada:
//
//   ProcDctf > ConteudoDeclaracao > DctfXml > A000... > A050-CreditosTributarios
//     CreditoTributarioApurado (repete):
//       <codReceita>116201</codReceita>
//       <ctDescricaoTributo>CP PATRONAL - RETENCAO LEI 9.711/98</ctDescricaoTributo>
//       <ctValor>523.95</ctValor>          (ponto decimal, nao virgula)
//       <ctCnpj>03222111000130</ctCnpj>     (prestador — so em retencao de fonte)
//       <saldoaPagar>523.95</saldoaPagar>
//
// O R-2010 (INSS 523,95 do prestador 03222111000130) cai aqui como receita
// 116201 com o MESMO ctCnpj e MESMO valor — esse e o ponto de cruzamento.
//
// FAMILIAS de retencao (so as oriundas da EFD-Reinf):
//   INSS  (R-2010/2020) -> cod 1162  "CP PATRONAL - RETENCAO LEI 9.711/98"
//   IRRF  (R-4010/4020) -> cod 1708  "IRRF - REMUNER SERV PRESTADOS POR PJ"
//   CSRF  (R-4020)      -> cod 5952  "RET CONTRIB PJ A PJ" (CSLL+PIS+COFINS 4,65%)
//                         + 5987/5979/5960 (CSLL/PIS/COFINS retidos individuais)
// EXCLUI debitos proprios (patronal/segurados/terceiros) e IRRF de FOLHA
// (cod 5610) — NAO sao retencao de fonte da Reinf.
//
// Honesto: se nao achar nenhuma linha de retencao, retorna { lido:false,
// motivo } — nunca zeros falsos.
// ============================================================================

import { DOMParser } from '@xmldom/xmldom';
import { validarXmlSeguro } from './xml-seguranca.js';

// codReceita (raiz = 4 primeiros digitos) -> familia de retencao da Reinf.
const RECEITA_RAIZ_FAMILIA = {
    '1162': 'INSS',
    '1708': 'IRRF',
    '5952': 'CSRF',
    '5987': 'CSRF', // CSLL retida PJ
    '5979': 'CSRF', // PIS retido PJ
    '5960': 'CSRF', // COFINS retida PJ
};

const FAMILIAS = ['INSS', 'IRRF', 'CSRF'];

function familiaPorReceita(cod) {
    const c = String(cod || '').replace(/\D/g, '');
    if (c.length < 4) return null;
    return RECEITA_RAIZ_FAMILIA[c.slice(0, 4)] || null;
}

function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    let s = String(v).trim();
    // DCTFWeb usa ponto decimal ("523.95"); tolera tambem BR ("1.234,56").
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s.replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
}
const r2 = (n) => Math.round(n * 100) / 100;

function localName(node) {
    return (node.localName || String(node.nodeName || '').replace(/^.*:/, ''));
}
// Pega texto do filho DIRETO com aquele localName (nao desce na arvore — evita
// pegar tag homonima de um <CreditoTributarioApurado> herdado/aninhado).
function childText(el, tag) {
    const childNodes = el.childNodes || [];
    for (let i = 0; i < childNodes.length; i++) {
        const c = childNodes[i];
        if (c.nodeType === 1 && localName(c) === tag) {
            return String(c.textContent || '').trim();
        }
    }
    return '';
}

// Extrai a lista de creditos de um XML (string) OU de um objeto (provider).
function extrairCreditos(entrada) {
    // provider devolve { xml, ... }
    if (entrada && typeof entrada === 'object' && typeof entrada.xml === 'string') {
        return extrairCreditos(entrada.xml);
    }
    if (typeof entrada !== 'string') return null; // shape nao suportado
    let doc;
    try {
        const xmlSeguro = validarXmlSeguro(entrada);
        doc = new DOMParser({ errorHandler: () => {} }).parseFromString(xmlSeguro, 'text/xml');
    } catch {
        return null;
    }
    if (!doc || !doc.documentElement) return null;
    const all = doc.getElementsByTagName('*');
    const creditos = [];
    for (let i = 0; i < all.length; i++) {
        if (localName(all[i]) !== 'CreditoTributarioApurado') continue;
        const el = all[i];
        creditos.push({
            codReceita: childText(el, 'codReceita'),
            descricao: childText(el, 'ctDescricaoTributo'),
            grupo: childText(el, 'ctDescGrupo'),
            ctCnpj: childText(el, 'ctCnpj'),
            ctValor: childText(el, 'ctValor'),
            saldoaPagar: childText(el, 'saldoaPagar'),
        });
    }
    return creditos;
}

/**
 * @param {string|object} entrada  XML do CONSXMLDECLARACAO ou { xml }.
 * @returns {{
 *   lido: boolean, motivo: string|null,
 *   retencoes: {INSS:number, IRRF:number, CSRF:number},
 *   detalhes: Array<{codReceita:string, familia:string, descricao:string, ctCnpj:string, valor:number}>,
 *   ignorados: number,            // linhas que NAO sao retencao Reinf (debitos proprios)
 *   totalReconhecido: number
 * }}
 */
export function normalizarRetencaoDctfweb(entrada) {
    const vazio = { INSS: 0, IRRF: 0, CSRF: 0 };
    if (entrada == null || entrada === '') {
        return naoLido('Declaracao DCTFWeb ausente.');
    }
    const creditos = extrairCreditos(entrada);
    if (creditos == null) {
        return naoLido('XML da declaracao DCTFWeb ilegivel ou shape nao suportado.');
    }
    if (creditos.length === 0) {
        return naoLido('Nenhum CreditoTributarioApurado na declaracao DCTFWeb. '
            + 'Shape diferente do esperado — rode o serpro-smoke (CONSXMLDECLARACAO).');
    }

    const retencoes = { ...vazio };
    const detalhes = [];
    let total = 0;
    let ignorados = 0;

    for (const c of creditos) {
        const familia = familiaPorReceita(c.codReceita);
        if (!familia) { ignorados++; continue; }
        const valor = num(c.ctValor);
        if (!valor) { ignorados++; continue; }
        retencoes[familia] = r2(retencoes[familia] + valor);
        total = r2(total + valor);
        detalhes.push({
            codReceita: c.codReceita, familia,
            descricao: c.descricao, ctCnpj: c.ctCnpj, valor,
        });
    }

    if (detalhes.length === 0) {
        // Tem creditos, mas nenhum e retencao Reinf (so debitos proprios). Isso e
        // um resultado VALIDO e honesto: a DCTFWeb existe e nao tem retencao.
        return {
            lido: true, motivo: null,
            retencoes: { ...vazio }, detalhes: [], ignorados, totalReconhecido: 0,
        };
    }

    return { lido: true, motivo: null, retencoes, detalhes, ignorados, totalReconhecido: total };

    function naoLido(motivo) {
        return { lido: false, motivo, retencoes: { ...vazio }, detalhes: [], ignorados: 0, totalReconhecido: 0 };
    }
}

export const _internals = { num, familiaPorReceita, RECEITA_RAIZ_FAMILIA, FAMILIAS };
