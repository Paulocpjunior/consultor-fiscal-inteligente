// ============================================================================
// sefaz-backend/ncm-parametros.js  (PURO — testável)
// ----------------------------------------------------------------------------
// CADASTRO DE NCM — parâmetros fiscais por mercadoria.
//
// Paulo, 04/08: "o que nós não temos e devemos implementar: um cadastro de
// NCM, para melhor consulta e parâmetro de impostos e ST".
//
// O buraco aparecia todo dia no DIFAL: a alíquota interna entrava como 18%
// fixo (errado para laticínio, medicamento, cesta básica) e o IVA-ST tinha de
// ser digitado ITEM A ITEM, toda competência, mesmo sendo sempre o mesmo
// índice para o mesmo NCM. O cadastro transforma isso em "digita uma vez".
//
// DUAS REGRAS QUE MANDAM AQUI:
//
// 1) VIGÊNCIA. O IVA-ST vem de Portaria CAT e MUDA. Aplicar o índice de hoje
//    numa nota de 6 meses atrás recolhe o valor errado — e o erro só aparece
//    na fiscalização. Por isso o parâmetro é uma LISTA com vigência e a
//    resolução é sempre pela DATA DO DOCUMENTO, nunca "o mais recente".
//
// 2) O CADASTRO SUGERE, NÃO DECIDE. Todo valor que sai daqui vem carimbado
//    com a origem e a portaria, para o colaborador conferir antes de recolher.
//    Campo vazio NÃO vira zero nem palpite: fica vazio e o item segue pendente
//    (mesma regra do código de receita e do COD_AJ).
// ============================================================================

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const so = (v) => String(v ?? '').replace(/\D/g, '');

/** NCM tem 8 dígitos. Aceita com ponto e com espaço; devolve só os dígitos. */
export function normalizarNcm(valor) {
    const d = so(valor);
    return d.length === 8 ? d : '';
}

/**
 * Um NCM "casa" com outro por PREFIXO — a Portaria CAT às vezes fixa o índice
 * por posição (4 dígitos) ou subposição (6). O mais ESPECÍFICO vence.
 */
export function ncmCasa(ncmDoItem, ncmDoCadastro) {
    const item = so(ncmDoItem);
    const cad = so(ncmDoCadastro);
    if (!item || !cad) return false;
    if (cad.length === 8) return item === cad;
    return item.startsWith(cad);
}

export const ALIQ_INTERNA_MAX = 35;

/**
 * Valida um parâmetro antes de gravar (PURO).
 * Recusa o que produziria imposto errado em silêncio.
 */
export function validarParametroNcm(p) {
    const erros = [];
    const ncm = so(p?.ncm);
    if (!(ncm.length === 8 || ncm.length === 6 || ncm.length === 4 || ncm.length === 2)) {
        erros.push('NCM deve ter 8 dígitos (ou 2/4/6 quando a regra vale para a posição inteira).');
    }

    const uf = String(p?.uf || '').toUpperCase();
    if (uf && uf.length !== 2) erros.push('UF deve ter 2 letras.');

    if (p?.aliqInterna != null && p.aliqInterna !== '') {
        const a = num(p.aliqInterna);
        if (a < 0 || a > ALIQ_INTERNA_MAX) {
            erros.push(`Alíquota interna fora da faixa (0 a ${ALIQ_INTERNA_MAX}%).`);
        }
    }

    if (p?.ivaSt != null && p.ivaSt !== '') {
        const i = num(p.ivaSt);
        if (i < 0 || i > 500) erros.push('IVA-ST fora da faixa (0 a 500%).');
        // Índice sem a portaria vira número órfão: daqui a 6 meses ninguém
        // sabe de onde veio nem se ainda vale.
        if (!String(p?.portariaIvaSt || '').trim()) {
            erros.push('Informe a Portaria CAT do IVA-ST — índice sem origem não se confere depois.');
        }
    }

    if (p?.reducaoBase != null && p.reducaoBase !== '') {
        const r = num(p.reducaoBase);
        if (r < 0 || r >= 100) erros.push('Redução de base deve ficar entre 0 e 99,99%.');
    }

    const ini = String(p?.vigenciaInicio || '').trim();
    const fim = String(p?.vigenciaFim || '').trim();
    const ehData = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (ini && !ehData(ini)) erros.push('Vigência inicial deve ser AAAA-MM-DD.');
    if (fim && !ehData(fim)) erros.push('Vigência final deve ser AAAA-MM-DD.');
    if (ini && fim && fim < ini) erros.push('Vigência final anterior à inicial.');

    return { ok: erros.length === 0, erros, ncm, uf };
}

/** A data de referência cai dentro da vigência do parâmetro? */
export function vigenteEm(param, dataRef) {
    const d = String(dataRef || '').slice(0, 10);
    if (!d) return true;
    const ini = String(param?.vigenciaInicio || '').slice(0, 10);
    const fim = String(param?.vigenciaFim || '').slice(0, 10);
    if (ini && d < ini) return false;
    if (fim && d > fim) return false;
    return true;
}

/**
 * Resolve os parâmetros de UM item.
 *
 * @param {string} ncm       NCM do item
 * @param {Array}  catalogo  parâmetros cadastrados
 * @param {object} p
 * @param {string} [p.uf]      UF de destino (o parâmetro pode ser por UF)
 * @param {string} [p.dataRef] data do documento (AAAA-MM-DD) — manda na vigência
 * @returns {{achou:boolean, ncmCadastrado:string|null, aliqInterna:number|null,
 *            ivaSt:number|null, ivaJaAjustado:boolean, portariaIvaSt:string|null,
 *            cest:string|null, temSt:boolean|null, reducaoBase:number|null,
 *            descricao:string|null, motivo:string|null}}
 */
export function resolverParametrosNcm(ncm, catalogo, { uf = '', dataRef = '' } = {}) {
    const vazio = {
        achou: false, ncmCadastrado: null, aliqInterna: null, ivaSt: null,
        ivaJaAjustado: false, portariaIvaSt: null, cest: null, temSt: null,
        reducaoBase: null, descricao: null, motivo: null,
    };
    const alvo = so(ncm);
    if (!alvo) return { ...vazio, motivo: 'Item sem NCM — não dá pra consultar o cadastro.' };

    const ufAlvo = String(uf || '').toUpperCase();
    const candidatos = (catalogo || [])
        .filter((c) => ncmCasa(alvo, c?.ncm))
        // Parâmetro sem UF vale para todas; com UF, só para a dela.
        .filter((c) => !c?.uf || String(c.uf).toUpperCase() === ufAlvo)
        .filter((c) => vigenteEm(c, dataRef));

    if (candidatos.length === 0) {
        const existiaForaDaVigencia = (catalogo || []).some(
            (c) => ncmCasa(alvo, c?.ncm) && !vigenteEm(c, dataRef),
        );
        return {
            ...vazio,
            motivo: existiaForaDaVigencia
                ? `NCM ${alvo} está no cadastro, mas nenhum parâmetro vigia em ${String(dataRef).slice(0, 10)} — `
                  + 'cadastre a vigência do período da nota (a Portaria CAT muda).'
                : `NCM ${alvo} não está no cadastro.`,
        };
    }

    // Mais ESPECÍFICO vence: NCM de 8 dígitos antes da posição de 4; e, no
    // empate, o de vigência mais recente (regra nova sobrepõe a antiga).
    candidatos.sort((a, b) => {
        const esp = so(b.ncm).length - so(a.ncm).length;
        if (esp !== 0) return esp;
        const ufPeso = (String(b.uf || '') ? 1 : 0) - (String(a.uf || '') ? 1 : 0);
        if (ufPeso !== 0) return ufPeso;
        return String(b.vigenciaInicio || '').localeCompare(String(a.vigenciaInicio || ''));
    });

    const c = candidatos[0];
    const temValor = (v) => v != null && v !== '';
    return {
        achou: true,
        ncmCadastrado: String(c.ncm),
        aliqInterna: temValor(c.aliqInterna) ? num(c.aliqInterna) : null,
        ivaSt: temValor(c.ivaSt) ? num(c.ivaSt) : null,
        ivaJaAjustado: !!c.ivaJaAjustado,
        portariaIvaSt: c.portariaIvaSt || null,
        cest: c.cest || null,
        temSt: c.temSt == null ? null : !!c.temSt,
        reducaoBase: temValor(c.reducaoBase) ? num(c.reducaoBase) : null,
        descricao: c.descricao || null,
        motivo: null,
    };
}

/**
 * Aplica o cadastro sobre os itens COM ST de um documento, devolvendo o mapa
 * `CHAVE|NITEM` que o 426-A consome — SEM sobrescrever o que o humano digitou.
 *
 * O que o colaborador informou na tela sempre vence: o cadastro é sugestão.
 */
export function sugerirIvaPorItem(documentosComSt, catalogo, ivaInformado = {}) {
    const sugerido = {};
    const usados = [];

    for (const doc of documentosComSt || []) {
        for (const it of doc?.itens || []) {
            const id = `${doc.chave}|${it.nItem}`;
            if (ivaInformado[id]?.ivaSt > 0) continue;   // humano manda

            const r = resolverParametrosNcm(it.ncm, catalogo, {
                uf: doc.ufDestino || '',
                dataRef: doc.dhEmi || '',
            });
            if (!r.achou || r.ivaSt == null) continue;

            sugerido[id] = {
                ivaSt: r.ivaSt,
                ivaJaAjustado: r.ivaJaAjustado,
                ...(r.aliqInterna != null ? { aliqInterna: r.aliqInterna } : {}),
                _origem: 'cadastro-ncm',
                _ncm: r.ncmCadastrado,
                _portaria: r.portariaIvaSt,
            };
            usados.push({ id, ncm: r.ncmCadastrado, portaria: r.portariaIvaSt });
        }
    }

    return { sugerido, usados };
}

export const COLECAO_NCM = 'ncm_parametros';

/** docId estável: NCM + UF (vazia = geral) + início de vigência. */
export function docIdParametro(p) {
    const ncm = so(p?.ncm);
    const uf = String(p?.uf || '').toUpperCase() || 'BR';
    const ini = String(p?.vigenciaInicio || '').slice(0, 10) || 'sem-inicio';
    return `${ncm}_${uf}_${ini}`;
}
