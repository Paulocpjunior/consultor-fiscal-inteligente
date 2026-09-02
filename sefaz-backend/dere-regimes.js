// ============================================================================
// sefaz-backend/dere-regimes.js  (PURO — sem I/O, testável)
// ----------------------------------------------------------------------------
// 🏦 O VOCABULÁRIO DOS REGIMES ESPECÍFICOS DE IBS/CBS — e a pergunta que ele
// responde: **esta empresa está na DeRE?**
//
// ═══ O QUE É A DeRE (02/09, pedido do Paulo: "crie uma nova função capaz de
// atender esta obrigação chamada DERE") ══════════════════════════════════════
//
// DeRE = **Declaração Eletrônica de Regimes Específicos** — a obrigação
// acessória da reforma tributária (EC 132/2023 · LC 214/2025) para quem
// fornece bens/serviços sujeitos a REGIME ESPECÍFICO de IBS/CBS (e IS, quando
// aplicável). NÃO é "declaração de retenções": o nome parecido com DIRF engana,
// e o que ela declara é escrituração contábil-fiscal — plano de contas,
// balancete mensal, aplicações financeiras, deduções da apuração.
//
// ⚠️ **COMO ESTA INFORMAÇÃO CHEGOU AQUI, e o que isso limita.** A rede deste
// ambiente bloqueia gov.br, sped.rfb.gov.br e cgibs.gov.br (o MESMO bloqueio
// do CONFAZ, do SERPRO e do Guia do SPED — CLAUDE.md, 20/08). O Manual de
// Orientação (MOD 1.0.1) e os leiautes 1.0.0 **não foram lidos**; o que está
// aqui veio de RESUMOS de terceiros das notícias oficiais (esclarecimentos
// CGIBS/RFB de 26/08/2026, Ato Conjunto RFB/CGIBS 4/2026). Por isso:
//
//   · o vocabulário dos regimes vem da PRÓPRIA LC 214/2025 (Título V), que é
//     norma e não depende do manual;
//   · o ALCANCE da DeRE (quais regimes ela cobre) está marcado por regime:
//     `dereConfirmada: true` só onde a fonte lida NOMEIA o regime como
//     obrigado (serviços financeiros, planos de saúde, concursos de
//     prognósticos/loterias — os três públicos do MOD 1.0.1). Nos demais o app
//     NÃO afirma nem que entra nem que não entra — é a régua do `csllOuTotal`:
//     nome de causa que afirma demais faz quem lê acreditar;
//   · **nenhum evento (XML) é gerado aqui**. Inventar leiaute sem o XSD na mão
//     é o `1405` com outra roupa; e o INSUMO dos eventos (PGCC, balancete) é
//     CONTÁBIL — a casa provável é o Consultor Contábil, decisão do dono.
//
// ═══ O QUE ESTE MÓDULO DECIDE ═══════════════════════════════════════════════
//
//   · `REGIMES_ESPECIFICOS_IBS_CBS` — o vocabulário que o cadastro GRAVA
//     (`dadosFiscais.regimeEspecificoIbsCbs`), com a base legal de cada um.
//     Valor fora do vocabulário é RECUSADO na gravação, nunca descartado
//     calado (lição do #382).
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
    ATO_CONJUNTO_4: 'Ato Conjunto RFB/CGIBS nº 4/2026 (30/07/2026) — cronograma e prazo (dia 15 do mês seguinte)',
    ESCLARECIMENTO_26_08: 'Esclarecimentos CGIBS/RFB sobre a DeRE, 26/08/2026 (eventos de tabela a partir de 01/10/2026; '
        + '1ª escrituração mensal = competência 10/2026, até 15/11/2026, prazo NÃO prorroga em dia não útil)',
    MOD_1_0_1: 'Manual de Orientação do Usuário da DeRE (MOD) v1.0.1 — público: serviços financeiros, planos de '
        + 'assistência à saúde e loterias. ⚠️ NÃO LIDO neste ambiente (rede bloqueia gov.br/cgibs.gov.br) — '
        + 'conteúdo conhecido por resumo de terceiros',
    LEIAUTES_1_0_0: 'Leiautes dos eventos da DeRE v1.0.0 (sped.rfb.gov.br, 23/02/2026) — ⚠️ NÃO LIDOS; só os códigos '
        + 'e nomes dos eventos, por resumo de terceiros',
});

/**
 * Os regimes específicos do Título V da LC 214/2025.
 *
 * `dereConfirmada` é a coluna que importa: TRUE só onde a documentação lida
 * nomeia o regime como obrigado à DeRE. FALSE não quer dizer "fora" — quer
 * dizer "o app não tem como afirmar", e a tela diz isso com essas palavras.
 *
 * `cnaes` são PREFIXOS (só dígitos) que fazem a empresa virar CANDIDATA. Só
 * existem nos regimes confirmados: encher a fila com posto de gasolina e
 * imobiliária por um alcance que ninguém confirmou é o jeito de a fila não ser
 * lida.
 */
export const REGIMES_ESPECIFICOS_IBS_CBS = Object.freeze([
    {
        codigo: 'NENHUM',
        rotulo: 'Não se aplica — regime regular',
        capitulo: null,
        baseLegal: 'Fora do Título V da LC 214/2025: apura IBS/CBS pelo regime regular (ou é optante do Simples).',
        dereConfirmada: false,
        cnaes: [],
    },
    {
        codigo: 'SERVICOS_FINANCEIROS',
        rotulo: 'Serviços financeiros',
        capitulo: 'Cap. II',
        baseLegal: 'LC 214/2025 art. 182 — intermediação financeira, consórcio, gestão de recursos, títulos e valores '
            + 'mobiliários, seguros/resseguros, factoring, securitização, arrendamento mercantil, câmbio, previdência, '
            + 'ativos virtuais',
        dereConfirmada: true,
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
        baseLegal: 'LC 214/2025 art. 234 — operadoras, seguradoras de saúde, administradoras de benefícios, '
            + 'cooperativas operadoras',
        dereConfirmada: true,
        cnaes: ['6550'],
    },
    {
        codigo: 'CONCURSOS_PROGNOSTICOS',
        rotulo: 'Concursos de prognósticos (loterias e apostas)',
        capitulo: 'Cap. IV',
        baseLegal: 'LC 214/2025 art. 248',
        dereConfirmada: true,
        cnaes: ['9200'],
    },
    {
        codigo: 'COMBUSTIVEIS',
        rotulo: 'Combustíveis (regime monofásico)',
        capitulo: 'Cap. I',
        baseLegal: 'LC 214/2025 art. 172',
        dereConfirmada: false,
        cnaes: [],
    },
    {
        codigo: 'BENS_IMOVEIS',
        rotulo: 'Operações com bens imóveis',
        capitulo: 'Cap. V',
        baseLegal: 'LC 214/2025 art. 251 — locação, incorporação, loteamento, administração e intermediação imobiliária',
        dereConfirmada: false,
        cnaes: [],
    },
    {
        codigo: 'SOCIEDADES_COOPERATIVAS',
        rotulo: 'Sociedades cooperativas',
        capitulo: 'Cap. VI',
        baseLegal: 'LC 214/2025 art. 271',
        dereConfirmada: false,
        cnaes: [],
    },
    {
        codigo: 'BARES_RESTAURANTES_HOTELARIA',
        rotulo: 'Bares, restaurantes, hotelaria, parques, agências de turismo e transporte coletivo',
        capitulo: 'Cap. VII',
        baseLegal: 'LC 214/2025 art. 274',
        dereConfirmada: false,
        cnaes: [],
    },
    {
        codigo: 'SAF',
        rotulo: 'Sociedade Anônima do Futebol (SAF)',
        capitulo: 'Cap. VIII',
        baseLegal: 'LC 214/2025, Título V, Cap. VIII',
        dereConfirmada: false,
        cnaes: [],
    },
    {
        codigo: 'MISSOES_DIPLOMATICAS',
        rotulo: 'Missões diplomáticas, consulares e organismos internacionais',
        capitulo: 'Cap. IX',
        baseLegal: 'LC 214/2025, Título V, Cap. IX',
        dereConfirmada: false,
        cnaes: [],
    },
]);

/** Os códigos aceitos na gravação — nada fora daqui entra (lição do #382). */
export const REGIMES_ESPECIFICOS_VALIDOS = Object.freeze(REGIMES_ESPECIFICOS_IBS_CBS.map((r) => r.codigo));

export function regimeEspecificoPorCodigo(codigo) {
    const c = String(codigo || '').trim().toUpperCase();
    return REGIMES_ESPECIFICOS_IBS_CBS.find((r) => r.codigo === c) || null;
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

/** Sinal de CNAE (prefixo, só dígitos) → o regime confirmado que ele sugere. */
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
 *   decisao: 'dispensada-simples'|'obrigada'|'nao-se-aplica'|'regime-nao-confirmado'|'candidata'|'sem-sinal',
 *   regimeEspecifico: string|null, rotulo: string|null, motivo: string, acao: string|null,
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
            decisao: 'dispensada-simples', regimeEspecifico: null, rotulo: null, sinalCnae,
            motivo: 'Optante do Simples Nacional não entra na DeRE (fica fora do regime regular de IBS/CBS, salvo '
                + 'opção expressa pelo regime regular, que este app não conhece).',
            acao: null,
            fonte: FONTES_DERE.ESCLARECIMENTO_26_08 + ' · ' + FONTES_DERE.LC_214,
        };
    }

    const r = regimeEspecificoPorCodigo(bruto);
    if (r && r.codigo === 'NENHUM') {
        return {
            decisao: 'nao-se-aplica', regimeEspecifico: 'NENHUM', rotulo: r.rotulo, sinalCnae,
            motivo: 'O cadastro diz que a empresa NÃO opera em regime específico de IBS/CBS.',
            acao: null, fonte: 'cadastro (Dados Fiscais → Regime específico de IBS/CBS)',
        };
    }
    if (r && r.dereConfirmada) {
        return {
            decisao: 'obrigada', regimeEspecifico: r.codigo, rotulo: r.rotulo, sinalCnae,
            motivo: `Cadastro: ${r.rotulo} (${r.baseLegal}) — regime nomeado como obrigado à DeRE.`,
            acao: null, fonte: FONTES_DERE.MOD_1_0_1,
        };
    }
    if (r) {
        return {
            decisao: 'regime-nao-confirmado', regimeEspecifico: r.codigo, rotulo: r.rotulo, sinalCnae,
            motivo: `Cadastro: ${r.rotulo} (${r.baseLegal}). A documentação lida NÃO confirma que a DeRE alcança este `
                + 'regime — o app não afirma nem que entra nem que não entra.',
            acao: 'Confira no Manual de Orientação da DeRE (MOD 1.0.1, sped.rfb.gov.br) se este regime está entre os '
                + 'obrigados. Se estiver, a obrigação se entrega por fora até o app aprender; se não, marque '
                + '"Não se aplica" no cadastro.',
            fonte: FONTES_DERE.MOD_1_0_1,
        };
    }
    if (sinalCnae) {
        return {
            decisao: 'candidata', regimeEspecifico: null, rotulo: null, sinalCnae,
            motivo: `O CNAE ${sinalCnae.cnae} sugere "${sinalCnae.rotulo}", regime obrigado à DeRE — e o cadastro não diz `
                + 'se a empresa está nele. É SUGESTÃO, não decisão.',
            acao: 'Confirme em Empresas → Dados Fiscais → Regime específico de IBS/CBS (ou marque "Não se aplica").',
            fonte: FONTES_DERE.MOD_1_0_1,
        };
    }
    return {
        decisao: 'sem-sinal', regimeEspecifico: null, rotulo: null, sinalCnae: null,
        motivo: 'Sem regime específico no cadastro e sem sinal no CNAE. O app NÃO afirma que a empresa está fora — '
            + 'só que não tem como saber. Quem souber de uma, marque no cadastro.',
        acao: null, fonte: 'cadastro + CNAE',
    };
}
