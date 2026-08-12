// ============================================================================
// sefaz-backend/pgdas-sonda-sem-movimento.js   (PURO — sem I/O)
// ----------------------------------------------------------------------------
// A SONDA que destrava o "Declarar sem movimento" SEM entregar nada.
//
// ═══ POR QUE ISTO NÃO É "CHUTAR PAYLOAD" ════════════════════════════════════
//
// A regra da casa é: **entrega ao PGDAS-D não se desfaz**, então não se
// adivinha o payload. Ela continua valendo — e é justamente por isso que esta
// sonda existe, em vez de tentativa e erro no botão de declarar.
//
// O `TRANSDECLARACAO11` tem DOIS modos, e o app já usa os dois:
// `indicadorTransmissao: false` **valida** e `true` **entrega**. A MSG_ISN_023
// que a ELS COMERCIO DE BANANAS recebe vem da VALIDAÇÃO — por isso a mensagem
// sempre pôde dizer "nada foi transmitido", e é verdade.
//
// Ou seja: existe um oráculo que responde "esta forma serve?" sem custo
// fiscal. Perguntar a ele não é deduzir — é a mesma técnica que destravou o
// R-2055 (sondas em produção restrita) e o código 9 do ISS fixo (ler a fonte
// que não mente, em vez de inferir). O que muda o jogo é que **quem responde é
// o SERPRO**, e a resposta é PROVA.
//
// ═══ AS TRAVAS DESTE MÓDULO ═════════════════════════════════════════════════
//
// 1. Toda hipótese nasce com o NOME do que ela testa e o PORQUÊ. Candidato sem
//    hipótese é chute com outro nome.
// 2. A sonda NUNCA transmite. `indicadorTransmissao` é fixado em false pelo
//    chamador e conferido aqui (`assertSondaNaoTransmite`) — uma sonda que
//    entrega por engano seria pior que o bloqueio que ela quer resolver.
// 3. Recusa também é RESPOSTA: o código da mensagem (MSG_ISN_xxx) diz o que o
//    SN-Entregar não aceitou, e é isso que estreita o campo. A sonda guarda o
//    retorno de cada candidato — inclusive o cru, quando o código é novo.
// 4. Nenhum candidato "vence" por eliminação silenciosa: se nenhum passar, o
//    veredito diz isso, e o botão continua bloqueado.
// ============================================================================

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/** Base comum: o que já é certo em qualquer declaração do PGDAS-D. */
function baseDeclaracao({ cnpj, filiais = [] }) {
    const matriz = soDigitos(cnpj);
    const todos = [matriz, ...filiais.map(soDigitos)].filter((c) => c.length === 14);
    const unicos = [...new Set(todos)];
    return {
        // Os estabelecimentos são exigência conhecida (MSG_ISN_018, caso BRISKA
        // 09/07): o SN-Entregar quer TODOS, mesmo sem receita.
        estabelecimentos: unicos.map((cnpjCompleto) => ({ cnpjCompleto, atividades: [] })),
        receitaPaCompetenciaInterno: 0,
        receitaPaCompetenciaExterno: 0,
        receitaPaCaixaInterno: null,
        receitaPaCaixaExterno: null,
        valorFixoIcms: null,
        valorFixoIss: null,
        receitasBrutasAnteriores: [],
    };
}

/**
 * Os candidatos, na ordem em que vale perguntar.
 *
 * Cada um responde a uma leitura DIFERENTE da MSG_ISN_023 ("O valor da
 * atividade deve ser maior que zero"). Ela é estranha justamente porque o app
 * manda `atividades: []` — se não há atividade, essa checagem não deveria
 * disparar. Logo, ou o SN-Entregar exige pelo menos uma atividade (e então
 * "sem movimento" não se expressa por lista vazia), ou existe uma marcação
 * própria que desliga a checagem.
 */
export function candidatosSemMovimento({ cnpj, filiais = [] } = {}) {
    const base = baseDeclaracao({ cnpj, filiais });
    const semEstab = { ...base, estabelecimentos: [] };

    return [
        {
            nome: 'atual',
            hipotese: 'É o que o app manda hoje. Entra na sonda como CONTROLE: se ele passar, '
                + 'o problema não é a forma e sim algo do cadastro/competência.',
            declaracao: base,
        },
        {
            nome: 'sem-estabelecimentos',
            hipotese: 'Talvez a checagem da atividade dispare por VARRER os estabelecimentos. '
                + 'Sem nenhum, ela não teria o que varrer.',
            declaracao: semEstab,
        },
        {
            nome: 'flag-semMovimento',
            hipotese: 'Talvez exista uma marcação própria de ausência de movimento que desliga a '
                + 'validação de valor. Nome mais direto primeiro.',
            declaracao: { ...base, semMovimento: true },
        },
        {
            nome: 'flag-indicadorSemMovimento',
            hipotese: 'Mesma hipótese, com o prefixo `indicador` que o TRANSDECLARACAO11 usa nos '
                + 'outros booleanos (indicadorTransmissao, indicadorComparacao).',
            declaracao: { ...base, indicadorSemMovimento: true },
        },
        {
            nome: 'flag-por-estabelecimento',
            hipotese: 'Talvez a ausência de movimento seja POR ESTABELECIMENTO — é assim que o '
                + 'e-CAC pergunta, estabelecimento a estabelecimento.',
            declaracao: {
                ...base,
                estabelecimentos: base.estabelecimentos.map((e) => ({ ...e, semMovimento: true })),
            },
        },
        {
            nome: 'sem-o-campo-atividades',
            hipotese: 'Talvez `atividades: []` seja lido como "há atividades, com zero itens" e a '
                + 'ausência do campo seja o que significa "não houve".',
            declaracao: {
                ...base,
                estabelecimentos: base.estabelecimentos.map(({ cnpjCompleto }) => ({ cnpjCompleto })),
            },
        },
    ];
}

/**
 * TRAVA: a sonda nunca entrega.
 *
 * Chamada antes de cada candidato. Uma sonda que transmitisse por engano seria
 * pior que o bloqueio que ela quer resolver — entrega ao PGDAS-D não se desfaz.
 */
export function assertSondaNaoTransmite(dados) {
    if (dados?.indicadorTransmissao !== false) {
        const err = new Error('Sonda do PGDAS-D bloqueada: indicadorTransmissao precisa ser false. '
            + 'A sonda VALIDA e nunca entrega — entrega ao PGDAS-D não se desfaz.');
        err.code = 'SONDA_NAO_TRANSMITE';
        throw err;
    }
    return true;
}

/** Código MSG_ISN_xxx da mensagem do SN-Entregar, quando houver. */
export function codigoDaResposta(mensagem) {
    const m = String(mensagem ?? '').match(/MSG_[A-Z]+_\d+/);
    return m ? m[0] : null;
}

/**
 * Lê o resultado de UM candidato.
 *
 * `ok` só é verdade quando a validação PASSOU. Erro de rede não é "forma
 * recusada": não saber não pode ter cara de resposta (é a mesma régua do
 * indeterminado do gate).
 */
export function lerResultadoCandidato({ nome, hipotese, erro, resposta } = {}) {
    if (!erro) {
        return {
            nome, hipotese, situacao: 'aceita', codigo: null,
            mensagem: 'O SN-Entregar VALIDOU esta forma. Nada foi transmitido.',
            resposta: resposta ?? null,
        };
    }
    const texto = String(erro?.message || erro || '');
    const codigo = codigoDaResposta(texto);
    // Erro sem código do SN-Entregar é quase sempre transporte (rede, token,
    // 5xx). Tratar como "forma recusada" faria a sonda descartar a forma certa.
    if (!codigo && !/SERPRO\s+4\d\d/i.test(texto)) {
        return {
            nome, hipotese, situacao: 'indeterminado', codigo: null,
            mensagem: `Não deu pra perguntar (${texto || 'sem detalhe'}). Isto NÃO recusa a forma — repita depois.`,
            resposta: null,
        };
    }
    return {
        nome, hipotese, situacao: 'recusada', codigo,
        mensagem: texto,
        // Código novo é informação: sem saber traduzir, o retorno CRU vale mais
        // que um rótulo inventado (lição do localErroAviso do Reinf).
        resposta: codigo ? null : texto,
    };
}

/**
 * O veredito da rodada.
 *
 * NÃO elege vencedor por eliminação: se nenhum candidato foi aceito, isso é
 * dito, e o botão continua bloqueado.
 */
export function vereditoDaSonda(resultados = []) {
    const aceitas = resultados.filter((r) => r.situacao === 'aceita');
    const indeterminados = resultados.filter((r) => r.situacao === 'indeterminado');
    const codigos = [...new Set(resultados.filter((r) => r.codigo).map((r) => r.codigo))];

    if (aceitas.length === 1) {
        return {
            destravou: true,
            forma: aceitas[0].nome,
            resumo: `O SN-Entregar VALIDOU a forma "${aceitas[0].nome}" (${aceitas[0].hipotese}). `
                + 'Nada foi transmitido. Essa é a forma a implementar — e implementar é o que '
                + 'transforma sonda em entrega: o botão continua bloqueado até isso.',
        };
    }
    if (aceitas.length > 1) {
        // Duas formas aceitas não é "escolha a primeira": pode ser que a
        // validação não cheque o que a entrega checa. Escolher aqui seria o
        // mesmo erro do `principal` duplicado do túnel de responsáveis.
        return {
            destravou: false,
            forma: null,
            resumo: `${aceitas.length} formas passaram na validação (${aceitas.map((a) => a.nome).join(', ')}). `
                + 'A sonda NÃO escolhe: validação passar não prova que a entrega aceita, e entrega não '
                + 'se desfaz. Leve as duas ao SERPRO ou compare com uma declaração real já aceita.',
        };
    }
    if (indeterminados.length === resultados.length && resultados.length > 0) {
        return {
            destravou: false, forma: null,
            resumo: 'Nenhuma resposta veio do SN-Entregar (rede/credencial). Isso NÃO recusa forma '
                + 'nenhuma — repita a sonda.',
        };
    }
    return {
        destravou: false,
        forma: null,
        resumo: `Nenhuma das ${resultados.length} formas foi aceita`
            + (codigos.length ? ` (códigos: ${codigos.join(', ')})` : '')
            + '. O botão segue bloqueado, e o caminho continua sendo a especificação do campo pelo '
            + 'SERPRO — mas agora com as recusas nomeadas para abrir o chamado.',
    };
}
