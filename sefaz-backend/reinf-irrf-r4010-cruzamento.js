// ============================================================================
// sefaz-backend/reinf-irrf-r4010-cruzamento.js   (PURO — sem io, testável)
//
// R-4010 (IRRF de pessoa física) × IRRF de PF declarado na DCTFWeb.
//
// POR QUE (Paulo, 12/08/2026, depois de ver o e-CAC com os beneficiários um por
// um e o CFI com nada): a EFD-Reinf é a FONTE do IRRF de pagamento a PF e a
// DCTFWeb é alimentada por ela. Evento que não chegou = débito a MENOS na
// declaração, ou seja recolhimento a menor — e ninguém percebe, porque as duas
// telas ficam em sistemas diferentes.
//
// ─── AS TRÊS HONESTIDADES ───────────────────────────────────────────────────
//
// 1. **O TOTAL DA REINF SÓ VALE PELO QUE FOI LIDO.** Este módulo cruza os
//    eventos que ALGUÉM SUBIU. Se faltar arquivo, o lado Reinf sai a menos e a
//    diferença aponta pro lado errado. Por isso o veredito de "falta evento" só
//    é dado quando o conjunto se declara COMPLETO; sem isso, a resposta é
//    "cobertura parcial", que não acusa ninguém.
// 2. **DIFERENÇA NÃO É CULPA.** A DCTFWeb pode ter débito legítimo que não vem
//    de R-4010 (o de-para de código não é oficial — ver irrf-dctfweb-familias).
//    Então o resultado nomeia o QUE está de cada lado, em vez de decretar erro.
// 3. **ZERO DE UM LADO É PERGUNTA, NÃO EMPATE.** Reinf 0 × DCTFWeb 0 pode ser
//    "não houve pagamento a PF" ou "ninguém subiu arquivo e a declaração está a
//    zero" — casos opostos. O veredito distingue.
// ============================================================================

const r2 = (n) => Number((Math.round((Number(n) || 0) * 100) / 100).toFixed(2));
const soDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');

/** Centavo: diferença até 1 centavo é arredondamento, não divergência. */
const TOLERANCIA = 0.01;

/**
 * Consolida o lado REINF a partir dos eventos já parseados (parseEventoReinf).
 *
 * Só entram eventos R-4010. Retificador (indRetif=2) SUBSTITUI o original do
 * mesmo beneficiário/competência — somar os dois contaria a retenção duas vezes,
 * que é exatamente o defeito que o FUNRURAL dobrado ensinou.
 */
export function consolidarR4010(eventos = []) {
    const porBeneficiario = new Map();
    const ignorados = [];
    const retificados = [];

    // Original primeiro; retificador depois sobrescreve o mesmo beneficiário.
    const r4010 = eventos.filter((e) => e?.ok && e.codigo === 'R-4010');
    const ordenados = [
        ...r4010.filter((e) => String(e.ideEvento?.indRetif || '1') !== '2'),
        ...r4010.filter((e) => String(e.ideEvento?.indRetif || '1') === '2'),
    ];

    for (const ev of eventos) {
        if (!ev?.ok) { ignorados.push({ motivo: ev?.observacoes?.[0] || 'evento ilegível' }); continue; }
        if (ev.codigo !== 'R-4010') {
            ignorados.push({ codigo: ev.codigo, motivo: `${ev.codigo || 'evento não mapeado'} não é R-4010` });
        }
    }

    for (const ev of ordenados) {
        const ehRetif = String(ev.ideEvento?.indRetif || '1') === '2';
        for (const linha of ev.retencoes || []) {
            const doc = soDigitos(linha.beneficiario);
            if (!doc) continue;
            const atual = porBeneficiario.get(doc);
            if (ehRetif && atual) retificados.push(doc);
            const base = (ehRetif || !atual)
                ? { beneficiario: doc, nome: linha.nome || atual?.nome || '', bruto: 0, irrf: 0, pagamentos: 0, retificado: ehRetif }
                : atual;
            if (ehRetif && atual) { base.bruto = 0; base.irrf = 0; base.pagamentos = 0; }
            base.bruto = r2(base.bruto + (Number(linha.bruto) || 0));
            base.irrf = r2(base.irrf + (Number(linha.irrf) || 0));
            base.pagamentos += 1;
            if (linha.nome && !base.nome) base.nome = linha.nome;
            porBeneficiario.set(doc, base);
        }
    }

    const beneficiarios = Array.from(porBeneficiario.values())
        .sort((a, b) => b.irrf - a.irrf);
    return {
        beneficiarios,
        eventosLidos: r4010.length,
        totalIrrf: r2(beneficiarios.reduce((s, b) => s + b.irrf, 0)),
        retificados: Array.from(new Set(retificados)),
        ignorados,
    };
}

/**
 * Cruza o consolidado do R-4010 com o IRRF de PF da DCTFWeb.
 *
 * @param {object} p
 * @param {object} p.reinf              saída de `consolidarR4010`
 * @param {object} p.dctfweb            saída de `separarIrrfDctfweb`
 * @param {boolean} [p.dctfwebLido]     false = não deu pra ler a declaração
 * @param {boolean} [p.conjuntoCompleto=false] o usuário afirma que subiu TODOS
 *                                      os eventos R-4010 da competência
 */
export function cruzarIrrfR4010({ reinf, dctfweb, dctfwebLido = true, conjuntoCompleto = false }) {
    const totalReinf = r2(reinf?.totalIrrf || 0);
    const totalDctfweb = r2(dctfweb?.totais?.pf || 0);
    const diferenca = r2(totalReinf - totalDctfweb);

    // Declaração ilegível: NUNCA vira divergência. Sem os dois lados não há
    // cruzamento — só um lado e uma pergunta.
    if (!dctfwebLido) {
        return {
            veredito: 'sem-dctfweb-legivel',
            totalReinf, totalDctfweb: null, diferenca: null,
            severidade: 'atencao',
            mensagem: 'A declaração da DCTFWeb não pôde ser lida — sem ela não existe cruzamento. '
                + 'O total do R-4010 acima é só o lado da Reinf.',
            acao: 'Confira a declaração no e-CAC ou sincronize a competência antes de concluir qualquer coisa.',
            ressalvas: ressalvasComuns({ reinf, dctfweb, conjuntoCompleto }),
        };
    }

    if (totalReinf === 0 && totalDctfweb === 0) {
        return {
            veredito: 'nada-dos-dois-lados',
            totalReinf, totalDctfweb, diferenca: 0,
            severidade: 'atencao',
            // Zero dos dois lados NÃO é "está tudo certo": pode ser que ninguém
            // tenha subido evento nenhum. Mesma lição do "sem movimento".
            mensagem: reinf?.eventosLidos
                ? 'Nenhum IRRF de PF nos eventos lidos e nenhum na declaração — coerente, mas zero não prova ausência.'
                : 'Nenhum evento R-4010 foi lido e a declaração não tem IRRF de PF: isso NÃO é conferência, '
                  + 'é ausência dos dois lados.',
            acao: reinf?.eventosLidos
                ? 'Se houve pagamento a pessoa física na competência, o evento está faltando.'
                : 'Suba os XMLs dos eventos R-4010 da competência para haver o que cruzar.',
            ressalvas: ressalvasComuns({ reinf, dctfweb, conjuntoCompleto }),
        };
    }

    if (Math.abs(diferenca) <= TOLERANCIA) {
        return {
            veredito: 'confere',
            totalReinf, totalDctfweb, diferenca: 0,
            severidade: conjuntoCompleto ? 'ok' : 'atencao',
            mensagem: conjuntoCompleto
                ? 'O IRRF de PF dos eventos R-4010 bate com o declarado na DCTFWeb.'
                : 'Os valores batem NO QUE FOI LIDO — e isso não é o mesmo que estar completo: '
                  + 'o cruzamento só viu os eventos que foram subidos.',
            acao: conjuntoCompleto
                ? 'Nada a fazer neste item.'
                : 'Marque que o conjunto de eventos está completo, ou suba os que faltam, para o farol poder ficar verde.',
            ressalvas: ressalvasComuns({ reinf, dctfweb, conjuntoCompleto }),
        };
    }

    if (diferenca > 0) {
        return {
            veredito: 'reinf-maior',
            totalReinf, totalDctfweb, diferenca,
            severidade: 'alta',
            // Este é o caso de RISCO: retenção declarada na Reinf que não virou
            // débito — recolhimento a menor.
            mensagem: `A Reinf declara ${brl(diferenca)} de IRRF de PF a MAIS do que a DCTFWeb cobra. `
                + 'Retenção sem débito correspondente é recolhimento a menor.',
            acao: 'Confira se o evento foi processado e se o fechamento (R-4099) da competência foi transmitido — '
                + 'evento aceito sem fechamento não alimenta a DCTFWeb.',
            ressalvas: ressalvasComuns({ reinf, dctfweb, conjuntoCompleto }),
        };
    }

    return {
        veredito: 'dctfweb-maior',
        totalReinf, totalDctfweb, diferenca,
        // Só é grave se o conjunto foi declarado completo; senão o mais provável
        // é faltar arquivo do lado da Reinf, e acusar aqui seria culpar o certo.
        severidade: conjuntoCompleto ? 'alta' : 'atencao',
        mensagem: `A DCTFWeb cobra ${brl(Math.abs(diferenca))} de IRRF de PF a mais do que os eventos lidos mostram.`,
        acao: conjuntoCompleto
            ? 'Débito sem evento de origem: confira no e-CAC de onde vem essa linha antes de pagar ou retificar.'
            : 'Provavelmente falta subir evento R-4010 — complete o conjunto antes de tratar como divergência.',
        ressalvas: ressalvasComuns({ reinf, dctfweb, conjuntoCompleto }),
    };
}

function ressalvasComuns({ reinf, dctfweb, conjuntoCompleto }) {
    const out = [];
    if (!conjuntoCompleto) {
        out.push('Cobertura PARCIAL: o cruzamento só vê os eventos R-4010 que foram subidos aqui. '
            + 'Ausência de divergência não prova que a competência está completa.');
    }
    if (dctfweb?.naoClassificado?.length) {
        out.push(`${dctfweb.naoClassificado.length} linha(s) de IRRF da declaração ficaram FORA da conta `
            + 'porque não deu pra dizer a origem (código fora do de-para ou descrição em conflito). '
            + 'Elas aparecem nomeadas — somar por engano criaria divergência falsa.');
    }
    if (dctfweb?.totais?.folha) {
        out.push(`IRRF de folha (${brl(dctfweb.totais.folha)}) NÃO entra: vem do eSocial, não do R-4010.`);
    }
    if (dctfweb?.totais?.pj) {
        out.push(`IRRF de PJ (${brl(dctfweb.totais.pj)}) NÃO entra: é R-4020, outro evento.`);
    }
    if (reinf?.retificados?.length) {
        out.push(`${reinf.retificados.length} beneficiário(s) com evento RETIFICADOR: valeu o retificador, `
            + 'o original foi descartado (somar os dois contaria a retenção duas vezes).');
    }
    const naoR4010 = (reinf?.ignorados || []).filter((i) => i.codigo);
    if (naoR4010.length) {
        out.push(`${naoR4010.length} arquivo(s) subido(s) não são R-4010 e ficaram de fora desta conta.`);
    }
    return out;
}

const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
