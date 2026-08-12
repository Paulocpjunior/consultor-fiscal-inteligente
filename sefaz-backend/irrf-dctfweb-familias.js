// ============================================================================
// sefaz-backend/irrf-dctfweb-familias.js   (PURO — sem io, testável)
//
// De-para IRRF: qual DÉBITO da DCTFWeb corresponde a qual EVENTO de origem.
//
// POR QUE EXISTE (Paulo, 12/08/2026): pra cruzar o R-4010 contra o IRRF da
// DCTFWeb é preciso primeiro saber QUAL linha da declaração é IRRF de pessoa
// FÍSICA. O normalizador de retenção só conhecia o 1708 ("IRRF - REMUNER SERV
// PRESTADOS POR PJ"), que é R-4020 — então as linhas de PF do e-CAC (aluguéis,
// trabalho sem vínculo) não entravam em conta nenhuma, e um cruzamento ingênuo
// diria "a Reinf declarou e a DCTFWeb não tem", que é falso.
//
// ─── A REGRA QUE MANDA AQUI ─────────────────────────────────────────────────
//
// O de-para "código de receita → evento que originou o débito" NÃO é uma tabela
// oficial que eu tenha. Então este módulo:
//
//   1. classifica pelo que a PRÓPRIA DECLARAÇÃO diz — a descrição do tributo
//      (`ctDescricaoTributo`) é evidência de primeira classe: "PAGOS A PF" e
//      "SEM VÍNCULO EMPREGATÍCIO" são pagamento a pessoa física; "POR PJ" é
//      pessoa jurídica; "TRB ASSAL" é folha (eSocial, não Reinf);
//   2. usa o código só como CORROBORAÇÃO. Código e descrição discordando NÃO
//      viram escolha silenciosa: a linha vai pra `nao-classificado` com o
//      motivo. Chutar aqui produziria divergência inventada — o pior defeito
//      de uma conferência, porque manda procurar erro que não existe;
//   3. código desconhecido também é `nao-classificado`, nomeado e visível: ele
//      NÃO entra nem no total de PF nem no de PJ. Somar por engano faria a
//      conferência acusar diferença onde só falta cadastro de código.
//
// Fontes de cada entrada estão no campo `fonte` — é ele que diz o que foi
// conferido contra arquivo real e o que veio da leitura da descrição.
// ============================================================================

/** Raiz do código de receita (4 primeiros dígitos) → origem do débito. */
const CODIGO_ORIGEM = {
    // Conferido contra XML real do CONSXMLDECLARACAO (dctfweb-retencao-normalizer).
    1708: { familia: 'irrf-pj-r4020', fonte: 'XML real do CONSXMLDECLARACAO', confianca: 'alta' },
    5610: { familia: 'irrf-folha-esocial', fonte: 'XML real do CONSXMLDECLARACAO', confianca: 'alta' },
    // Lidos do extrato do e-CAC (DCTFWeb 07/2026) — a descrição diz a natureza.
    561: { familia: 'irrf-folha-esocial', fonte: 'descrição da declaração (e-CAC)', confianca: 'media' },
    588: { familia: 'irrf-pf-r4010', fonte: 'descrição da declaração (e-CAC)', confianca: 'media' },
    3208: { familia: 'irrf-pf-r4010', fonte: 'descrição da declaração (e-CAC)', confianca: 'media' },
};

const norm = (s) => String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase();

/** O que a DESCRIÇÃO do tributo afirma sobre a natureza do beneficiário. */
export function familiaPelaDescricao(descricao) {
    const d = norm(descricao);
    if (!d.includes('IRRF') && !d.includes('IMPOSTO DE RENDA')) return null;
    // Ordem importa: "ASSAL" (folha) antes de qualquer coisa de PF, porque
    // salário também é pago a pessoa física — e vai pelo eSocial, não pelo R-4010.
    if (/\bASSAL/.test(d) || d.includes('FOLHA')) return 'irrf-folha-esocial';
    if (/\bPJ\b/.test(d) || d.includes('PESSOA JURIDICA')) return 'irrf-pj-r4020';
    if (/\bPF\b/.test(d) || d.includes('PESSOA FISICA') || d.includes('SEM VINCULO')) return 'irrf-pf-r4010';
    return null;
}

/**
 * Classifica UM débito da declaração.
 *
 * @param {{codReceita?:string, codigo?:string, descricao?:string, valor?:number}} debito
 * @returns {{familia:string, motivo:string, fonte:string|null, confianca:string|null}}
 */
export function classificarIrrfDctfweb(debito) {
    const cod = String(debito?.codigo || debito?.codReceita || '').replace(/\D/g, '').slice(0, 4);
    const raiz = Number(cod);
    const daTabela = Number.isFinite(raiz) && raiz > 0 ? CODIGO_ORIGEM[raiz] : null;
    const daDescricao = familiaPelaDescricao(debito?.descricao);

    if (!daTabela && !daDescricao) {
        return {
            familia: 'nao-classificado',
            motivo: `Código ${cod || '?'} não está no de-para de IRRF e a descrição não diz a natureza `
                + '— fica FORA dos dois totais até alguém dizer de onde vem esse débito.',
            fonte: null, confianca: null,
        };
    }
    if (daTabela && daDescricao && daTabela.familia !== daDescricao) {
        // Divergência é ALERTA de primeira classe, nunca escolha silenciosa.
        return {
            familia: 'nao-classificado',
            motivo: `Código ${cod} está mapeado como ${rotulo(daTabela.familia)}, mas a descrição `
                + `("${debito?.descricao || ''}") indica ${rotulo(daDescricao)}. Confira antes de cruzar.`,
            fonte: null, confianca: null,
        };
    }
    // A descrição vence quando o código é desconhecido: ela é o que a própria
    // declaração afirma.
    const escolhida = daTabela || { familia: daDescricao, fonte: 'descrição da declaração', confianca: 'media' };
    return {
        familia: escolhida.familia,
        motivo: rotulo(escolhida.familia),
        fonte: escolhida.fonte,
        confianca: escolhida.confianca,
    };
}

export function rotulo(familia) {
    return {
        'irrf-pf-r4010': 'IRRF de pessoa física (R-4010)',
        'irrf-pj-r4020': 'IRRF de pessoa jurídica (R-4020)',
        'irrf-folha-esocial': 'IRRF de folha (eSocial)',
        'nao-classificado': 'origem não classificada',
    }[familia] || familia;
}

/**
 * Separa os débitos da declaração por origem do IRRF.
 *
 * O que NÃO é IRRF (previdenciária, terceiros, PIS…) sai em `outros` — não é
 * problema, só não é assunto deste cruzamento.
 */
export function separarIrrfDctfweb(debitos = []) {
    const grupos = {
        'irrf-pf-r4010': [], 'irrf-pj-r4020': [], 'irrf-folha-esocial': [], 'nao-classificado': [],
    };
    const outros = [];
    for (const d of debitos) {
        const ehIrrf = /IRRF|IMPOSTO DE RENDA/.test(norm(d?.descricao))
            || CODIGO_ORIGEM[Number(String(d?.codigo || '').replace(/\D/g, ''))];
        if (!ehIrrf) { outros.push(d); continue; }
        const c = classificarIrrfDctfweb(d);
        grupos[c.familia].push({ ...d, ...c });
    }
    const soma = (lista) => Number(lista.reduce((s, d) => s + (Number(d.valor) || 0), 0).toFixed(2));
    return {
        pf: grupos['irrf-pf-r4010'],
        pj: grupos['irrf-pj-r4020'],
        folha: grupos['irrf-folha-esocial'],
        naoClassificado: grupos['nao-classificado'],
        outros,
        totais: {
            pf: soma(grupos['irrf-pf-r4010']),
            pj: soma(grupos['irrf-pj-r4020']),
            folha: soma(grupos['irrf-folha-esocial']),
            naoClassificado: soma(grupos['nao-classificado']),
        },
    };
}

export const _internals = { CODIGO_ORIGEM };
