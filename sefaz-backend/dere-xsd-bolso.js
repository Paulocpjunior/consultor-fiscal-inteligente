// ============================================================================
// sefaz-backend/dere-xsd-bolso.js  (PURO — sem I/O; recebe o XSD como TEXTO)
// ----------------------------------------------------------------------------
// 📐 O "XSD DE BOLSO" — confere um XML contra o PRÓPRIO arquivo XSD da Receita.
//
// Por que existe: o PVA de bolso do SPED (`sped-prevalidacao.js`) nasceu para
// que a equipe não gastasse uma volta do validador por erro. Aqui a volta é
// pior — a DeRE se transmite por API, com credencial do piloto, e um evento
// recusado por schema volta como MS-código depois de assinado e enviado. Então
// o app confere ANTES, e confere contra o XSD que a Receita publicou (o que
// está em `docs/dere/xsd/`), nunca contra uma tabela digitada de memória:
// tabela copiada à mão é a segunda cópia que esta casa mais paga (30/08).
//
// O que ele CONFERE: a SEQUÊNCIA dos elementos (ordem e ocorrências min/max),
// os atributos obrigatórios, e cada valor simples contra a restrição do XSD
// (pattern, enumeration, minLength/maxLength, base xs:date/xs:byte/xs:int).
//
// O que ele NÃO é: um validador XSD completo. Ele conhece as construções que
// os XSD da DeRE usam (xs:element aninhado, xs:complexType/xs:sequence,
// xs:simpleType/xs:restriction inline, xs:attribute, xs:element ref=) e DIZ
// quando encontra outra — em vez de aprovar o que não sabe ler. A assinatura
// (`ds:Signature`, obrigatória no XSD) fica de fora por decisão: quem assina é
// o gateway na transmissão, e a prévia nasce sem ela.
// ============================================================================

import { DOMParser } from '@xmldom/xmldom';

const XS = 'http://www.w3.org/2001/XMLSchema';

function filhosElemento(no) {
    const out = [];
    for (let i = 0; i < (no.childNodes || []).length; i++) {
        const c = no.childNodes[i];
        if (c.nodeType === 1) out.push(c);
    }
    return out;
}
const localName = (no) => no.localName || String(no.nodeName || '').replace(/^.*:/, '');
const ehXs = (no, nome) => no.namespaceURI === XS && localName(no) === nome;

function lerRestricao(noRestricao) {
    const r = { base: noRestricao.getAttribute('base') || null, patterns: [], enumeracoes: [], minLength: null, maxLength: null, minInclusive: null, maxInclusive: null };
    for (const f of filhosElemento(noRestricao)) {
        const v = f.getAttribute('value');
        if (ehXs(f, 'pattern')) r.patterns.push(v);
        else if (ehXs(f, 'enumeration')) r.enumeracoes.push(v);
        else if (ehXs(f, 'minLength')) r.minLength = Number(v);
        else if (ehXs(f, 'maxLength')) r.maxLength = Number(v);
        else if (ehXs(f, 'minInclusive')) r.minInclusive = Number(v);
        else if (ehXs(f, 'maxInclusive')) r.maxInclusive = Number(v);
    }
    return r;
}

function lerOcorrencia(el) {
    const min = el.getAttribute('minOccurs');
    const max = el.getAttribute('maxOccurs');
    return {
        min: min === '' || min == null ? 1 : Number(min),
        max: max === '' || max == null ? 1 : (max === 'unbounded' ? Infinity : Number(max)),
    };
}

/** Lê um `<xs:element>` e devolve a definição (recursiva). */
function lerElemento(el, avisos) {
    const ref = el.getAttribute('ref');
    if (ref) return { ref, ...lerOcorrencia(el) };
    const def = { nome: el.getAttribute('name'), ...lerOcorrencia(el), filhos: null, restricao: null, atributos: [], tipo: el.getAttribute('type') || null };
    for (const f of filhosElemento(el)) {
        if (ehXs(f, 'complexType')) {
            for (const g of filhosElemento(f)) {
                if (ehXs(g, 'sequence')) {
                    def.filhos = [];
                    for (const h of filhosElemento(g)) {
                        if (ehXs(h, 'element')) def.filhos.push(lerElemento(h, avisos));
                        else avisos.push(`construção não suportada dentro de <${def.nome}>: xs:${localName(h)}`);
                    }
                } else if (ehXs(g, 'attribute')) {
                    def.atributos.push(lerAtributo(g));
                } else if (!ehXs(g, 'annotation')) {
                    avisos.push(`construção não suportada em <${def.nome}>: xs:${localName(g)}`);
                }
            }
        } else if (ehXs(f, 'simpleType')) {
            for (const g of filhosElemento(f)) if (ehXs(g, 'restriction')) def.restricao = lerRestricao(g);
        }
    }
    if (def.filhos === null && def.restricao === null && def.tipo) def.restricao = { base: def.tipo, patterns: [], enumeracoes: [], minLength: null, maxLength: null };
    return def;
}

function lerAtributo(el) {
    const a = { nome: el.getAttribute('name'), obrigatorio: el.getAttribute('use') === 'required', restricao: null };
    for (const f of filhosElemento(el)) {
        if (ehXs(f, 'simpleType')) for (const g of filhosElemento(f)) if (ehXs(g, 'restriction')) a.restricao = lerRestricao(g);
    }
    return a;
}

/** Carrega o esquema: raiz, namespace-alvo e a árvore de definições. */
export function carregarEsquema(xsdTexto) {
    const doc = new DOMParser().parseFromString(String(xsdTexto || ''), 'text/xml');
    const schema = doc.documentElement;
    if (!schema || !ehXs(schema, 'schema')) throw new Error('XSD ilegível: raiz não é xs:schema.');
    const avisos = [];
    const raizes = filhosElemento(schema).filter((f) => ehXs(f, 'element')).map((f) => lerElemento(f, avisos));
    if (!raizes.length) throw new Error('XSD sem elemento raiz.');
    return { targetNamespace: schema.getAttribute('targetNamespace') || null, raiz: raizes[0], avisos };
}

const RE_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function conferirValor(valor, restricao, caminho, erros) {
    if (!restricao) return;
    const base = String(restricao.base || '').replace(/^xs:/, '');
    if (base === 'date' && !RE_DATE.test(valor)) erros.push(`${caminho}: "${valor}" não é xs:date (AAAA-MM-DD)`);
    if ((base === 'byte' || base === 'int' || base === 'integer' || base === 'short' || base === 'long') && !/^-?\d+$/.test(valor)) {
        erros.push(`${caminho}: "${valor}" não é numérico inteiro (xs:${base})`);
    }
    for (const p of restricao.patterns) {
        if (!new RegExp(`^(?:${p})$`).test(valor)) erros.push(`${caminho}: "${valor}" não casa o pattern ${p}`);
    }
    if (restricao.enumeracoes.length && !restricao.enumeracoes.includes(valor)) {
        erros.push(`${caminho}: "${valor}" não está na enumeração [${restricao.enumeracoes.join(', ')}]`);
    }
    if (restricao.minLength != null && valor.length < restricao.minLength) erros.push(`${caminho}: tamanho ${valor.length} < minLength ${restricao.minLength}`);
    if (restricao.maxLength != null && valor.length > restricao.maxLength) erros.push(`${caminho}: tamanho ${valor.length} > maxLength ${restricao.maxLength}`);
    if (restricao.minInclusive != null && Number(valor) < restricao.minInclusive) erros.push(`${caminho}: ${valor} < minInclusive ${restricao.minInclusive}`);
    if (restricao.maxInclusive != null && Number(valor) > restricao.maxInclusive) erros.push(`${caminho}: ${valor} > maxInclusive ${restricao.maxInclusive}`);
}

function conferirElemento(def, el, caminho, erros, ignorarRefs) {
    // Atributos
    for (const a of def.atributos) {
        const tem = el.hasAttribute(a.nome);
        if (a.obrigatorio && !tem) { erros.push(`${caminho}: atributo obrigatório @${a.nome} ausente`); continue; }
        if (tem) conferirValor(el.getAttribute(a.nome), a.restricao, `${caminho}/@${a.nome}`, erros);
    }
    if (def.filhos === null) {
        if (filhosElemento(el).length) erros.push(`${caminho}: elemento simples com filhos`);
        else conferirValor(String(el.textContent || '').trim(), def.restricao, caminho, erros);
        return;
    }
    // Sequência: consome os filhos reais na ordem das definições.
    const reais = filhosElemento(el);
    let i = 0;
    for (const fd of def.filhos) {
        const nomeEsperado = fd.ref ? fd.ref.replace(/^.*:/, '') : fd.nome;
        let n = 0;
        while (i < reais.length && localName(reais[i]) === nomeEsperado) {
            if (!fd.ref) conferirElemento(fd, reais[i], `${caminho}/${nomeEsperado}${fd.max > 1 ? `[${n + 1}]` : ''}`, erros, ignorarRefs);
            n += 1; i += 1;
        }
        const ignorado = fd.ref && ignorarRefs.includes(fd.ref);
        if (n < fd.min && !ignorado) erros.push(`${caminho}: <${nomeEsperado}> ocorre ${n}× — mínimo ${fd.min}${fd.ref ? ' (ref)' : ''}`);
        if (n > fd.max) erros.push(`${caminho}: <${nomeEsperado}> ocorre ${n}× — máximo ${fd.max}`);
    }
    for (; i < reais.length; i++) {
        erros.push(`${caminho}: elemento <${localName(reais[i])}> inesperado (fora da sequência ou desconhecido do XSD)`);
    }
}

/**
 * Confere `xmlTexto` contra `xsdTexto`.
 *
 * @returns {{ ok: boolean, erros: string[], avisos: string[], raiz: string|null, namespace: string|null }}
 *   `ok` só é true com ZERO erros. `avisos` traz o que o conferidor não soube
 *   ler (construção fora do subconjunto) e as refs ignoradas — nunca em silêncio.
 */
export function conferirXmlContraXsd(xmlTexto, xsdTexto, { ignorarRefs = ['ds:Signature'] } = {}) {
    const esquema = carregarEsquema(xsdTexto);
    const erros = [];
    const avisos = [...esquema.avisos];
    const doc = new DOMParser({ onError: (level, msg) => { if (level === 'error' || level === 'fatalError') erros.push(`XML mal formado: ${msg}`); } })
        .parseFromString(String(xmlTexto || ''), 'text/xml');
    const raiz = doc.documentElement;
    if (!raiz) return { ok: false, erros: erros.length ? erros : ['XML vazio ou ilegível.'], avisos, raiz: null, namespace: esquema.targetNamespace };
    if (localName(raiz) !== esquema.raiz.nome) erros.push(`raiz <${localName(raiz)}> — o XSD espera <${esquema.raiz.nome}>`);
    if (esquema.targetNamespace && raiz.namespaceURI !== esquema.targetNamespace) {
        erros.push(`namespace da raiz "${raiz.namespaceURI || '(nenhum)'}" — o XSD espera "${esquema.targetNamespace}"`);
    }
    if (!erros.length) conferirElemento(esquema.raiz, raiz, esquema.raiz.nome, erros, ignorarRefs);
    if (ignorarRefs.length) avisos.push(`refs não conferidas (entram na transmissão, não na prévia): ${ignorarRefs.join(', ')}`);
    return { ok: erros.length === 0, erros, avisos, raiz: esquema.raiz.nome, namespace: esquema.targetNamespace };
}
