// ============================================================================
// sefaz-backend/iss-zerado-causa.js  (PURO — testável)
// ----------------------------------------------------------------------------
// POR QUE a NFS-e saiu com ISS zerado.
//
// O painel da carteira aprendeu a não chamar isso de "sem movimento" (#513) —
// mas parou no meio: virou um balde de 67 empresas com a mesma frase, "confira
// isenção/imunidade ou falha na captura antes de fechar o mês". Isso é meio
// farol. O colaborador vê 67 alertas iguais, não tem por onde começar, e
// alerta que não diz o que fazer a equipe aprende a ignorar.
//
// As causas são MUITO diferentes entre si, e a maioria NÃO PEDE AÇÃO NENHUMA:
//
//   optante          o ISS vai no DAS — a nota sai zerada porque É pra sair
//   retido           quem recolhe é o tomador (Lei 13.701/03 art. 9º §1º)
//   fora-de-sp       serviço prestado em outro município: ISS é de lá
//   deducao-integral base zerada por dedução (subempreitada, materiais)
//   aliquota-zero    a nota declara alíquota 0 — isenção/imunidade
//
// E duas PEDEM, porque são contradição dentro do próprio documento:
//
//   inconsistente    a nota diz que tributa (alíquota > 0) e o ISS veio ZERO
//   aliquota-ausente não veio alíquota nenhuma — ausente ≠ zero, e aqui a
//                    ausência é de CAPTURA, não do fato
//
// Tudo isto sai de campo que o importer JÁ GRAVA (codigoServico,
// aliquotaServicos, municipioPrestacaoIbge, prestadorOptanteSimples,
// valorDeducoes) — nenhuma captura nova, nenhuma consulta a mais.
// ============================================================================

const COD_MUN_SP_CAPITAL = '3550308';

/** Causas possíveis. A ordem é a de decisão — a primeira que casar vence. */
export const CAUSAS_ISS_ZERADO = [
    'retido', 'optante', 'fora-de-sp', 'sem-valor-servico', 'deducao-integral',
    'aliquota-ausente', 'inconsistente', 'aliquota-zero', 'indefinida',
];

/** Causas que EXIGEM alguém olhar. As outras são explicação, não pendência. */
const EXIGEM_ACAO = new Set(['aliquota-ausente', 'inconsistente', 'indefinida']);

const TEXTO = {
    retido: 'ISS retido pelo tomador — quem recolhe é quem contratou.',
    optante: 'Prestador optante do Simples pela própria nota — o ISS vai no DAS.',
    'fora-de-sp': 'Serviço prestado em outro município — o ISS é da prefeitura de lá.',
    'sem-valor-servico': 'Nota sem valor de serviço.',
    'deducao-integral': 'Dedução igual ou maior que o serviço — base de cálculo zerada.',
    'aliquota-ausente': 'A nota chegou SEM alíquota. Ausente não é zero: isso é buraco de captura, não isenção.',
    inconsistente: 'A nota diz que TRIBUTA (alíquota destacada) e o ISS veio ZERO — o documento se contradiz.',
    'aliquota-zero': 'Alíquota zero na própria nota — isenção ou imunidade pelo código de serviço.',
    indefinida: 'Não dá pra dizer por que o ISS está zerado com o que foi capturado.',
};

const num = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};

/**
 * Por que ESTA nota está com o ISS zerado.
 *
 * @param {object} d documento (forma achatada do portal ou objeto do XML)
 * @returns {{causa: string, texto: string, exigeAcao: boolean, codigoServico: string|null}}
 */
export function classificarIssZerado(d) {
    const v = d?.valores || {};
    const flagRetido = v.issRetido === true || d?.issRetido === true;
    const aliquota = num(d?.aliquotaServicos ?? v.aliquota);
    const servicos = num(d?.valorServicos ?? v.valorServicos ?? d?.valorTotal);
    const deducoes = num(d?.valorDeducoes ?? v.deducoes) ?? 0;
    const municipio = String(d?.municipioPrestacaoIbge || '').trim();
    const codigoServico = String(d?.codigoServico || '').trim() || null;

    let causa;
    if (flagRetido) causa = 'retido';
    else if (d?.prestadorOptanteSimples === true) causa = 'optante';
    else if (municipio && municipio !== COD_MUN_SP_CAPITAL) causa = 'fora-de-sp';
    else if (servicos !== undefined && servicos <= 0) causa = 'sem-valor-servico';
    else if (servicos !== undefined && deducoes > 0 && deducoes >= servicos) causa = 'deducao-integral';
    // Daqui pra baixo é a alíquota que decide — e ela é o campo em que
    // "ausente" e "zero" significam coisas opostas.
    else if (aliquota === undefined) causa = 'aliquota-ausente';
    else if (aliquota > 0) causa = 'inconsistente';
    else if (aliquota === 0) causa = 'aliquota-zero';
    else causa = 'indefinida';

    return { causa, texto: TEXTO[causa], exigeAcao: EXIGEM_ACAO.has(causa), codigoServico };
}

/**
 * Resumo das causas de um conjunto de notas zeradas.
 *
 * A `dominante` é escolhida entre as que EXIGEM AÇÃO, quando existe alguma —
 * é o farol honesto: o motivo que fica ao lado do número tem que ser aquele
 * que muda o que a pessoa vai fazer, não o mais numeroso. Empresa com 40 notas
 * de optante e 2 inconsistentes precisa ver as 2.
 */
export function resumirCausasIssZerado(notas) {
    const porCausa = {};
    let exigemAcao = 0;
    const codigos = new Set();
    for (const d of notas || []) {
        const c = classificarIssZerado(d);
        porCausa[c.causa] = (porCausa[c.causa] || 0) + 1;
        if (c.exigeAcao) exigemAcao += 1;
        if (c.codigoServico) codigos.add(c.codigoServico);
    }
    const total = (notas || []).length;

    const maior = (nomes) => nomes
        .filter((c) => porCausa[c])
        .sort((a, b) => porCausa[b] - porCausa[a])[0] || null;
    const dominante = maior(CAUSAS_ISS_ZERADO.filter((c) => EXIGEM_ACAO.has(c)))
        || maior(CAUSAS_ISS_ZERADO);

    return {
        total,
        porCausa,
        exigemAcao,
        dominante: dominante
            ? { causa: dominante, qtd: porCausa[dominante], texto: TEXTO[dominante] }
            : null,
        codigosServico: [...codigos].sort(),
        // Nenhuma nota pede ação ⇒ o zero está EXPLICADO. Isso é resposta, e
        // não pode continuar aparecendo como pendência.
        explicado: total > 0 && exigemAcao === 0,
    };
}

/**
 * DIVERGÊNCIA entre o cadastro e a FONTE (regra permanente: cadastro diz X, a
 * nota diz Y ⇒ acende, não escolhe sozinho).
 *
 * A própria NFS-e paulistana carrega se o prestador é optante do Simples. Se o
 * cadastro discorda dela, uma das duas está errada — e as duas respostas levam
 * a guias diferentes: optante recolhe o ISS no DAS, não-optante recolhe em
 * guia do município. Escolher no silêncio é emitir guia indevida ou deixar de
 * emitir a devida.
 *
 * @param {string} regimeCadastro 'simples' | 'lucro'
 * @param {Array}  notas saídas de NFS-e da empresa no período
 */
export function divergenciaRegimePelaNota(regimeCadastro, notas) {
    let optante = 0;
    let naoOptante = 0;
    for (const d of notas || []) {
        if (d?.prestadorOptanteSimples === true) optante += 1;
        else if (d?.prestadorOptanteSimples === false) naoOptante += 1;
    }
    // Sem o campo na captura não se afirma nada — silêncio não é prova.
    if (!optante && !naoOptante) return null;

    const cadastroSimples = String(regimeCadastro || '').toLowerCase() === 'simples';
    if (cadastroSimples && naoOptante > 0 && optante === 0) {
        return {
            divergente: true,
            cadastro: 'simples',
            nota: 'nao-optante',
            texto: `O cadastro diz SIMPLES e ${naoOptante} nota(s) do mês dizem que o prestador NÃO é optante. `
                + 'Se a nota estiver certa, há ISS em guia do município que este painel não está cobrando.',
        };
    }
    if (!cadastroSimples && optante > 0 && naoOptante === 0) {
        return {
            divergente: true,
            cadastro: 'lucro',
            nota: 'optante',
            texto: `O cadastro NÃO diz Simples e ${optante} nota(s) do mês dizem que o prestador é OPTANTE. `
                + 'Se a nota estiver certa, o ISS já vai no DAS e a guia cobrada aqui é indevida.',
        };
    }
    return { divergente: false, optante, naoOptante };
}
