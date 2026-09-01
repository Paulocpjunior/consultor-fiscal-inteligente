// ============================================================================
// sefaz-backend/retencao-pj-ajuste.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 "PRECISO TER A OPÇÃO DE AJUSTAR AS RETENÇÕES PARA ENTREGAR COM O VALOR
// CORRETO" (31/08, Paulo, no R-4020 da CONDOMINIO EDIFICIO MONTE CARLO).
//
// O CASO, com os números do print — NFS-e 377235, ELEVADORES ATLAS SCHINDLER:
//
//   VALOR TOTAL DO SERVIÇO ............ 3.413,24
//   PIS/PASEP (campo da nota) ............ 56,32   = 1,65% da base
//   COFINS    (campo da nota) ........... 259,41   = 7,60% da base
//   Contribuições Sociais - Retidas ..... 158,72   = 4,65% da base
//   Descrição ........... "3 - PIS/COFINS/CSLL Retidos"
//
// E a própria nota avisa, em Outras Informações: *"(5) Informações preenchidas
// nos campos de PIS e COFINS são referentes aos valores totais sobre a
// operação"*. Ou seja: **56,32 e 259,41 são o tributo do PRESTADOR** (regime
// não-cumulativo), não retenção. A retenção é a **CSRF de 158,72**.
//
// 🔴 O app JÁ DIZIA isso desde 07/08 (`conferirRetencaoFederal` devolve
// `campos-sao-totais-da-operacao`) — e **parava aí**. Denunciar sem dar saída é
// meia correção: o evento não sai, ou sai declarando **315,73 no lugar de
// 158,72**, quase o DOBRO.
//
// ────────────────────────────────────────────────────────────────────────────
// O QUE ESTE MÓDULO É: o dono da pergunta **"quanto esta nota reteve, de
// verdade?"**, com TRÊS origens em precedência e a origem CARIMBADA em cada
// resposta — número derivado nunca se apresenta como fato lido do documento
// (a régua do `origem: 'ficha-rateada'` do F600, 28/08).
//
//   1. **AJUSTE declarado** (autor + motivo escrito) — vence tudo. É o que o
//      Paulo pediu, e é a única saída onde o documento não tem o número.
//   2. **CSRF DECOMPOSTA** — quando a nota traz o campo de contribuições
//      sociais retidas e ele fecha em 4,65% da base. **Isto não é rateio
//      inventado**: as três alíquotas são de LEI (Lei 10.833/2003, art. 30 —
//      1% CSLL + 3% COFINS + 0,65% PIS = 4,65%) e a prova é a soma fechar ao
//      CENTAVO com o valor que a própria nota declara.
//   3. **O DOCUMENTO** — o que está gravado. É o comportamento de sempre, e
//      continua sendo a resposta na esmagadora maioria das notas.
//
// 📌 O DONO É ÚNICO DE PROPÓSITO. O ajuste não pode morar só na tela do REINF:
// quem responde "quanto esta nota reteve" é o CFI (é ele que conhece a forma do
// documento), e um ajuste que valesse só para o R-4020 faria o **SPED e o REINF
// declararem números diferentes sobre a mesma nota** — o defeito que esta casa
// mais paga.
// ============================================================================

import { ALIQ_CSRF, aliquotaEfetiva } from './retencao-federal-coerencia.js';

/**
 * As três alíquotas da retenção na fonte de PJ para PJ.
 * 📖 Lei 10.833/2003, art. 30: *"o valor correspondente à soma das alíquotas de
 * 1% (CSLL), 3% (COFINS) e 0,65% (PIS/PASEP)"*.
 */
export const ALIQ_LEGAL = { pis: 0.65, cofins: 3, csll: 1 };

/** Piso do motivo escrito — o mesmo da T3 da DCTFWeb e da reabertura do mês. */
export const MIN_MOTIVO = 15;

const num = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const cent = (n) => Math.round((Number(n) || 0) * 100);
const texto = (v) => String(v ?? '').trim();

/**
 * Decompõe a CSRF nas três contribuições, pelas alíquotas legais.
 *
 * ⚠️ **A SOBRA VAI À COFINS**, que é a MAIOR das três — a mesma régua do rateio
 * do F600 (28/08), e pelo mesmo motivo: a soma das três TEM de dar exatamente o
 * que a nota declara, senão o evento declara um total que o documento desmente.
 * Um centavo na menor delas seria proporcionalmente enorme.
 *
 * ⚠️ **E ela só responde quando FECHA em 4,65%.** Base com dedução ou retenção
 * parcial NÃO se decompõe por proporção deduzida — ali o app não sabe, e quem
 * responde é o ajuste declarado. Decompor "quase" é o rateio inventado com
 * outra roupa.
 *
 * @param {object} p
 * @param {number} p.base   valor total do serviço
 * @param {number} p.csrf   o campo de contribuições sociais retidas
 * @param {number} [p.tolerancia] pontos percentuais (default: a da coerência)
 */
export function decomporCsrf({ base, csrf, tolerancia = 0.06 } = {}) {
    const b = num(base);
    const total = num(csrf);
    if (!b || total === undefined || total <= 0) {
        return { fecha: false, motivo: 'sem-base-ou-sem-valor', valores: null };
    }
    const aliq = aliquotaEfetiva(total, b);
    if (aliq === null || Math.abs(aliq - ALIQ_CSRF) > tolerancia) {
        return {
            fecha: false,
            motivo: 'aliquota-nao-e-csrf',
            aliquota: aliq,
            valores: null,
        };
    }
    const pis = r2((b * ALIQ_LEGAL.pis) / 100);
    const csll = r2((b * ALIQ_LEGAL.csll) / 100);
    // A COFINS absorve a diferença: ela é a maior, e a soma tem de bater.
    const cofins = r2((cent(total) - cent(pis) - cent(csll)) / 100);
    if (cofins <= 0) return { fecha: false, motivo: 'decomposicao-negativa', valores: null };
    return {
        fecha: true,
        aliquota: aliq,
        valores: { pis, cofins, csll },
        // A conferência que autoriza a decomposição, dita para quem lê.
        soma: r2((cent(pis) + cent(cofins) + cent(csll)) / 100),
    };
}

/**
 * Valida um ajuste DECLARADO. Ele é uma afirmação de uma pessoa sobre um valor
 * que vai para uma declaração à Receita — então tem autor, motivo escrito, e
 * recusa o impossível NOMEANDO o campo.
 *
 * ⚠️ **O ajuste não mexe na BASE.** A base é o valor do serviço, que está no
 * documento; deixar alguém reescrevê-la seria reescrever a nota.
 */
export function validarAjusteRetencao(entrada = {}) {
    const base = num(entrada.base);
    const motivo = texto(entrada.motivo);
    const autor = texto(entrada.autor);
    const erros = [];

    if (!autor) erros.push('Sem autor: ajuste de retenção é declaração de alguém, e fica gravado quem foi.');
    if (motivo.length < MIN_MOTIVO) {
        erros.push(`Escreva o motivo do ajuste (mínimo ${MIN_MOTIVO} caracteres) — daqui a três meses `
            + 'ninguém lembra por que este valor foi mudado.');
    }

    const campos = ['ir', 'pis', 'cofins', 'csll', 'inss'];
    const valores = {};
    let algum = false;
    for (const c of campos) {
        const v = num(entrada[c]);
        if (v === undefined) continue;
        if (v < 0) { erros.push(`${c.toUpperCase()} negativo — retenção não é devolução.`); continue; }
        valores[c] = r2(v);
        if (v > 0) algum = true;
    }
    // ⚠️ Zero em TODOS os campos é uma afirmação legítima ("esta nota não teve
    // retenção") — o que não vale é o ajuste VAZIO, que não diz nada.
    if (!Object.keys(valores).length) {
        erros.push('Nenhum valor informado — o ajuste precisa dizer quanto foi retido (zero também é resposta).');
    }
    const soma = r2(Object.values(valores).reduce((t, v) => t + v, 0));
    if (base && soma > base) {
        erros.push(`A retenção declarada (${soma.toFixed(2)}) é MAIOR que o valor do serviço `
            + `(${base.toFixed(2)}) — confira o campo antes de gravar.`);
    }

    if (erros.length) return { ok: false, erros, valores: null };
    return {
        ok: true,
        erros: [],
        valores: { ...valores, motivo, autor, soma, algum },
    };
}

/**
 * A RESPOSTA: quanto esta nota reteve, e de ONDE veio o número.
 *
 * @param {object} p
 * @param {object} p.nota       a nota normalizada ({base, ir, pis, cofins, csllOuTotal, inss})
 * @param {object} p.coerencia  o diagnóstico de `conferirRetencaoFederal`
 * @param {object} [p.ajuste]   o ajuste declarado, se houver
 */
export function retencaoEfetivaDaNota({ nota, coerencia, ajuste } = {}) {
    const n = nota || {};
    const doDocumento = {
        ir: r2(n.ir ?? 0),
        pis: r2(n.pis ?? 0),
        cofins: r2(n.cofins ?? 0),
        csll: r2(n.csllOuTotal ?? 0),
        inss: r2(n.inss ?? 0),
    };

    // ── 1. AJUSTE DECLARADO — vence tudo, e diz quem declarou ───────────────
    if (ajuste && (ajuste.pis !== undefined || ajuste.cofins !== undefined
        || ajuste.csll !== undefined || ajuste.ir !== undefined || ajuste.inss !== undefined)) {
        const v = {
            ir: r2(ajuste.ir ?? doDocumento.ir),
            pis: r2(ajuste.pis ?? doDocumento.pis),
            cofins: r2(ajuste.cofins ?? doDocumento.cofins),
            csll: r2(ajuste.csll ?? doDocumento.csll),
            inss: r2(ajuste.inss ?? doDocumento.inss),
        };
        return {
            ...v,
            origem: 'ajuste-declarado',
            ajustadoPor: texto(ajuste.autor) || null,
            ajustadoEm: texto(ajuste.em) || null,
            motivo: texto(ajuste.motivo) || null,
            exigeAjuste: false,
            ressalva: `Retenção AJUSTADA à mão por ${texto(ajuste.autor) || 'alguém'}`
                + `${ajuste.em ? ` em ${texto(ajuste.em)}` : ''} — o documento traz outro valor. `
                + `Motivo: ${texto(ajuste.motivo) || '(não informado)'}`,
            doDocumento,
        };
    }

    const situacao = coerencia?.situacao;

    // ── 2. CSRF DECOMPOSTA — derivada, e provada pelo próprio documento ─────
    //
    // Só nesta situação: os campos de PIS/COFINS são o tributo da OPERAÇÃO, e o
    // valor retido está no campo de contribuições sociais. Usar o documento aqui
    // declararia o imposto do prestador como retido.
    if (situacao === 'campos-sao-totais-da-operacao') {
        const d = decomporCsrf({ base: n.base, csrf: n.csllOuTotal });
        if (d.fecha) {
            return {
                ir: doDocumento.ir,
                pis: d.valores.pis,
                cofins: d.valores.cofins,
                csll: d.valores.csll,
                inss: doDocumento.inss,
                origem: 'csrf-decomposta',
                exigeAjuste: false,
                ressalva: `Os campos de PIS (${doDocumento.pis.toFixed(2)}) e COFINS `
                    + `(${doDocumento.cofins.toFixed(2)}) desta nota são o tributo da OPERAÇÃO do prestador, `
                    + `não retenção. A retenção é a CSRF de ${r2(n.csllOuTotal).toFixed(2)} `
                    + `(${ALIQ_CSRF}% da base), aqui DERIVADA pelas alíquotas legais da Lei 10.833/2003 `
                    + `art. 30 — PIS ${d.valores.pis.toFixed(2)} · COFINS ${d.valores.cofins.toFixed(2)} `
                    + `· CSLL ${d.valores.csll.toFixed(2)}, somando ${d.soma.toFixed(2)}. `
                    + 'Número DERIVADO, não lido do documento: confira antes de transmitir.',
                doDocumento,
            };
        }
        // 🚨 SEM O CAMPO DA CSRF NÃO SE DERIVA NADA — e é exatamente aqui que o
        // ajuste declarado é a ÚNICA saída. Devolver o documento seria declarar
        // o tributo do prestador como retido; devolver zero seria declarar que
        // não houve retenção. As duas mentem.
        return {
            ...doDocumento,
            origem: 'documento-suspeito',
            exigeAjuste: true,
            ressalva: `PIS e COFINS desta nota são o tributo da OPERAÇÃO do prestador (1,65% e 7,60%), não `
                + 'retenção — e o campo de contribuições sociais retidas não fecha em '
                + `${ALIQ_CSRF}%, então o app NÃO tem como derivar o valor certo. `
                + 'Ajuste a retenção à mão antes de declarar: transmitir assim infla a retenção.',
            doDocumento,
        };
    }

    // ⚠️ A CSLL que é o TOTAL tem outra resposta e outro dono: ali PIS e COFINS
    // JÁ estão certos no documento, e o que falta é só a CSLL individual — 1%
    // da base. Tratar como o caso acima sobrescreveria dado bom.
    if (situacao === 'csll-e-o-total') {
        const b = num(n.base);
        const csll = b ? r2((b * ALIQ_LEGAL.csll) / 100) : undefined;
        if (csll !== undefined) {
            return {
                ...doDocumento,
                csll,
                origem: 'csll-derivada-da-base',
                exigeAjuste: false,
                ressalva: `O campo CSLL do documento (${doDocumento.csll.toFixed(2)}) é o TOTAL das três `
                    + `contribuições; PIS e COFINS já vêm separados. A CSLL individual foi derivada em `
                    + `${ALIQ_LEGAL.csll}% da base = ${csll.toFixed(2)}. Número DERIVADO: confira.`,
                doDocumento,
            };
        }
    }

    // ── 3. O DOCUMENTO — o caso normal, e a maioria esmagadora das notas ────
    return {
        ...doDocumento,
        origem: 'documento',
        exigeAjuste: !!coerencia?.exigeAcao,
        ressalva: coerencia?.exigeAcao
            ? `${coerencia.motivo} ${coerencia.acao || ''}`.trim()
            : null,
        doDocumento,
    };
}

/**
 * A chave do ajuste é a da NOTA, nunca a do prestador.
 *
 * 🚨 É a lição de 30/08 (o ✕ do FUNRURAL, que tirava TODAS as notas do
 * produtor): decisão gravada no nível errado apaga o que ninguém mandou apagar.
 * Duas notas do mesmo prestador podem ter naturezas diferentes.
 *
 * ⚠️ E sem chave não se ajusta nada — afirmar sobre documento que não se pode
 * casar mudaria o valor de uma declaração sem ninguém saber qual nota mudou.
 */
export function chaveDoAjuste(nota) {
    const c = texto(nota?.chave);
    if (c) return c;
    const n = texto(nota?.numero);
    const p = texto(nota?.prestadorCnpj).replace(/\D/g, '');
    return n && p ? `${p}-${n}` : '';
}

/** Resumo para a tela e para as ressalvas do payload. */
export function resumirRetencoesEfetivas(linhas = []) {
    const por = (o) => linhas.filter((l) => l.retencao?.origem === o).length;
    return {
        ajustadas: por('ajuste-declarado'),
        csrfDecomposta: por('csrf-decomposta'),
        csllDerivada: por('csll-derivada-da-base'),
        exigemAjuste: linhas.filter((l) => l.retencao?.exigeAjuste).length,
    };
}
