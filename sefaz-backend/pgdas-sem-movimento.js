// ============================================================================
// sefaz-backend/pgdas-sem-movimento.js  (PURO — testável)
// ----------------------------------------------------------------------------
// DECLARAÇÃO E GUIA SÃO OBRIGAÇÕES DIFERENTES — e no app estavam soldadas.
//
// O PGDAS-D tem que ser entregue TODO MÊS, com ou sem faturamento. Não
// entregar custa MAED de R$ 50,00 por competência. Já o DAS só existe se
// houver o que pagar.
//
// No app, a transmissão do PGDAS-D só acontecia DENTRO do `emitirDasRegular`,
// que recusa valor abaixo de R$ 10,00 (`assertValorMinimoDas`). Resultado: mês
// sem movimento não passava pela porta, e a declaração ficava para o e-CAC, à
// mão — sem registro, sem auditoria e sem aparecer na Rotina do Mês.
//
// ═══ A TRAVA QUE MANDA AQUI ═════════════════════════════════════════════════
//
// "Sem movimento" é uma AFIRMAÇÃO À RECEITA: o contribuinte declara que não
// faturou. Fazer isso com base numa captura furada é declarar mentira — e a
// diferença entre "não faturou" e "não capturamos" NÃO está no valor zero.
// Ela está na SAÚDE DA CAPTURA.
//
// É a mesma lição da NFS-e SP, que ficou semanas verde com zero notas: zero
// nunca é resposta sozinho. Por isso este módulo RECUSA declarar quando a
// captura da competência não é confiável, e o motivo vai junto.
//
// E recusa também quando existe faturamento lançado ou nota capturada: aí não
// é mês sem movimento, é declaração normal — e deixar passar transformaria
// este caminho num atalho para escapar da conferência SERPRO × app.
// ============================================================================

/** Multa por declaração não entregue (MAED, mínimo). */
export const MAED_MINIMA = 50.0;

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/**
 * Pode declarar "sem movimento" nesta competência?
 *
 * @param {object} p
 * @param {number}  p.receitaLancada     receita lançada no app para a competência
 * @param {number}  p.notasCapturadas    documentos de SAÍDA capturados na competência
 * @param {boolean} p.capturaConfiavel   o zero da captura é confiável? (saúde do trilho)
 * @param {string}  [p.motivoCapturaIncerta] por que não é confiável
 * @param {boolean} [p.jaDeclarado]      já existe declaração transmitida no PA
 * @param {boolean} [p.confirmadoPeloColaborador] a pessoa afirmou que não houve faturamento
 * @returns {{pode, situacao, motivo, acao, alertas}}
 */
export function avaliarSemMovimento({
    receitaLancada,
    notasCapturadas,
    capturaConfiavel,
    motivoCapturaIncerta,
    jaDeclarado = false,
    confirmadoPeloColaborador = false,
} = {}) {
    const receita = num(receitaLancada);
    const notas = num(notasCapturadas);
    const alertas = [];

    if (receita > 0) {
        return recusa('tem-receita',
            `Há R$ ${receita.toFixed(2).replace('.', ',')} de receita lançada nesta competência — isto não é mês sem movimento.`,
            'Use a emissão normal do DAS. Se a receita está errada, corrija o lançamento antes.');
    }

    if (notas > 0) {
        return recusa('tem-nota-capturada',
            `${notas} nota(s) de saída capturada(s) nesta competência, mas nenhuma receita lançada.`,
            'Lance a receita dessas notas e emita pelo caminho normal. Declarar sem movimento com nota '
            + 'capturada é declarar à Receita algo que o próprio app desmente.');
    }

    // ─── A TRAVA PRINCIPAL ──────────────────────────────────────────────────
    // Zero sem captura confiável não prova ausência de faturamento: prova que
    // não sabemos. Declarar assim é afirmar à Receita o que não se apurou.
    if (!capturaConfiavel) {
        return recusa('captura-incerta',
            motivoCapturaIncerta
                ? `A captura desta competência não é confiável: ${motivoCapturaIncerta}`
                : 'A captura desta competência não é confiável, então o zero não prova ausência de faturamento.',
            'Resolva a captura primeiro (ou confirme com o cliente que não houve faturamento e registre '
            + 'a confirmação). Declarar sem movimento sobre captura furada é declaração falsa — e quem '
            + 'responde é o contribuinte.');
    }

    // Captura saudável e zero de verdade. Ainda assim, a AFIRMAÇÃO é humana:
    // o app prova que não capturou nada, não que a empresa não faturou.
    if (!confirmadoPeloColaborador) {
        return recusa('falta-confirmacao',
            'A captura está saudável e não há faturamento nesta competência.',
            'Confirme que o cliente realmente não faturou no mês. O app prova que NÃO CAPTUROU nada — '
            + 'quem afirma que não HOUVE faturamento é você.');
    }

    if (jaDeclarado) {
        alertas.push('Já existe declaração transmitida para esta competência. A transmissão será '
            + 'RETIFICADORA — o SERPRO detecta e o app acompanha.');
    }

    return {
        pode: true,
        situacao: 'pode-declarar',
        motivo: 'Sem faturamento na competência, captura saudável e confirmação registrada.',
        acao: null,
        alertas,
    };
}

function recusa(situacao, motivo, acao) {
    return { pode: false, situacao, motivo, acao, alertas: [] };
}

/**
 * A declaração de um mês sem movimento: tudo zerado, mas com os
 * estabelecimentos presentes.
 *
 * POR QUE OS ESTABELECIMENTOS IMPORTAM MESMO ZERADOS: o SN-Entregar exige
 * TODOS os estabelecimentos do CNPJ no payload — foi o erro MSG_ISN_018 do
 * caso BRISKA (matriz + filial). Mês sem movimento não muda essa exigência.
 *
 * @param {object} p
 * @param {string} p.cnpj        matriz
 * @param {string[]} [p.filiais] CNPJs das filiais
 */
export function montarDeclaracaoSemMovimento({ cnpj, filiais = [] } = {}) {
    const limpo = String(cnpj ?? '').replace(/\D/g, '');
    if (limpo.length !== 14) {
        throw new Error('CNPJ da matriz é obrigatório (14 dígitos) para declarar sem movimento.');
    }
    const estabelecimentos = [limpo, ...filiais.map((f) => String(f ?? '').replace(/\D/g, ''))]
        .filter((c, i, arr) => c.length === 14 && arr.indexOf(c) === i)
        .map((cnpjCompleto) => ({ cnpjCompleto, atividades: [] }));

    return {
        // tipoDeclaracao é decidido pelo provider (Original x Retificadora).
        receitaPaCompetenciaInterno: 0,
        receitaPaCompetenciaExterno: 0,
        receitaPaCaixaInterno: null,
        receitaPaCaixaExterno: null,
        valorFixoIcms: null,
        valorFixoIss: null,
        receitasBrutasAnteriores: [],
        estabelecimentos,
    };
}


// ────────────────────────────────────────────────────────────────────────────
// O QUE O SERPRO RECUSOU, E O QUE FAZER
//
// Primeira transmissão real (07/08, ELS COMERCIO DE BANANAS 07/2026):
//
//   SERPRO 400: [EntradaIncorreta-PGDASD-MSG_ISN_023] - SN-Entregar:
//   O valor da atividade deve ser maior que zero.
//
// O app enviou a declaração zerada com `estabelecimentos: [{cnpj, atividades:
// []}]` — nenhuma atividade, nenhum valor. O SN-Entregar recusou mesmo assim,
// e isso diz que a FORMA da declaração sem movimento não é a que eu supus.
//
// NÃO VOU ADIVINHAR A FORMA CERTA. Mexer no payload por tentativa e erro numa
// entrega ao PGDAS-D é o oposto da regra da casa: entrega não se desfaz, e uma
// declaração aceita com estrutura errada é pior que uma recusada.
//
// DESTRAVA COM: o extrato/recibo de um PGDAS-D sem movimento já transmitido
// (o e-CAC mostra o XML da declaração), ou o manual do SN-Entregar na parte de
// ausência de movimento. Foi assim que o R-4020 destravou — arquivo aceito
// vale mais que leiaute deduzido.
// ────────────────────────────────────────────────────────────────────────────

/** Traduz a recusa do SERPRO em algo que a pessoa consiga atender. */
export function interpretarRecusaSemMovimento(mensagemSerpro) {
    const txt = String(mensagemSerpro ?? '');
    if (/MSG_ISN_023|valor da atividade deve ser maior que zero/i.test(txt)) {
        return {
            conhecida: true,
            codigo: 'MSG_ISN_023',
            mensagem: 'O SN-Entregar recusou a declaração sem movimento: ele exige atividade com valor '
                + 'maior que zero, e mês sem faturamento não tem nenhuma. A forma correta da declaração '
                + 'sem movimento ainda não está confirmada neste app — nada foi transmitido.',
            // ⚠️ ANTES pedia "o extrato de um PGDAS-D sem movimento". Paulo, 12/08:
            // **sem movimento NÃO gera extrato** — o app estava mandando o
            // colaborador buscar um documento que não existe, e pedido impossível
            // vira pedido ignorado. O que existe é o RECIBO/declaração; e o que
            // resolve de verdade é a consulta do próprio app numa competência já
            // aceita, que devolve a estrutura que o SERPRO aceitou.
            acao: 'Entregue ESTA competência no e-CAC (PGDAS-D → Declarar → sem movimento) para não '
                + 'correr a MAED de R$ 50,00. Para destravar o botão: depois de entregar, abra a ficha '
                + 'do Simples desta empresa e clique em "🔎 Atividades declaradas" NESSA competência — '
                + 'com a declaração já aceita, a consulta devolve a estrutura que o SERPRO aceitou e a '
                + 'forma certa sai no mesmo dia. (Sem movimento não gera extrato; o que existe é o '
                + 'recibo da declaração.)',
        };
    }
    return {
        conhecida: false,
        codigo: null,
        mensagem: `O SERPRO recusou a declaração: ${txt || 'sem detalhe'}`,
        acao: 'Nada foi transmitido. Entregue esta competência no e-CAC e reporte a mensagem — '
            + 'recusa que ninguém traduz vira recusa que ninguém resolve.',
    };
}
