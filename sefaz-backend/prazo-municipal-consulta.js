// ============================================================================
// sefaz-backend/prazo-municipal-consulta.js  (ESM, puro)
// ----------------------------------------------------------------------------
// A CONSULTA MENSAL DE PRAZO — proposta COM FONTE, nunca escrita direta.
//
// Paulo, 11/08: *"consulta mensal pelo Gemini é PROPOSTA COM FONTE, nunca
// escrita direta: o app mostra a DIFERENÇA contra o catálogo e humano confirma
// — data de pagamento não muda sozinha (multa de um lado, 'atrasada' falsa do
// outro), e modelo com busca reduz o chute mas pode citar blog no lugar do
// ato"*.
//
// Este módulo é a metade DETERMINÍSTICA disso: monta o pedido, lê a resposta e
// **recusa o que não se sustenta**. Ele nunca grava — quem grava é a rota de
// cadastro, com base legal, vigência e o nome de quem confirmou.
//
// ═══ AS TRÊS RECUSAS QUE FAZEM ISTO SER ÚTIL ════════════════════════════════
//
//  (1) PROPOSTA SEM FONTE É CHUTE. Sem `groundingChunks` com URL, a resposta é
//      descartada — modelo sem busca inventa prazo com a mesma confiança com
//      que acerta, e prazo errado entregue com confiança é o erro mais caro
//      deste app.
//  (2) FONTE QUE NÃO É OFICIAL vai MARCADA, não escondida. Blog e escritório
//      concorrente aparecem com o selo `nao-oficial` — o modelo cita o que
//      acha, e quem decide é quem lê.
//  (3) DIA FORA DE 1–31 (ou ausente) NÃO VIRA DEFAULT. Campo de prazo não
//      recebe chute nem zero: sem dia legível, não há proposta.
// ============================================================================

/** Domínios que fazem uma fonte ser OFICIAL para prazo municipal. */
const OFICIAIS = [/\.gov\.br(\/|$)/i, /\.leg\.br(\/|$)/i, /\.jus\.br(\/|$)/i];

export function ehFonteOficial(url) {
    const u = String(url || '');
    return OFICIAIS.some((re) => re.test(u));
}

/**
 * O pedido. Pede JSON e pede a NORMA — sem a norma o cadastro é recusado
 * depois, então pedir texto solto seria gastar consulta à toa.
 */
export function montarPromptPrazoMunicipal({ municipioNome, uf, codMunIBGE, obrigacao = 'ISS' }) {
    return [
        `Qual é o prazo de recolhimento do ${obrigacao} próprio (imposto sobre serviços) no município de `,
        `${municipioNome || codMunIBGE}${uf ? ` — ${uf}` : ''}, código IBGE ${codMunIBGE}?`,
        '\n\nResponda SOMENTE com um JSON neste formato, sem texto antes ou depois:',
        '\n{"diaVencimento": <número de 1 a 31>, "mesesApos": <0 ou 1>,',
        ' "baseLegal": "<lei/decreto municipal com número e artigo>",',
        ' "observacao": "<uma frase, ou vazio>"}',
        '\n\nRegras: "mesesApos" é quantos meses depois da competência o imposto vence',
        ' (1 = competência de junho vence em julho). Se você não encontrar a norma',
        ' municipal, responda {"diaVencimento": null, "baseLegal": ""} — NÃO estime.',
    ].join('');
}

function extrairJson(texto) {
    const t = String(texto || '');
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * Lê a resposta do Gemini e devolve uma PROPOSTA — ou a recusa, com o motivo.
 *
 * @param {object} p
 * @param {string} p.texto      texto devolvido pelo modelo
 * @param {Array}  p.fontes     groundingChunks já normalizados [{uri, title}]
 * @param {object} [p.cadastroAtual]  o que já está no CFI (para mostrar a DIFERENÇA)
 * @returns {{ok: boolean, motivo?: string, proposta?: object, fontes: Array,
 *             diferenca?: object|null, avisos: string[]}}
 */
export function interpretarPropostaPrazo({ texto, fontes = [], cadastroAtual = null }) {
    const limpas = (fontes || [])
        .filter((f) => f && f.uri)
        .map((f) => ({ uri: f.uri, title: f.title || f.uri, oficial: ehFonteOficial(f.uri) }));

    // (1) PROPOSTA SEM FONTE É CHUTE. Sem busca, o modelo inventa prazo com a
    // mesma confiança com que acerta — e aqui o custo do chute é multa.
    if (limpas.length === 0) {
        return {
            ok: false, fontes: [], avisos: [],
            motivo: 'A consulta não trouxe NENHUMA fonte. Sem fonte não há proposta: '
                + 'o modelo responderia um prazo inventado com a mesma confiança de um certo. '
                + 'Consulte o site da prefeitura e cadastre à mão.',
        };
    }

    const j = extrairJson(texto);
    const dia = Number(j?.diaVencimento);
    // (3) DIA FORA DE 1–31 OU AUSENTE NÃO VIRA DEFAULT.
    if (!j || !Number.isInteger(dia) || dia < 1 || dia > 31) {
        return {
            ok: false, fontes: limpas, avisos: [],
            motivo: 'A consulta não devolveu um dia de vencimento legível. '
                + 'Campo de prazo não recebe chute — abra as fontes abaixo e cadastre à mão.',
        };
    }

    const avisos = [];
    // (2) FONTE NÃO OFICIAL VAI MARCADA, não escondida.
    if (!limpas.some((f) => f.oficial)) {
        avisos.push('Nenhuma fonte oficial (.gov.br) entre as citadas — o modelo pode ter lido blog '
            + 'ou site de escritório. CONFIRA na prefeitura antes de cadastrar.');
    }
    const baseLegal = String(j.baseLegal || '').trim();
    if (baseLegal.length < 5) {
        avisos.push('A consulta não trouxe a norma municipal (lei/decreto). O cadastro EXIGE a base legal — '
            + 'localize-a nas fontes antes de salvar.');
    }

    const mesesApos = Number.isInteger(Number(j.mesesApos)) ? Number(j.mesesApos) : 1;
    const proposta = {
        diaVencimento: dia,
        mesesApos,
        baseLegal,
        observacao: String(j.observacao || '').trim() || null,
    };

    // A DIFERENÇA contra o que já está cadastrado — é ela que o humano confirma.
    // Mostrar só a proposta faria alguém regravar o que já estava certo.
    let diferenca = null;
    if (cadastroAtual) {
        const mudou = [];
        if (Number(cadastroAtual.diaVencimento) !== dia) {
            mudou.push(`dia ${cadastroAtual.diaVencimento} → ${dia}`);
        }
        if (Number(cadastroAtual.mesesApos ?? 1) !== mesesApos) {
            mudou.push(`meses após ${cadastroAtual.mesesApos ?? 1} → ${mesesApos}`);
        }
        diferenca = {
            mudou: mudou.length > 0,
            campos: mudou,
            // Prazo que muda exige VIGÊNCIA NOVA, não edição da antiga: a
            // competência velha continua saindo com a regra que valia nela.
            acao: mudou.length
                ? 'Se confirmar, cadastre como VIGÊNCIA NOVA (não edite a antiga) — a competência anterior '
                  + 'continua saindo com a regra que valia nela.'
                : 'A consulta bate com o que já está cadastrado. Nada a fazer.',
        };
    }

    return { ok: true, proposta, fontes: limpas, diferenca, avisos };
}
