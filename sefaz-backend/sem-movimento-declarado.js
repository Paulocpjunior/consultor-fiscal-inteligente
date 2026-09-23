// ============================================================================
// sefaz-backend/sem-movimento-declarado.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 📭 DECLARAR QUE A EMPRESA NÃO TEVE MOVIMENTO NA COMPETÊNCIA.
//
// ═══ O CASO (Paulo, 23/09, E7 ASSESSORIA ESPORTIVA 08/2026) ═════════════════
//
// *"o que precisamos agora é com relação ao fechamento de mês de empresas sem
// movimento"*. A Rotina dizia: etapa 1 *"Nenhuma nota capturada nesta
// competência"* (vermelha) e etapa 2 *"Sem notas para validar — conclua a
// captura primeiro"* (vermelha). Apuração e obrigações verdes, guia "não se
// aplica". E o fim de mês TRANCADO — para sempre, porque não há nota a
// capturar: a empresa não emitiu nem recebeu nada.
//
// ═══ POR QUE NÃO SE FECHA SOZINHO — e é a regra da casa ═════════════════════
//
// "Zero nota" NÃO é "sem movimento": ausência ≠ zero. A captura pode ter
// falhado (certificado, agente A3 que não rodou, município sem trilho), e o
// app não tem como distinguir "não emitiu" de "não capturei". Fechar verde
// por conta própria seria o silêncio virando sucesso — o defeito mais caro.
//
// ═══ A SAÍDA, no mesmo molde do envio e da cobertura declarados ═════════════
//
// Quem SABE que não houve movimento é a pessoa (confirmou com o cliente,
// consultou o portal). Ela DECLARA: texto com o piso da casa, data que não
// está no futuro, autor. A declaração fecha as etapas 1 e 2 como "não se
// aplica" — NOMEADA no resumo, com quem e quando — e o mês pode fechar.
//
// ⚠️ E A DECLARAÇÃO CAI SOZINHA se documento chegar depois: uma nota que
// entra em outubro para agosto derruba o "sem movimento" de agosto, e a etapa
// volta a acusar com a ressalva dita. Declaração não é quitação eterna.
//
// ⚠️ SÓ É OFERECIDA ONDE RESOLVE: com ZERO documento na competência. Empresa
// com nota capturada não é "sem movimento", e oferecer a porta ali seria
// convidar a declarar por cima do que existe.
// ============================================================================

/** Piso do texto livre — o mesmo do envio, da cobertura e da reabertura. */
export const MOTIVO_MINIMO = 15;

const ehData = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

/**
 * A etapa 1 admite declaração de "sem movimento"?
 *
 * @param {object} p
 * @param {Array}  p.documentos os documentos da competência
 * @param {object} p.captura    a etapa 'captura' montada pela Rotina
 * @returns {boolean} true só com ZERO documento e captura ainda cobrando
 */
export function podeDeclararSemMovimento({ documentos = [], captura = null } = {}) {
    if ((documentos || []).length > 0) return false;
    if (!captura) return false;
    // Locação pura já fecha como 'na' por conta própria; declarar por cima
    // não acrescenta nada e esconderia a causa real (a receita é de aluguel).
    if (captura.status === 'na' || captura.status === 'concluida') return false;
    if (captura.semMovimentoDeclarado) return false;
    return true;
}

/**
 * Confere a declaração ANTES de gravar.
 *
 * @param {object} p
 * @param {string} p.comoFoi   texto livre — como se soube que não houve movimento
 * @param {string} p.quando    'AAAA-MM-DD' — quando isso foi confirmado
 * @param {string} p.quem      e-mail/uid de quem declara
 * @param {string} [p.hojeIso] 'AAAA-MM-DD' (para o teste; default = hoje)
 * @returns {{ok: true, declaracao: object} | {ok: false, erro: string}}
 */
export function conferirDeclaracaoSemMovimento({ comoFoi, quando, quem, hojeIso } = {}) {
    const texto = String(comoFoi || '').trim();
    if (texto.length < MOTIVO_MINIMO) {
        return {
            ok: false,
            erro: `Diga COMO soube que não houve movimento (mínimo ${MOTIVO_MINIMO} caracteres) — `
                + '"o cliente confirmou por e-mail", "consultei o portal da prefeitura"… é o que responde a pergunta daqui a três meses.',
        };
    }
    if (!ehData(quando)) {
        return { ok: false, erro: 'Informe a data em que confirmou (AAAA-MM-DD).' };
    }
    const hoje = ehData(hojeIso) ? String(hojeIso) : new Date().toISOString().slice(0, 10);
    if (String(quando) > hoje) {
        return { ok: false, erro: 'A data está no futuro — declare o que já foi confirmado.' };
    }
    const autor = String(quem || '').trim();
    if (!autor) return { ok: false, erro: 'Sessão sem usuário — saia e entre de novo para declarar.' };
    return {
        ok: true,
        declaracao: {
            comoFoi: texto.slice(0, 600),
            quando: String(quando),
            declaradoPor: autor,
        },
    };
}

const dataBr = (iso) => {
    const [a, m, d] = String(iso || '').split('-');
    return a && m && d ? `${d}/${m}/${a}` : String(iso || '');
};

/** A frase que fica no resumo da etapa e na tela de quem declarou. */
export function textoDaDeclaracaoSemMovimento(d) {
    if (!d) return '';
    return `Sem movimento DECLARADO por ${d.declaradoPor} em ${dataBr(d.quando)}: "${d.comoFoi}". `
        + 'O app não capturou documento nenhum nesta competência e NÃO tem prova de que nada foi emitido ou recebido.';
}

/**
 * Aplica a declaração às etapas 1 e 2 — ou a derruba, dito.
 *
 * @param {object} p
 * @param {object} p.captura    etapa 'captura' já montada (com ISS aplicado)
 * @param {object} p.validacao  etapa 'validacao' já montada
 * @param {Array}  p.documentos documentos da competência
 * @param {object|null} p.declaracao a declaração gravada, ou null
 * @returns {{captura: object, validacao: object, aplicada: boolean, caiu: boolean}}
 */
export function aplicarSemMovimentoDeclarado({ captura, validacao, documentos = [], declaracao = null }) {
    if (!declaracao) return { captura, validacao, aplicada: false, caiu: false };
    const docs = documentos || [];
    if (docs.length > 0) {
        // ⚠️ A declaração CAIU: chegou documento depois dela. A etapa segue a
        // régua normal e a ressalva vai dita — quem declarou precisa saber.
        return {
            captura: {
                ...captura,
                resumo: `${captura.resumo || ''} ⚠️ Havia declaração de SEM MOVIMENTO por ${declaracao.declaradoPor} `
                    + `em ${dataBr(declaracao.quando)}, e ${docs.length} documento(s) chegaram depois — a declaração caiu.`,
                semMovimentoCaiu: true,
                declaracaoSemMovimento: declaracao,
            },
            validacao,
            aplicada: false,
            caiu: true,
        };
    }
    // Locação pura já é 'na' por si; a declaração só acrescenta o carimbo.
    return {
        captura: {
            ...captura,
            status: 'na',
            resumo: textoDaDeclaracaoSemMovimento(declaracao)
                + (captura.status !== 'na' && captura.resumo ? ` (antes: ${captura.resumo})` : ''),
            acao: null,
            semMovimentoDeclarado: true,
            declaracaoSemMovimento: declaracao,
            podeDeclararSemMovimento: false,
        },
        validacao: {
            ...validacao,
            status: 'na',
            resumo: 'Sem movimento declarado — não há nota a validar.',
            acao: null,
            semMovimentoDeclarado: true,
        },
        aplicada: true,
        caiu: false,
    };
}
