// ============================================================================
// sefaz-backend/dere-regimes.js  (PURO — sem I/O, testável)
// ----------------------------------------------------------------------------
// 🏦 O VOCABULÁRIO DOS REGIMES ESPECÍFICOS DE IBS/CBS — e a pergunta que ele
// responde: **esta empresa está na DeRE?**
//
// ═══ O QUE É A DeRE (02/09, pedido do Paulo: "crie uma nova função capaz de
// atender esta obrigação chamada DERE") ══════════════════════════════════════
//
// DeRE = **Declaração de Regimes Específicos** — a obrigação acessória da
// reforma tributária (EC 132/2023 · LC 214/2025) para quem fornece sob REGIME
// ESPECÍFICO de IBS/CBS (e IS, quando aplicável). NÃO é "declaração de
// retenções": o nome parecido com DIRF engana, e o que ela declara é
// escrituração contábil — plano de contas comentado, balancete mensal,
// aplicações financeiras, títulos de dívida.
//
// ═══ DE ONDE VEM CADA AFIRMAÇÃO (e o que ainda NÃO foi lido) ═════════════════
//
// Os LEIAUTES v1.1.0 (eventos, tabelas, regras de validação, histórico) e o
// MANUAL DO DESENVOLVEDOR v1.0.2 foram entregues pelo Paulo em 02/09 e estão
// em `docs/dere/` (texto) e `public/docs/dere/` (PDF, servido pelo app). O que
// está abaixo sai DELES, com a página. O que continua por resumo de terceiros
// é o PRAZO (Ato Conjunto RFB/CGIBS 4/2026 + esclarecimento de 26/08) e o
// Manual do Usuário (MOD 1.0.1), que não veio.
//
// 🚨 **O LEIAUTE FECHOU A PERGUNTA "QUAIS REGIMES ENTRAM"**: o D-1001
// `{regTribPrinc}` só admite **1 – Serviços Financeiros · 2 – Planos de
// Assistência à Saúde · 3 – Concursos de Prognósticos · 9 – Outros** (e o 9 só
// existe para quem tem um secundário 1-3). Não há grupo para imóveis,
// cooperativas, combustíveis, bares/hotelaria, SAF ou missões — **esses
// regimes não têm como ser declarados hoje**, então a DeRE não se aplica a
// eles enquanto o leiaute não os incluir. De manhã este módulo dizia "não
// confirmado"; agora diz o fato: fora do leiaute vigente.
//
// ═══ O QUE ESTE MÓDULO DECIDE ═══════════════════════════════════════════════
//
//   · `REGIMES_ESPECIFICOS_IBS_CBS` — o vocabulário que o cadastro GRAVA
//     (`dadosFiscais.regimeEspecificoIbsCbs`), com a base legal e o código
//     que o D-1001 usa. Valor fora do vocabulário é RECUSADO na gravação,
//     nunca descartado calado (lição do #382).
//   · `ATIVIDADES_DERE` — as Tabelas 21/31/41 do Anexo I (o `tpAtividade` do
//     D-1001), copiadas da fonte, nunca digitadas de memória.
//   · `decidirDereNoCadastro` — a régua ÚNICA de "está na DeRE?", lida pelo
//     catálogo de obrigações (quem cria o mês) e pela triagem da carteira.
//
// ═══ O QUE ELE SE RECUSA A FAZER ════════════════════════════════════════════
//
//   · **Deduzir o regime específico pelo CNAE.** CNAE é SINAL, não
//     enquadramento (a mesma régua do bloco K e do `contribuinteIpi`). O sinal
//     vira CANDIDATA a confirmar — sugestão carimbada com a origem, como a
//     triagem do terceiro setor (18/08). Quem afirma é uma pessoa, no cadastro.
//   · **Acender a carteira inteira.** Empresa sem cadastro E sem sinal de CNAE
//     NÃO vira pendência: seria a lição das 236 empresas em ALTO por um campo
//     que ninguém consegue preencher (26/08). Ela sai como `sem-sinal`, DITA na
//     triagem, nunca como alarme na Rotina de 400 clientes.
// ============================================================================

/** Marca de onde veio cada afirmação — o leitor precisa saber o que foi LIDO. */
export const FONTES_DERE = Object.freeze({
    LC_214: 'LC 214/2025, Título V (regimes específicos de IBS e CBS)',
    LEIAUTES_1_1_0: 'Leiautes da DeRE v1.1.0 (22/06/2026) — LIDOS: docs/dere/02-leiautes-eventos-v1.1.0.txt · '
        + 'Anexo I Tabelas · Anexo II Regras de Validação · Histórico de Versões (PDFs em public/docs/dere/)',
    MANUAL_DEV_1_0_2: 'Manual de Orientação aos Desenvolvedores da DeRE v1.0.2 (18/08/2026) — LIDO: '
        + 'docs/dere/07-manual-do-desenvolvedor-v1.0.2.txt',
    ATO_CONJUNTO_4: 'Ato Conjunto RFB/CGIBS nº 4/2026 (30/07/2026) — cronograma e prazo (dia 15 do mês seguinte). '
        + '⚠️ Conhecido por resumo de terceiros (gov.br bloqueado nesta rede)',
    ESCLARECIMENTO_26_08: 'Esclarecimentos CGIBS/RFB sobre a DeRE, 26/08/2026 (eventos de tabela a partir de 01/10/2026; '
        + '1ª escrituração mensal = competência 10/2026, até 15/11/2026, prazo NÃO prorroga em dia não útil). '
        + '⚠️ Conhecido por resumo de terceiros',
    MOD_1_0_1: 'Manual de Orientação do Usuário da DeRE (MOD) v1.0.1 — ⚠️ NÃO RECEBIDO/NÃO LIDO. O que se sabe dele '
        + '(público: serviços financeiros, planos de saúde, loterias) coincide com o D-1001 do leiaute',
});

/**
 * Os regimes específicos do Título V da LC 214/2025.
 *
 * `codigoD1001` é o valor do campo `{regTribPrinc}`/`{regTribSecund}` do evento
 * D-1001 (Leiautes 1.1.0, p. 4). **Só quem tem código cabe na declaração** —
 * `dereConfirmada` é exatamente isso: tem lugar no leiaute vigente. FALSE não
 * é "não sei": é "o leiaute não tem grupo para este regime", e a tela diz com
 * essas palavras.
 *
 * `cnaes` são PREFIXOS (só dígitos) que fazem a empresa virar CANDIDATA. Só
 * existem nos regimes com código: encher a fila com posto de gasolina e
 * imobiliária por um regime que a DeRE não recebe é o jeito de a fila não ser
 * lida.
 */
export const REGIMES_ESPECIFICOS_IBS_CBS = Object.freeze([
    {
        codigo: 'NENHUM',
        rotulo: 'Não se aplica — regime regular',
        capitulo: null,
        baseLegal: 'Fora do Título V da LC 214/2025: apura IBS/CBS pelo regime regular (ou é optante do Simples).',
        dereConfirmada: false,
        codigoD1001: null,
        cnaes: [],
    },
    {
        codigo: 'SERVICOS_FINANCEIROS',
        rotulo: 'Serviços financeiros',
        capitulo: 'Cap. II',
        baseLegal: 'LC 214/2025 art. 182 — crédito, câmbio, títulos e valores mobiliários, securitização, factoring, '
            + 'arrendamento mercantil, consórcio, gestão de recursos, arranjos de pagamento, seguros/resseguros, '
            + 'previdência, capitalização, ativos virtuais (Tabela 21 do Anexo I)',
        dereConfirmada: true,
        codigoD1001: 1,
        // Divisão 64 (serviços financeiros), grupos 65.1–65.3 (seguros, resseguros,
        // previdência complementar), 66.12 (corretoras de títulos), 66.13 (cartões),
        // 66.30 (gestão de recursos). 66.22 (corretora de SEGUROS) fica FORA: é
        // intermediação de seguro, não o serviço financeiro em si — e é o CNAE
        // que mais aparece em empresa comum da carteira.
        cnaes: ['64', '651', '652', '653', '6612', '6613', '6630'],
    },
    {
        codigo: 'PLANOS_SAUDE',
        rotulo: 'Planos de assistência à saúde',
        capitulo: 'Cap. III',
        baseLegal: 'LC 214/2025 art. 234 — seguradoras de saúde, administradoras de benefícios, cooperativas '
            + 'operadoras, demais operadoras, autogestão (Tabela 31 do Anexo I)',
        dereConfirmada: true,
        codigoD1001: 2,
        cnaes: ['6550'],
    },
    {
        codigo: 'CONCURSOS_PROGNOSTICOS',
        rotulo: 'Concursos de prognósticos (loterias e apostas)',
        capitulo: 'Cap. IV',
        baseLegal: 'LC 214/2025 art. 248 — apostas esportivas, turfe, loterias, jogos online, fantasy sport '
            + '(Tabela 41 do Anexo I)',
        dereConfirmada: true,
        codigoD1001: 3,
        cnaes: ['9200'],
    },
    {
        codigo: 'COMBUSTIVEIS',
        rotulo: 'Combustíveis (regime monofásico)',
        capitulo: 'Cap. I',
        baseLegal: 'LC 214/2025 art. 172',
        dereConfirmada: false,
        codigoD1001: null,
        cnaes: [],
    },
    {
        codigo: 'BENS_IMOVEIS',
        rotulo: 'Operações com bens imóveis',
        capitulo: 'Cap. V',
        baseLegal: 'LC 214/2025 art. 251 — locação, incorporação, loteamento, administração e intermediação imobiliária',
        dereConfirmada: false,
        codigoD1001: null,
        cnaes: [],
    },
    {
        codigo: 'SOCIEDADES_COOPERATIVAS',
        rotulo: 'Sociedades cooperativas',
        capitulo: 'Cap. VI',
        baseLegal: 'LC 214/2025 art. 271',
        dereConfirmada: false,
        codigoD1001: null,
        cnaes: [],
    },
    {
        codigo: 'BARES_RESTAURANTES_HOTELARIA',
        rotulo: 'Bares, restaurantes, hotelaria, parques, agências de turismo e transporte coletivo',
        capitulo: 'Cap. VII',
        baseLegal: 'LC 214/2025 art. 274',
        dereConfirmada: false,
        codigoD1001: null,
        cnaes: [],
    },
    {
        codigo: 'SAF',
        rotulo: 'Sociedade Anônima do Futebol (SAF)',
        capitulo: 'Cap. VIII',
        baseLegal: 'LC 214/2025, Título V, Cap. VIII',
        dereConfirmada: false,
        codigoD1001: null,
        cnaes: [],
    },
    {
        codigo: 'MISSOES_DIPLOMATICAS',
        rotulo: 'Missões diplomáticas, consulares e organismos internacionais',
        capitulo: 'Cap. IX',
        baseLegal: 'LC 214/2025, Título V, Cap. IX',
        dereConfirmada: false,
        codigoD1001: null,
        cnaes: [],
    },
]);

/**
 * As atividades do D-1001 `{tpAtividade}` — Anexo I, Tabelas 21, 31 e 41
 * (Leiautes 1.1.0, p. 79, 82 e 85). Máscara NNC. Copiadas da fonte; a 1.1.0
 * desdobrou 06A/06B (leasing operacional × financeiro) e 09F/09Z (arranjos
 * de pagamento). Servem à tela e a um futuro gerador do D-1001 — nunca a uma
 * dedução do app.
 */
export const ATIVIDADES_DERE = Object.freeze({
    SERVICOS_FINANCEIROS: Object.freeze([
        ['01A', 'Operações de crédito (captação, repasse, adiantamento, empréstimo, financiamento, desconto de títulos, recuperação de créditos, garantias) — exceto securitização, faturização e liquidação antecipada de recebíveis'],
        ['02A', 'Operações de câmbio'],
        ['03A', 'Operações com títulos e valores mobiliários (aquisição, negociação, liquidação, custódia, corretagem, distribuição, assessoria e consultoria)'],
        ['04A', 'Operações de securitização'],
        ['05A', 'Operações de faturização (factoring)'],
        ['06A', 'Arrendamento mercantil (leasing) operacional'],
        ['06B', 'Arrendamento mercantil (leasing) financeiro'],
        ['07A', 'Administração de consórcio'],
        ['08A', 'Gestão e administração de recursos, inclusive fundos de investimento'],
        ['09A', 'Arranjos de pagamento — credenciadora ou subcredenciadora'],
        ['09B', 'Arranjos de pagamento — instituidor do arranjo (bandeiras)'],
        ['09C', 'Arranjos de pagamento — emissor de cartões'],
        ['09D', 'Arranjos de pagamento — administração de programas de fidelização'],
        ['09E', 'Arranjos de pagamento — programa de fidelidade próprio'],
        ['09F', 'Arranjos de pagamento — vale refeição, vale alimentação ou vale transporte'],
        ['09Z', 'Arranjos de pagamento — outros tipos de arranjo'],
        ['10A', 'Administradoras de mercados organizados, infraestruturas de mercado e depositárias centrais'],
        ['11A', 'Seguros de ramos elementares e de pessoas sem cobertura por sobrevivência (exceto seguro saúde)'],
        ['11B', 'Seguros de pessoas com cobertura por sobrevivência (exceto seguro saúde)'],
        ['12A', 'Operações de resseguros'],
        ['13A', 'Previdência complementar aberta'],
        ['13B', 'Previdência complementar fechada'],
        ['14A', 'Operações de capitalização'],
        ['15A', 'Intermediação de consórcios, seguros, resseguros, previdência complementar e capitalização'],
        ['16A', 'Serviços de ativos virtuais'],
        ['17A', 'Operações de proteção patrimonial mutualista'],
    ]),
    PLANOS_SAUDE: Object.freeze([
        ['01A', 'Seguradoras de saúde'],
        ['02A', 'Administradoras de benefícios'],
        ['03A', 'Cooperativas operadoras de planos de saúde'],
        ['04A', 'Cooperativas de seguro saúde'],
        ['05A', 'Demais operadoras de planos de assistência à saúde'],
        ['06A', 'Plano de assistência funerária'],
        ['07A', 'Plano de assistência à saúde de animais'],
        ['08A', 'Plano de assistência à saúde modalidade autogestão'],
    ]),
    CONCURSOS_PROGNOSTICOS: Object.freeze([
        ['01A', 'Apostas esportivas'],
        ['01B', 'Apostas de turfe'],
        ['01C', 'Modalidades lotéricas'],
        ['01D', 'Jogos online (iGaming)'],
        ['01E', 'Fantasy sport'],
        ['01F', 'Sweepstakes'],
        ['01G', 'Demais apostas'],
    ]),
});

/** Os códigos aceitos na gravação — nada fora daqui entra (lição do #382). */
export const REGIMES_ESPECIFICOS_VALIDOS = Object.freeze(REGIMES_ESPECIFICOS_IBS_CBS.map((r) => r.codigo));

export function regimeEspecificoPorCodigo(codigo) {
    const c = String(codigo || '').trim().toUpperCase();
    return REGIMES_ESPECIFICOS_IBS_CBS.find((r) => r.codigo === c) || null;
}

/**
 * A declaração é por CNPJ RAIZ (`{nrInsc}`, 8 posições, em todo evento).
 * O XSD (`envioLoteDere`, `evtInfoContrib`) define `[0-9A-Z]{8}` — o CNPJ
 * ALFANUMÉRICO já vale desde 07/2026, então letras contam, em MAIÚSCULAS. Só
 * o que não é letra nem dígito sai (pontos, barra, traço).
 */
export function raizDoCnpj(cnpj) {
    const d = String(cnpj == null ? '' : cnpj).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    return d.length === 14 ? d.slice(0, 8) : null;
}

/**
 * Recusa de gravação, com a saída escrita — o desenho do `regimeTributario`.
 * Vazio LIMPA o campo (volta a "não informado"); `NENHUM` é resposta positiva
 * ("olhei e não se aplica") e por isso é gravado, não apagado.
 */
export function validarRegimeEspecificoParaGravacao(bruto) {
    if (bruto === '' || bruto == null) return { ok: true, codigo: null };
    const r = regimeEspecificoPorCodigo(bruto);
    if (!r) {
        return {
            ok: false,
            codigo: null,
            motivo: `Regime específico "${bruto}" não é um dos aceitos. Use um destes: `
                + REGIMES_ESPECIFICOS_IBS_CBS.map((x) => `${x.codigo} (${x.rotulo})`).join(', ') + '.',
        };
    }
    return { ok: true, codigo: r.codigo };
}

/** Sinal de CNAE (prefixo, só dígitos) → o regime com código no D-1001 que ele sugere. */
export function sinalDeCnaeParaDere(cnae) {
    const d = String(cnae == null ? '' : cnae).replace(/\D/g, '');
    if (d.length < 4) return null;
    for (const r of REGIMES_ESPECIFICOS_IBS_CBS) {
        if (!r.dereConfirmada) continue;
        if (r.cnaes.some((p) => d.startsWith(p))) return { regime: r.codigo, rotulo: r.rotulo, cnae: d };
    }
    return null;
}

/**
 * A RÉGUA: esta empresa está na DeRE?
 *
 * Lê as DUAS formas do cadastro (topo e `dadosFiscais`) — é a armadilha das
 * duas formas, tratada uma vez aqui. `regimeCatalogo` é o regime FISCAL já
 * resolvido pelo catálogo ('SIMPLES' | 'LUCRO_PRESUMIDO' | ...).
 *
 * @returns {{
 *   decisao: 'dispensada-simples'|'obrigada'|'nao-se-aplica'|'regime-fora-do-leiaute'|'candidata'|'sem-sinal',
 *   regimeEspecifico: string|null, rotulo: string|null, codigoD1001: number|null,
 *   motivo: string, acao: string|null,
 *   sinalCnae: {regime:string, rotulo:string, cnae:string}|null, fonte: string,
 * }}
 */
export function decidirDereNoCadastro(empresa, { regimeCatalogo } = {}) {
    const df = empresa?.dadosFiscais || {};
    const bruto = empresa?.regimeEspecificoIbsCbs ?? df.regimeEspecificoIbsCbs ?? '';
    const cnae = empresa?.cnae ?? df.cnae ?? '';
    const sinalCnae = sinalDeCnaeParaDere(cnae);

    // Optante do Simples fica FORA: ele não está no regime regular de IBS/CBS
    // (salvo opção expressa, que o app não conhece). Vale mesmo que alguém
    // marque um regime específico — a marcação continua gravada e a tela diz
    // por que não gera obrigação.
    if (String(regimeCatalogo || '').toUpperCase() === 'SIMPLES') {
        return {
            decisao: 'dispensada-simples', regimeEspecifico: null, rotulo: null, codigoD1001: null, sinalCnae,
            motivo: 'Optante do Simples Nacional não entra na DeRE (fica fora do regime regular de IBS/CBS, salvo '
                + 'opção expressa pelo regime regular, que este app não conhece).',
            acao: null,
            fonte: FONTES_DERE.ESCLARECIMENTO_26_08 + ' · ' + FONTES_DERE.LC_214,
        };
    }

    const r = regimeEspecificoPorCodigo(bruto);
    if (r && r.codigo === 'NENHUM') {
        return {
            decisao: 'nao-se-aplica', regimeEspecifico: 'NENHUM', rotulo: r.rotulo, codigoD1001: null, sinalCnae,
            motivo: 'O cadastro diz que a empresa NÃO opera em regime específico de IBS/CBS.',
            acao: null, fonte: 'cadastro (Dados Fiscais → Regime específico de IBS/CBS)',
        };
    }
    if (r && r.dereConfirmada) {
        return {
            decisao: 'obrigada', regimeEspecifico: r.codigo, rotulo: r.rotulo, codigoD1001: r.codigoD1001, sinalCnae,
            motivo: `Cadastro: ${r.rotulo} (${r.baseLegal}) — regime ${r.codigoD1001} do D-1001 {regTribPrinc}.`,
            acao: null, fonte: FONTES_DERE.LEIAUTES_1_1_0,
        };
    }
    if (r) {
        return {
            decisao: 'regime-fora-do-leiaute', regimeEspecifico: r.codigo, rotulo: r.rotulo, codigoD1001: null, sinalCnae,
            motivo: `Cadastro: ${r.rotulo} (${r.baseLegal}). O leiaute vigente da DeRE (v1.1.0) só tem lugar para `
                + 'serviços financeiros, planos de saúde e concursos de prognósticos (D-1001 {regTribPrinc} = 1, 2, 3) — '
                + 'este regime NÃO tem como ser declarado hoje, então a DeRE não se aplica a ele enquanto o leiaute '
                + 'não o incluir.',
            acao: 'Nada a entregar por ora. Mantenha o cadastro: se uma versão futura do leiaute incluir o regime, o app '
                + 'passa a cobrar sem ninguém mexer.',
            fonte: FONTES_DERE.LEIAUTES_1_1_0,
        };
    }
    if (sinalCnae) {
        return {
            decisao: 'candidata', regimeEspecifico: null, rotulo: null, codigoD1001: null, sinalCnae,
            motivo: `O CNAE ${sinalCnae.cnae} sugere "${sinalCnae.rotulo}", regime que cabe na DeRE — e o cadastro não diz `
                + 'se a empresa está nele. É SUGESTÃO, não decisão.',
            acao: 'Confirme em Empresas → Dados Fiscais → Regime específico de IBS/CBS (ou marque "Não se aplica").',
            fonte: FONTES_DERE.LEIAUTES_1_1_0,
        };
    }
    return {
        decisao: 'sem-sinal', regimeEspecifico: null, rotulo: null, codigoD1001: null, sinalCnae: null,
        motivo: 'Sem regime específico no cadastro e sem sinal no CNAE. O app NÃO afirma que a empresa está fora — '
            + 'só que não tem como saber. Quem souber de uma, marque no cadastro.',
        acao: null, fonte: 'cadastro + CNAE',
    };
}
