/**
 * regime-tributario — o que a empresa É, para o CFI e para os apps irmãos.
 *
 * ═══ O CASO QUE ABRIU ISTO ══════════════════════════════════════════════════
 *
 * Paulo, 18/08, com o print do cadastro do CCI: *"criamos no CCI que as
 * informações de cadastro sejam compartilhadas do CFI para que possamos amarrar
 * todas informações cadastrais; ocorre que temos empresas Optantes pelo Simples
 * Nacional, Lucro Presumido, Lucro Real, **isentas, imunes** — devemos nos
 * atentar às empresas que são isentas/imunes e terceiro setor"*.
 *
 * No print, a **COMUNIDADE EVANGÉLICA SARA NOSSA TERRA** aparece como
 * *"Regime tributário — cadastro do CFI: **Lucro Presumido**"*. Uma igreja.
 *
 * ⚠️ E o rótulo é só o sintoma. A causa é que **o CFI nunca teve um campo de
 * regime**: ele DEDUZ da COLEÇÃO em que a empresa foi cadastrada
 * (`simples_empresas` → Simples, `lucro_empresas` → Lucro) e, dentro do Lucro,
 * de `regimePadrao`. Não existe lugar nenhum onde caiba "imune".
 *
 * ═══ POR QUE ISSO É MAIS CARO QUE UM RÓTULO ERRADO ══════════════════════════
 *
 * Entidade imune ou isenta cadastrada como Presumido recebe a lista de
 * obrigações do Presumido e entra nas apurações dele. Na prática o app passa a
 * apurar PIS/COFINS **sobre o faturamento** de quem, em regra, recolhe PIS
 * **sobre a FOLHA** (Lei 9.532/97 art. 13 c/c MP 2.158-35 art. 13) e tem a
 * COFINS afastada sobre as receitas das atividades próprias (MP 2.158-35 art.
 * 14, X). Ou seja: imposto que não existe, calculado com confiança.
 *
 * ═══ O QUE ESTE MÓDULO DECIDE, E O QUE ELE SE RECUSA A DECIDIR ══════════════
 *
 * DECIDE: **o vocabulário** — os regimes que o Paulo nomeou, num lugar só, com
 * o significado de cada um escrito ao lado. É esse vocabulário que o CFI grava e
 * que o túnel entrega aos apps irmãos.
 *
 * RECUSOU, e essa recusa durou algumas horas: montar a lista de obrigações da
 * imune e da isenta por dedução minha seria o erro do 1405 num lugar onde o
 * custo é multa. Enquanto ninguém tinha decidido, `IMUNE` e `ISENTA` caíam em
 * INDEFINIDO de propósito e recebiam só o comum.
 *
 * ✅ **A LISTA VEIO DELE EM 18/08**, em três respostas — ECD/ECF só com movimento
 * financeiro; DCTFWeb só com evento (aluguel, folha ou retenção);
 * EFD-Contribuições apenas em dezembro, sem movimento. Está em
 * `CATALOGO.IMUNE`/`CATALOGO.ISENTA`, cada entrada com a FALA que a decidiu.
 *
 * 🚨 O QUE NUNCA PODE VOLTAR A ACONTECER: herdar a lista do Presumido em
 * silêncio. Alarme dá para ver; herança calada, não.
 *
 * ═══ DOIS EIXOS, NÃO UM ═════════════════════════════════════════════════════
 *
 * "Terceiro setor" NÃO é regime — é a natureza da entidade (associação,
 * fundação, OSCIP, templo). Ela CONVIVE com o regime: um templo é imune E sem
 * fins lucrativos; uma associação pode ser isenta e ainda assim ter atividade
 * econômica tributada. Por isso `semFinsLucrativos` é campo PRÓPRIO, e não mais
 * um item da lista — enfiá-lo na mesma caixa obrigaria a escolher entre dois
 * fatos que coexistem, e a escolha ficaria errada dos dois jeitos.
 */

/**
 * O vocabulário. `apuracao: false` marca quem NÃO tem lista de obrigações
 * decidida — é o que impede a herança silenciosa. Hoje TODOS têm lista; o campo
 * fica porque é assim que o próximo regime sem decisão deve entrar.
 */
export const REGIMES = {
    SIMPLES: {
        rotulo: 'Simples Nacional',
        apuracao: true,
        descricao: 'Optante pelo Simples Nacional (LC 123/2006). Recolhe no DAS.',
    },
    LUCRO_PRESUMIDO: {
        rotulo: 'Lucro Presumido',
        apuracao: true,
        descricao: 'IRPJ/CSLL trimestrais por presunção; PIS/COFINS cumulativos.',
    },
    LUCRO_REAL: {
        rotulo: 'Lucro Real',
        apuracao: true,
        descricao: 'IRPJ/CSLL sobre o lucro ajustado; PIS/COFINS não-cumulativos.',
    },
    IMUNE: {
        rotulo: 'Imune',
        // ✅ 18/08: a lista de obrigações EXISTE agora (respondida pelo Paulo,
        // não deduzida) — ver CATALOGO.IMUNE em catalogo-obrigacoes.js.
        apuracao: true,
        descricao: 'Imunidade constitucional (CF art. 150, VI) — templos, partidos, '
            + 'sindicatos, instituições de educação e assistência social sem fins lucrativos, '
            + 'livros e periódicos.',
        ressalva: 'A imunidade alcança IMPOSTOS sobre patrimônio, renda e serviços — não é '
            + 'dispensa de obrigação acessória, e não alcança automaticamente as contribuições. '
            + 'Obrigações no CFI: DCTFWeb só com evento (aluguel, folha ou retenção); ECD e ECF só '
            + 'com movimento financeiro; EFD-Contribuições apenas em dezembro, sem movimento.',
    },
    ISENTA: {
        rotulo: 'Isenta',
        apuracao: true,
        descricao: 'Isenção por lei — entidades sem fins lucrativos isentas de IRPJ/CSLL '
            + '(Lei 9.532/97 art. 15) e casos análogos.',
        ressalva: 'Isenção não é imunidade e não dispensa obrigação acessória. Obrigações no CFI: '
            + 'DCTFWeb só com evento (aluguel, folha ou retenção); ECD e ECF só com movimento '
            + 'financeiro; EFD-Contribuições apenas em dezembro, sem movimento.',
    },
};

/** Os valores aceitos na gravação — nada fora daqui entra (lição do #382). */
export const REGIMES_VALIDOS = Object.keys(REGIMES);

/** Como o cadastro antigo escrevia, → como se chama agora. */
const SINONIMOS = {
    simples: 'SIMPLES',
    simples_nacional: 'SIMPLES',
    presumido: 'LUCRO_PRESUMIDO',
    lucro_presumido: 'LUCRO_PRESUMIDO',
    real: 'LUCRO_REAL',
    lucro_real: 'LUCRO_REAL',
    imune: 'IMUNE',
    imunidade: 'IMUNE',
    isenta: 'ISENTA',
    isento: 'ISENTA',
    isencao: 'ISENTA',
};

function chave(v) {
    return String(v == null ? '' : v)
        .trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[\s-]+/g, '_');
}

/** Normaliza o que estiver gravado. Devolve null quando não reconhece — nunca chuta. */
export function normalizarRegime(bruto) {
    const k = chave(bruto);
    if (!k) return null;
    if (REGIMES[k.toUpperCase()]) return k.toUpperCase();
    return SINONIMOS[k] || null;
}

/**
 * O regime da empresa, com a ORIGEM carimbada.
 *
 * Precedência: **campo explícito > `regimePadrao` do Lucro > a COLEÇÃO**.
 *
 * A coleção fica por ÚLTIMO de propósito: ela responde "onde foi cadastrada",
 * não "o que a empresa é" — e foi ela que transformou uma igreja em Lucro
 * Presumido. Enquanto o campo não estiver preenchido em toda a base, ela ainda
 * é o melhor palpite que existe; o que muda é a origem vir escrita junto.
 *
 * @returns {{regime: string, origem: string, apuracaoDefinida: boolean, motivo: string|null}}
 */
export function regimeDaEmpresa(empresa) {
    const df = empresa?.dadosFiscais || {};
    const explicito = normalizarRegime(empresa?.regimeTributario ?? df.regimeTributario);
    if (explicito) {
        return {
            regime: explicito,
            origem: 'cadastro',
            apuracaoDefinida: REGIMES[explicito].apuracao,
            // A ressalva viaja SEMPRE que existe, mesmo com a lista definida: é
            // ela que diz ao app irmão o que a entidade deve e o que não deve.
            // Amarrá-la a "apuração indefinida" faria a informação sumir no dia
            // em que a lista foi respondida — exatamente quando ela vale mais.
            motivo: REGIMES[explicito].ressalva || null,
        };
    }

    const colecao = String(empresa?.colecao || '').trim();
    if (colecao === 'simples_empresas') {
        return { regime: 'SIMPLES', origem: 'colecao', apuracaoDefinida: true, motivo: null };
    }
    if (colecao === 'lucro_empresas') {
        const rp = normalizarRegime(empresa?.regimePadrao);
        if (rp === 'LUCRO_PRESUMIDO' || rp === 'LUCRO_REAL') {
            return { regime: rp, origem: 'regimePadrao', apuracaoDefinida: true, motivo: null };
        }
        return {
            regime: 'INDEFINIDO',
            origem: 'colecao',
            apuracaoDefinida: false,
            motivo: 'Cliente do Lucro sem "Regime padrão" (Presumido ou Real) na ficha. '
                + 'Sem ele o mês sai incompleto: só as obrigações comuns aos dois regimes são geradas.',
        };
    }
    return {
        regime: 'INDEFINIDO',
        origem: 'nenhuma',
        apuracaoDefinida: false,
        motivo: `Coleção "${colecao || '(vazia)'}" não corresponde a nenhum regime conhecido.`,
    };
}

/** Rótulo para tela e para os apps irmãos. Regime desconhecido não vira frase bonita. */
export function rotuloRegime(regime) {
    return REGIMES[regime]?.rotulo || (regime === 'INDEFINIDO' ? 'Indefinido' : String(regime || ''));
}

/**
 * A entidade é do TERCEIRO SETOR (sem fins lucrativos)?
 *
 * ⚠️ Eixo SEPARADO do regime, de propósito — ver o cabeçalho. Não se DEDUZ do
 * regime: existe associação tributada pelo Presumido, e existe imune que não é
 * associação (livro, jornal). Quem responde é o cadastro.
 */
export function semFinsLucrativos(empresa) {
    const df = empresa?.dadosFiscais || {};
    return (empresa?.semFinsLucrativos ?? df.semFinsLucrativos) === true;
}

/**
 * Recusa de gravação, com a saída escrita.
 *
 * Valor fora do vocabulário é RECUSADO, nunca descartado em silêncio — é a
 * lição do #382 (campo fora da whitelist somia e o modal dizia "salvo").
 */
export function validarRegimeParaGravacao(bruto) {
    if (bruto === '' || bruto == null) return { ok: true, regime: null };
    const r = normalizarRegime(bruto);
    if (!r) {
        return {
            ok: false,
            regime: null,
            motivo: `Regime "${bruto}" não é um dos aceitos. Use um destes: `
                + `${REGIMES_VALIDOS.map(k => `${k} (${REGIMES[k].rotulo})`).join(', ')}.`,
        };
    }
    return { ok: true, regime: r };
}
