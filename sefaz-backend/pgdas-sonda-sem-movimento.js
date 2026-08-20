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

/**
 * Base comum: o que já é certo em qualquer declaração do PGDAS-D.
 *
 * 🚨 `tipoDeclaracao` É OBRIGATÓRIO E FALTAVA — foi ele que invalidou a rodada
 * inteira de 20/08 (ELS COMERCIO DE BANANAS, PA 07/2026). Os 6 candidatos
 * voltaram com o MESMO erro e o SERPRO disse o campo na cara:
 *
 *   [EntradaIncorreta-PGDASD-MSG_ISN_036] - O Json contém dados inválidos -
 *   Required property 'TipoDeclaracao' not found in JSON. Path 'declaracao'.
 *
 * A sonda chamava `validarDeclaracaoPgdas` DIRETO, e quem preenche esse campo
 * no caminho real é o `transmitirPgdasD` (1 = Original, 2 = Retificadora,
 * decidido consultando se a competência já foi declarada). Resultado: as 6
 * formas nunca chegaram a ser avaliadas — a recusa foi de SCHEMA, antes de
 * qualquer leitura de conteúdo.
 *
 * ⚠️ REGRA QUE FICA: **a sonda tem que perguntar com o MESMO payload que o
 * caminho real enviaria.** Sonda que monta um payload próprio responde sobre
 * uma forma que ninguém vai transmitir — e o "não" dela não vale nada.
 */
function baseDeclaracao({ cnpj, filiais = [], tipoDeclaracao = 1 }) {
    const matriz = soDigitos(cnpj);
    const todos = [matriz, ...filiais.map(soDigitos)].filter((c) => c.length === 14);
    const unicos = [...new Set(todos)];
    return {
        tipoDeclaracao,
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
export function candidatosSemMovimento({ cnpj, filiais = [], tipoDeclaracao = 1 } = {}) {
    const base = baseDeclaracao({ cnpj, filiais, tipoDeclaracao });
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

/**
 * O CAMPO que o SERPRO disse estar faltando, quando ele diz.
 *
 * *"Required property 'TipoDeclaracao' not found in JSON. Path 'declaracao'"* é
 * o oposto de mensagem opaca: ela nomeia o defeito. Antes disto, a sonda lia
 * "seis recusas com o mesmo código" e concluía *"a estrutura não foi avaliada,
 * leve ao SERPRO"* — conselho errado, porque o erro É de estrutura e o campo
 * estava escrito na resposta. Mesma lição do cStat 640 da SEFAZ no mesmo dia:
 * resposta que o app chama de silêncio manda a pessoa para o lugar errado.
 */
export function campoObrigatorioAusente(mensagem) {
    const m = String(mensagem ?? '').match(/Required property '([^']+)' not found/i);
    return m ? m[1] : null;
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
        // Quando a resposta NOMEIA o campo que falta, isso é o achado — e vale
        // mais que o código, que é genérico ("Json contém dados inválidos").
        campoAusente: campoObrigatorioAusente(texto),
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
    // ═══ O ACHADO QUE A PRIMEIRA RODADA REAL PRODUZIU (13/08, ELS 07/2026) ═══
    //
    // As 6 formas voltaram com o MESMO código (MSG_ISN_036) — e isso não é
    // "nenhuma serve": é PROVA de que a recusa NÃO OLHA a estrutura.
    //
    // Seis payloads diferentes (com estabelecimento, sem, com flag, sem o campo
    // atividades) não podem falhar pelo mesmo motivo se o motivo fosse a forma.
    // A recusa acontece ANTES — no cadastro, no período ou na procuração.
    //
    // Sem dizer isso, a sonda mandaria continuar caçando estrutura, que é
    // exatamente o caminho errado. Mesmo padrão do farol honesto: a causa
    // dominante vale mais que a contagem.
    const recusadas = resultados.filter((r) => r.situacao === 'recusada');
    // 🚨 CAMPO NOMEADO VENCE "MESMO CÓDIGO" — e a ordem aqui é a correção.
    //
    // Paulo, 20/08 (ELS 07/2026, segunda rodada): as 6 formas voltaram com o
    // mesmo MSG_ISN_036, e o veredito abaixo mandou *"pare de procurar
    // estrutura, leve ao SERPRO"*. Estava errado: a mensagem dizia
    // *"Required property 'TipoDeclaracao' not found in JSON"* — o erro ERA de
    // estrutura, e o campo estava escrito na resposta. A sonda mandava abrir
    // chamado sobre um defeito NOSSO.
    //
    // Quando todas as recusas apontam o MESMO campo ausente, isso não é
    // "condição da empresa": é o payload da sonda incompleto, e a ação é do
    // app. É a mesma lição do cStat 640 no mesmo dia — resposta que o app
    // chama de silêncio manda a pessoa para o lugar errado.
    const camposAusentes = [...new Set(recusadas.map((r) => r.campoAusente).filter(Boolean))];
    if (camposAusentes.length === 1 && recusadas.length === resultados.length && resultados.length > 1) {
        return {
            destravou: false,
            forma: null,
            aEstruturaFoiAvaliada: false,
            codigoUnico: codigos[0] || null,
            campoAusente: camposAusentes[0],
            resumo: `As ${resultados.length} formas foram recusadas pelo MESMO motivo, e o SN-Entregar `
                + `NOMEOU o campo: **${camposAusentes[0]} não veio no JSON**. Isso não é condição da `
                + 'empresa nem assunto de chamado — é o payload da sonda incompleto, e a recusa aconteceu '
                + 'na validação do schema, ANTES de qualquer leitura de "sem movimento". Nenhuma das seis '
                + 'formas chegou a ser avaliada: corrija o campo e rode a sonda de novo.',
        };
    }

    const mesmoCodigo = codigos.length === 1 && recusadas.length === resultados.length && resultados.length > 1;
    if (mesmoCodigo) {
        return {
            destravou: false,
            forma: null,
            aEstruturaFoiAvaliada: false,
            codigoUnico: codigos[0],
            resumo: `As ${resultados.length} formas foram recusadas com o MESMO código (${codigos[0]}). `
                + 'Isso é um ACHADO, não um beco: estruturas diferentes não falham pelo mesmo motivo se o '
                + 'motivo fosse a estrutura. A recusa acontece ANTES de o SN-Entregar olhar o conteúdo — '
                + 'é condição da empresa/competência (cadastro, período, procuração ou opção pelo Simples), '
                + 'não a forma do payload. Pare de procurar estrutura: leve ESTE código ao SERPRO, com a '
                + 'mensagem inteira que está ao lado de cada candidato.',
        };
    }

    return {
        destravou: false,
        forma: null,
        aEstruturaFoiAvaliada: true,
        codigoUnico: null,
        resumo: `Nenhuma das ${resultados.length} formas foi aceita`
            + (codigos.length ? ` (códigos: ${codigos.join(', ')})` : '')
            + '. Códigos DIFERENTES entre as formas indicam que o SN-Entregar chegou a avaliar o conteúdo — '
            + 'o caminho continua sendo a especificação do campo pelo SERPRO, agora com as recusas nomeadas '
            + 'para abrir o chamado.',
    };
}
