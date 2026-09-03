// ============================================================================
// sefaz-backend/catalogo-obrigacoes.js  (PURO — sem io, testável)
// ----------------------------------------------------------------------------
// O CATÁLOGO ÚNICO: o que cada cliente deve, por regime, com prazo.
//
// POR QUE ESTE ARQUIVO EXISTE (escopo do mês fiscal, regra nº 1). Havia TRÊS
// listas de obrigação por regime e elas NÃO concordavam:
//
//   1. tarefas-orchestrator.js  — o cron do dia 1, QUEM CRIA AS TAREFAS DO MÊS.
//      Só conhecia SIMPLES=DAS+FGTS e LUCRO_REAL=DCTFWeb+FGTS+SPED, e mapeava
//      `lucro_empresas → LUCRO_REAL` SEMPRE. Ou seja: LUCRO PRESUMIDO NÃO
//      EXISTIA pro cron. PIS/COFINS, EFD-Contribuições e IRPJ/CSLL trimestral
//      nunca viravam tarefa ⇒ não apareciam em Vencimentos ⇒ não chegavam ao
//      Guia do mês ⇒ o farol dizia "mês fechado" com obrigação nunca listada.
//   2. services/calendarioFiscal.ts — rica (Presumido completo, frequência,
//      último dia útil), mas no FRONT, e o comentário do backend jurava ser
//      "o mesmo mapa, mantido em sync manual". Não era.
//   3. calendario-obrigacoes.js — um terceiro mapa (requireFolha/ISS/UF).
//
// Não era bug de cálculo: era o app REPRODUZINDO a colcha de retalhos que o
// escritório tinha antes (Paulo, 11/08). Agora existe UM catálogo; o front
// importa DESTE arquivo (mesmo padrão de urgencia-vencimento.js) e o cron
// também.
//
// ─── DUAS COISAS QUE ESTE MÓDULO SE RECUSA A FAZER ──────────────────────────
//
// (a) ADIVINHAR REGIME. `lucro_empresas` sem `regimePadrao` NÃO vira Real (nem
//     Presumido): vira 'INDEFINIDO'. Regime decide imposto — adivinhar regime é
//     adivinhar imposto. O que se gera nesse caso são só as obrigações COMUNS
//     aos dois, e as específicas viram pendência NOMEADA. Some da conta, não da
//     tela. (A ListView do Lucro mostra `regimePadrao || 'Presumido'` — esse
//     default é de EXIBIÇÃO e não pode virar verdade aqui.)
//
// (b) INVENTAR PRAZO OU REGRA. Cada obrigação carrega `baseLegal` e o ajuste de
//     dia não útil EXPLÍCITO. Onde a regra ainda não foi conferida com o Paulo/
//     Alexandre, a entrada é marcada `revisar: true` e sai em
//     `pendenciasDeConfirmacao()` — vira checklist, não default silencioso.
//
// ─── ESFERA: FEDERAL, ESTADUAL, MUNICIPAL (Paulo, 11/08) ────────────────────
//
// "Os vencimentos são datas definidas pelos órgãos governamentais, sempre
// separados por esferas: federal, estadual, municipal. Isso nunca se altera e é
// onde deve ser feita a consulta."
//
// A ESFERA é o que diz QUEM define o prazo — e portanto ONDE se confere:
//   'federal'   — vale igual pra todo cliente (RFB/Caixa/CGSN).
//   'estadual'  — varia por UF. O prazo do SPED aqui é o de SP (CAT 147/2009);
//                 cliente de outra UF tem outro, e o catálogo AINDA não sabe
//                 disso — por isso a entrada leva `abrangencia`.
//   'municipal' — varia por MUNICÍPIO. É o caso do ISS, e é o buraco maior:
//                 são 157 empresas de serviço puro na carteira.
//
// `abrangencia` diz até onde a entrada vale: 'BR', 'UF:SP', 'IBGE:3550308'.
// Entrada com abrangência menor que o cliente NÃO se aplica a ele — e o app
// prefere dizer "não sei o prazo deste município" a carimbar o de SP.
//
// ─── ANTECIPA × PRORROGA: A DIVERGÊNCIA QUE JÁ ESTAVA NO AR ─────────────────
//
// Os dois catálogos antigos ajustavam dia não útil em direções OPOSTAS:
// `tarefas-orchestrator` ANTECIPAVA (dia útil anterior) e `calendarioFiscal`
// PRORROGAVA (próximo dia útil). A MESMA obrigação tinha DUAS datas conforme
// quem calculou — e o colaborador via uma na tarefa e outra em Vencimentos.
// Aqui o ajuste é campo da obrigação, não default do módulo:
//   'prorroga' — vence no próximo dia útil;
//   'antecipa' — recolhe no dia útil ANTERIOR.
//
// ✅ DECIDIDO PELO PAULO (11/08): **"sempre antecipa"**. É POLÍTICA DO
// ESCRITÓRIO, e ela é segura por construção: pagar no dia útil anterior nunca
// gera multa, mesmo onde a lei permitiria prorrogar — o inverso, sim. Some
// junto a divergência que existia (o cron antecipava, a tela prorrogava, e a
// mesma obrigação tinha duas datas).
// O campo CONTINUA existindo por obrigação em vez de virar constante do módulo:
// se um prazo específico exigir prorrogação, muda-se UMA linha, com a base
// legal do lado, sem tocar no resto.
// ============================================================================

import { ehDiaUtil } from './feriados-nacionais.js';
import { ajustarDiaUtil } from './calendario-obrigacoes.js';
import { resolverPrazoMunicipal, resolverPrazoEstadual } from './prazos-municipais.js';
import { regimeDaEmpresa, rotuloRegime } from './regime-tributario.js';
// 🏦 DeRE — "esta empresa está em regime específico de IBS/CBS?" tem dono
// único, lido também pela triagem da carteira. Reimplementar aqui seria a
// segunda cópia que faz o mês e a fila discordarem sobre a mesma empresa.
import { decidirDereNoCadastro } from './dere-regimes.js';

/** Regimes que o mês entende. INDEFINIDO é um estado real, não um erro. */
export const REGIMES = ['SIMPLES', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'IMUNE', 'ISENTA', 'INDEFINIDO'];

export const REGIME_LABEL = {
    SIMPLES: 'Simples Nacional',
    LUCRO_PRESUMIDO: 'Lucro Presumido',
    LUCRO_REAL: 'Lucro Real',
    IMUNE: 'Imune',
    ISENTA: 'Isenta',
    INDEFINIDO: 'Regime não definido',
};

/**
 * De onde sai o regime de um cliente.
 *
 * `simples_empresas` já É o regime (a coleção significa isso). Em
 * `lucro_empresas` quem diz é o campo `regimePadrao` ('Presumido' | 'Real'),
 * que é o mesmo que a ficha do Lucro usa pra decidir período de apuração.
 *
 * @param {{colecao?: string, regimePadrao?: string}} empresa
 * @returns {{regime: string, motivo: string|null}} motivo != null quando
 *          INDEFINIDO — é o texto que o alerta mostra.
 */
export function resolverRegime(empresa) {
    // 🚨 O REGIME NÃO É MAIS DEDUZIDO SÓ DA COLEÇÃO.
    //
    // Paulo, 18/08, com o print do CCI: uma IGREJA (COMUNIDADE EVANGÉLICA SARA
    // NOSSA TERRA) aparecia como "Lucro Presumido", porque o CFI deduzia o
    // regime de ONDE a empresa foi cadastrada. Não existia lugar para "imune".
    //
    // A régua agora mora em `regime-tributario.js` (campo explícito > regimePadrao
    // > coleção, com a origem carimbada). Aqui só se traduz o veredito dela para
    // a lista de obrigações.
    const v = regimeDaEmpresa(empresa);

    // ✅ IMUNE e ISENTA TÊM LISTA PRÓPRIA desde 18/08 — respondida pelo Paulo,
    // não deduzida por mim. Antes disso elas caíam em INDEFINIDO de propósito,
    // para não herdarem em SILÊNCIO a lista do Presumido (que punha PIS/COFINS
    // mensal sobre faturamento e EFD ICMS/IPI numa igreja).
    //
    // O que continua valendo: elas NÃO recebem o catálogo do Lucro. A lista
    // delas está em CATALOGO.IMUNE / CATALOGO.ISENTA, com a fala que decidiu
    // cada entrada.
    return { regime: v.regime, motivo: v.motivo };
}

/**
 * CATÁLOGO. Uma entrada por obrigação × regime.
 *
 * O campo-chave chama-se `obrigacao` (não "codigo") de propósito: é o MESMO
 * nome gravado em `tarefas.obrigacao` no Firestore e o que o dedup do cron
 * consulta. Um nome só do banco à tela — nome diferente por camada é como as
 * três listas divergiram sem ninguém ver.
 *
 * status:
 *   'ativa'    — obrigação do regime, sem condição que o app não saiba avaliar.
 *                O cron cria. A LISTA É DA EQUIPE (veio do calendarioFiscal.ts,
 *                o entendimento já escrito pelo escritório) — não é invenção
 *                minha, e por isso ela GERA: deixar de gerar é o defeito que
 *                este arquivo existe pra corrigir.
 *   'proposta' — depende de uma CONDIÇÃO que este app não tem como avaliar
 *                (campo `dependeDe`). Não é dúvida sobre existir a obrigação: é
 *                dúvida sobre ELA SE APLICAR A ESTE cliente. Gerar pra todo
 *                mundo criaria "atrasada" falsa todo mês e ensinaria a equipe a
 *                ignorar o alerta — que é como o farol morre.
 *
 * ajusteDiaNaoUtil: 'prorroga' | 'antecipa'  (ver cabeçalho)
 * revisar: true    — regra/prazo ainda não conferido com o Paulo/Alexandre.
 */
const M = 'mensal', T = 'trimestral', A = 'anual';

const DAS = {
    obrigacao: 'DAS', label: 'DAS', nome: 'DAS Simples Nacional',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: M, diaVencimento: 20, mesesApos: 1,
    ajusteDiaNaoUtil: 'antecipa',
    // A lei permite prorrogar; a política do escritório é antecipar (nunca
    // depois). Pagar antes não tem penalidade.
    baseLegal: 'LC 123/2006 art. 21 §3º (dia 20) — política do escritório: antecipa',
    status: 'ativa',
};
const FGTS = {
    obrigacao: 'FGTS', label: 'FGTS Digital', nome: 'FGTS Digital',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: M, diaVencimento: 20, mesesApos: 1,
    // Resolvido em 11/08: o cron antecipava, a tela prorrogava (19/06 × 22/06).
    // Paulo decidiu ANTECIPA, e para o FGTS é também a régua legal.
    ajusteDiaNaoUtil: 'antecipa',
    baseLegal: 'Lei 8.036/90 art. 15 (dia 20; sem expediente, antecipa)',
    status: 'ativa',
};
const DCTFWEB = {
    obrigacao: 'DCTFWEB', label: 'DCTFWeb', nome: 'DCTFWeb',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: M, diaVencimento: 15, mesesApos: 1,
    ajusteDiaNaoUtil: 'antecipa',
    baseLegal: 'IN RFB 2.005/2021 (até o dia 15 do mês seguinte)',
    status: 'ativa',
};
const SPED = {
    obrigacao: 'SPED', label: 'SPED Fiscal', nome: 'EFD ICMS/IPI',
    // ESTADUAL: este prazo é o de SÃO PAULO. Cliente de outra UF tem outro e o
    // catálogo ainda não os tem — a abrangência denuncia isso em vez de fingir.
    esfera: 'estadual', abrangencia: 'UF:SP',
    frequencia: M, diaVencimento: 25, mesesApos: 2,
    ajusteDiaNaoUtil: 'antecipa',
    baseLegal: 'Portaria CAT 147/2009 (SP) — prazo estadual',
    status: 'ativa', revisar: true,
};
const INSS_CPP = {
    obrigacao: 'INSS_CPP', label: 'INSS Patronal', nome: 'INSS Patronal (CPP)',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: M, diaVencimento: 20, mesesApos: 1,
    ajusteDiaNaoUtil: 'antecipa',
    baseLegal: 'Lei 8.212/91 art. 30, I, "b"',
    // Só existe com FOLHA, e a folha mora no módulo de DP — este app não tem
    // como afirmar que o cliente tem empregado. Gerar pra todos criaria uma
    // pendência falsa por mês em quem não tem folha.
    status: 'proposta', dependeDe: 'folha', revisar: true,
};
const PIS_COFINS = {
    obrigacao: 'PIS_COFINS', label: 'PIS/COFINS', nome: 'PIS/COFINS',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: M, diaVencimento: 25, mesesApos: 1,
    ajusteDiaNaoUtil: 'antecipa',
    baseLegal: 'Lei 11.933/2009 (25º dia do mês seguinte)',
    status: 'ativa',
};
const EFD_CONTRIB = {
    obrigacao: 'EFD_CONTRIB', label: 'EFD-Contribuições', nome: 'EFD-Contribuições',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: M, diaVencimento: 14, mesesApos: 2,
    ajusteDiaNaoUtil: 'antecipa',
    baseLegal: 'IN RFB 1.252/2012 art. 7º (10º dia útil do 2º mês subsequente)',
    status: 'ativa', revisar: true,
};
const IRPJ_TRIM = {
    obrigacao: 'IRPJ_TRIM', label: 'IRPJ Trimestral', nome: 'IRPJ Trimestral',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: T, diaVencimento: 0, mesesApos: 1, ultimoDiaUtilDoMes: true,
    ajusteDiaNaoUtil: 'antecipa',
    baseLegal: 'Lei 9.430/96 art. 5º (último dia útil do mês seguinte ao trimestre)',
    status: 'ativa',
};
const CSLL_TRIM = {
    ...IRPJ_TRIM, obrigacao: 'CSLL_TRIM', label: 'CSLL Trimestral', nome: 'CSLL Trimestral',
};
const DEFIS = {
    obrigacao: 'DEFIS', label: 'DEFIS', nome: 'DEFIS',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: A, diaVencimento: 31, mesesApos: 3, ultimoDiaUtilDoMes: true,
    ajusteDiaNaoUtil: 'antecipa',
    baseLegal: 'Res. CGSN 140/2018 art. 72 (até 31/03 do ano seguinte)',
    status: 'ativa', revisar: true,
};
const ECF = {
    obrigacao: 'ECF', label: 'ECF', nome: 'ECF',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: A, diaVencimento: 31, mesesApos: 7, ultimoDiaUtilDoMes: true,
    ajusteDiaNaoUtil: 'antecipa',
    baseLegal: 'IN RFB 2.004/2021 (último dia útil de julho)',
    status: 'ativa', revisar: true,
};
const ECD = {
    obrigacao: 'ECD', label: 'ECD', nome: 'ECD',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: A, diaVencimento: 30, mesesApos: 6, ultimoDiaUtilDoMes: true,
    ajusteDiaNaoUtil: 'antecipa',
    baseLegal: 'IN RFB 2.003/2021 (último dia útil de junho)',
    status: 'ativa', revisar: true,
};

// ISS PRÓPRIO — a esfera MUNICIPAL, que não existia neste catálogo.
// Dois motivos pra ele nascer 'proposta' e não gerar tarefa ainda:
//   (1) o prazo é do MUNICÍPIO e varia — não existe "dia do ISS" nacional, e
//       carimbar o de SP em cliente de outro município seria inventar prazo;
//   (2) optante do Simples NÃO recolhe ISS próprio em guia do município: ele
//       já está dentro do DAS (LC 123 art. 13). Gerar pra optante seria cobrar
//       duas vezes — o defeito que o painel 🏛️ ISS já corrigiu em 06/08.
// É exatamente a lacuna que a consulta mensal por esfera (Paulo, 11/08) existe
// pra preencher: enquanto o calendário municipal não estiver cadastrado, o ISS
// aparece NOMEADO como pendência em vez de sumir do mês.
const ISS = {
    obrigacao: 'ISS', label: 'ISS próprio', nome: 'ISS sobre serviços prestados',
    esfera: 'municipal', abrangencia: 'IBGE:?',
    frequencia: M, diaVencimento: 10, mesesApos: 1,
    ajusteDiaNaoUtil: 'antecipa',
    baseLegal: 'LC 116/2003 + legislação do MUNICÍPIO — prazo A CADASTRAR por município',
    status: 'proposta', dependeDe: 'calendário do município', revisar: true,
};

// 🏦 DeRE — DECLARAÇÃO ELETRÔNICA DE REGIMES ESPECÍFICOS (IBS/CBS/IS).
//
// A obrigação acessória da reforma tributária para quem fornece sob REGIME
// ESPECÍFICO do Título V da LC 214/2025 (serviços financeiros, planos de saúde,
// loterias…). Paulo, 02/09: *"crie uma nova função capaz de atender esta
// obrigação chamada DERE"*.
//
// Por que ela nasce `proposta`: o que decide se ELA SE APLICA a um cliente é
// um fato de cadastro que o app não tem como deduzir — em qual regime
// específico a empresa opera. `mesDoCliente` PROMOVE a entrada a 'ativa' quando
// o cadastro afirma um regime obrigado, e a TIRA da lista quando o cadastro diz
// "não se aplica" (ver `resolverDereDoCliente`). Empresa sem cadastro e sem
// sinal de CNAE NÃO vira pendência — seria acender a carteira inteira por um
// campo que 400 clientes nunca vão precisar preencher (a lição das 236 em ALTO).
//
// `vigenciaDesde`: a 1ª competência com escrituração mensal é 10/2026 (Ato
// Conjunto RFB/CGIBS 4/2026 — entrega até 15/11/2026). Antes disso a entrada
// não nasce em mês nenhum, para não cobrar obrigação que ainda não existia.
//
// ⚠️ O PRAZO É "ATÉ O DIA 15 DO MÊS SEGUINTE" e, pelo esclarecimento CGIBS/RFB
// de 26/08, NÃO se prorroga quando cai em dia não útil — o que casa com a
// política da casa de sempre antecipar. Optante do Simples fica FORA (não é a
// lista dele). ⚠️ O PRAZO continua conhecido por RESUMO de terceiros (o Ato
// Conjunto 4/2026 não foi lido — gov.br bloqueado nesta rede); o QUE se declara
// e QUEM cabe saem dos leiautes 1.1.0 LIDOS (docs/dere/). Por isso `revisar: true`.
const DERE = {
    obrigacao: 'DERE', label: 'DeRE', nome: 'DeRE — Declaração de Regimes Específicos (IBS/CBS)',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: M, diaVencimento: 15, mesesApos: 1,
    ajusteDiaNaoUtil: 'antecipa',
    baseLegal: 'LC 214/2025 (Título V — regimes específicos) · Ato Conjunto RFB/CGIBS 4/2026 (dia 15 do mês '
        + 'seguinte à competência; 1ª competência 10/2026, entrega até 15/11/2026; prazo não prorroga em dia não útil)',
    status: 'proposta', dependeDe: 'regime específico de IBS/CBS no cadastro (Dados Fiscais)',
    vigenciaDesde: '10/2026',
    revisar: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// IMUNES, ISENTAS E TERCEIRO SETOR — as respostas do Paulo, 18/08
// ═══════════════════════════════════════════════════════════════════════════
//
// Perguntei três coisas e ele respondeu as três. Cada entrada abaixo carrega a
// FALA que a decidiu — é o que separa encodar uma decisão de deduzir uma.
//
// ⚠️ Até aqui a entidade imune HERDAVA a lista do Presumido, porque o regime era
// deduzido da COLEÇÃO em que ela tinha sido cadastrada. Isso punha PIS/COFINS
// MENSAL sobre faturamento e EFD ICMS/IPI numa igreja.

const DCTFWEB_EVENTOS = {
    ...DCTFWEB,
    // "apenas quando houver eventos (ALUGUEL/FOLHA/RETIDOS FISCAL)"
    status: 'proposta',
    dependeDe: 'evento no mês (aluguel, folha ou retenção)',
    baseLegal: DCTFWEB.baseLegal + ' — imune/isenta: só com evento (Paulo, 18/08)',
};
// ❌ FGTS SAIU DA LISTA — pergunta respondida, 18/08.
//
// Eu tinha incluído FGTS_SE_FOLHA como EXTENSÃO MINHA (ele citou FOLHA entre os
// eventos da DCTFWeb, e FGTS é consequência de folha) e marquei para confirmar.
// Paulo respondeu: *"FGTS é um imposto gerado pelo departamento pessoal, não faz
// base para impostos gerados pelo CFI"*.
//
// Ou seja: mesmo quando a imune/isenta TEM folha, o FGTS não é obrigação que o
// CFI acompanha — é do módulo de DP. Extensão minha, dedução errada, removida.
const INSS_CPP_SE_FOLHA = { ...INSS_CPP, revisar: true };
const ECD_SE_MOVIMENTO = {
    ...ECD,
    // "entrega se tiver movimento financeiro"
    status: 'proposta',
    dependeDe: 'movimento financeiro no ano',
    baseLegal: ECD.baseLegal + ' — imune/isenta: só com movimento financeiro (Paulo, 18/08)',
};
const ECF_SE_MOVIMENTO = {
    ...ECF,
    status: 'proposta',
    dependeDe: 'movimento financeiro no ano',
    baseLegal: ECF.baseLegal + ' — imune/isenta: só com movimento financeiro (Paulo, 18/08)',
};
const EFD_CONTRIB_ANUAL = {
    ...EFD_CONTRIB,
    // "Apenas em dezembro, indicando sem movimento."
    // `frequencia: A` já significa "competência que FECHA o ano" (dezembro) —
    // é a mesma régua da DEFIS, não uma exceção nova.
    frequencia: A,
    label: 'EFD-Contribuições (anual, dez)',
    nome: 'EFD-Contribuições — dezembro, sem movimento',
    baseLegal: EFD_CONTRIB.baseLegal + ' — imune/isenta: só a competência 12, sem movimento (Paulo, 18/08)',
    status: 'ativa',
    // 🚩 FIM DE VIGÊNCIA ESPERADO, NÃO CONFIRMADO. Paulo, 18/08: *"com a reforma
    // estão indicando que essa obrigação encerra em 12/2026"*. "Estão indicando"
    // não é norma publicada, então o app **continua gerando** e DIZ a ressalva:
    // parar de gerar por causa de uma expectativa faria a obrigação sumir em
    // silêncio, e sumir da tela é pior que aparecer com ressalva.
    vigenciaAteEsperada: '12/2026',
    vigenciaRessalva: 'Com a reforma tributária (extinção de PIS/COFINS), a expectativa é que esta '
        + 'obrigação encerre em 12/2026. Enquanto não houver norma publicada, o CFI CONTINUA gerando — '
        + 'confira antes de deixar de entregar.',
};

// A DeRE entra no COMUM do Lucro: ela independe de Presumido × Real — o que
// decide é o regime ESPECÍFICO de IBS/CBS, resolvido pelo cadastro no mês.
const COMUNS_LUCRO = [DCTFWEB, FGTS, INSS_CPP, PIS_COFINS, EFD_CONTRIB, SPED, ISS, DERE];

/**
 * A lista da IMUNE e da ISENTA.
 *
 * O que ela NÃO tem, e por quê: **PIS/COFINS mensal** (a resposta dele sobre a
 * EFD-Contribuições — só dezembro, sem movimento — diz que não há contribuição
 * mensal a declarar; e no terceiro setor o PIS é sobre a FOLHA, não sobre o
 * faturamento), **EFD ICMS/IPI** (obrigação de contribuinte de ICMS) e
 * **FGTS** (Paulo, 18/08: *"FGTS é um imposto gerado pelo departamento
 * pessoal, não faz base para impostos gerados pelo CFI"* — mesmo havendo
 * folha, o FGTS Digital não é obrigação que este catálogo acompanha; é do
 * módulo de DP).
 */
const IMUNE_ISENTA = [
    DCTFWEB_EVENTOS, INSS_CPP_SE_FOLHA,
    EFD_CONTRIB_ANUAL, ECD_SE_MOVIMENTO, ECF_SE_MOVIMENTO,
    // A DeRE alcança "todas as pessoas jurídicas, INCLUSIVE imunes e isentas"
    // que forneçam sob regime específico (esclarecimento CGIBS/RFB) — uma
    // cooperativa de saúde imune é exatamente o caso. Continua `proposta`: só
    // o cadastro a promove.
    DERE,
];

export const CATALOGO = {
    SIMPLES: [DAS, FGTS, DEFIS],
    LUCRO_PRESUMIDO: [...COMUNS_LUCRO, IRPJ_TRIM, CSLL_TRIM, ECF, ECD],
    LUCRO_REAL: [...COMUNS_LUCRO, IRPJ_TRIM, CSLL_TRIM, ECF, ECD],
    IMUNE: IMUNE_ISENTA,
    ISENTA: IMUNE_ISENTA,
    // Regime indefinido NÃO fica vazio (isso apagaria o cliente do mês) e NÃO
    // recebe o catálogo do Lucro inteiro (isso escolheria um regime). Recebe o
    // que é comum aos dois — o que dá pra afirmar sem saber qual deles é.
    INDEFINIDO: COMUNS_LUCRO,
};

/**
 * MM/AAAA → {mes, ano}. LANÇA em competência inválida (não devolve default).
 * Exposta como `assertCompetencia` pra quem processa em lote validar UMA vez,
 * na porta: sem isso o erro se repete por cliente e vira 800 linhas de log em
 * vez de uma falha clara — e o lote termina "sem erro visível" tendo criado
 * zero tarefa.
 */
function partesDaCompetencia(competencia) {
    const [mesStr, anoStr] = String(competencia || '').split('/');
    const mes = parseInt(mesStr, 10);
    const ano = parseInt(anoStr, 10);
    if (!Number.isFinite(mes) || !Number.isFinite(ano) || mes < 1 || mes > 12) {
        throw new Error(`competencia invalida: "${competencia}" (esperado MM/AAAA)`);
    }
    return { mes, ano };
}

/** Valida na porta. Lança com a mensagem que diz o formato esperado. */
export function assertCompetencia(competencia) {
    partesDaCompetencia(competencia);
    return competencia;
}

/** Ordena duas competências MM/AAAA: <0 se `a` vem antes de `b`. */
export function compararCompetencias(a, b) {
    const pa = partesDaCompetencia(a);
    const pb = partesDaCompetencia(b);
    return (pa.ano * 12 + pa.mes) - (pb.ano * 12 + pb.mes);
}

export function competenciaFechaTrimestre(competencia) {
    const { mes } = partesDaCompetencia(competencia);
    return mes === 3 || mes === 6 || mes === 9 || mes === 12;
}

export function competenciaFechaAno(competencia) {
    return partesDaCompetencia(competencia).mes === 12;
}

/**
 * Data de vencimento REAL de uma obrigação numa competência.
 *
 * `ultimoDiaUtilDoMes` ignora o dia e usa o último dia útil do mês-alvo (recua,
 * porque prorrogar cairia no mês seguinte — outro prazo).
 * Fora disso, o ajuste segue o campo `ajusteDiaNaoUtil` da obrigação.
 *
 * @returns {Date} 00:00 local
 */
export function calcularVencimento(competencia, regra) {
    // 🚨 SEM DIA NÃO HÁ DATA — e ela NÃO se inventa.
    //
    // Desde 16/08 a obrigação municipal sem calendário circula com
    // `diaVencimento: null` (a data é pedida no fluxo). Sem esta guarda, o
    // cálculo devolvia uma data VÁLIDA E ERRADA: para a competência 06/2026
    // saía 29/05/2026 — no PASSADO. A tarefa nasceria já ATRASADA, vermelha na
    // Rotina, para todo cliente de cidade sem calendário. E passaria calada,
    // porque data inválida ao menos explodiria; data errada, não.
    // ⚠️ A guarda vale só para regra que depende de DIA FIXO. Obrigação de
    // "último dia útil do mês" não tem `diaVencimento` e continua calculando —
    // pôr a guarda antes dela zerou três prazos trimestrais, e os testes que já
    // existiam pegaram na hora.
    if (!regra?.ultimoDiaUtilDoMes) {
        // `Number(null)` é 0 e `isInteger(0)` é TRUE — este mesmo `Number(null)`
        // já me pegou duas vezes hoje. O `== null` vem PRIMEIRO, e é ele que faz
        // a guarda existir. String vazia também vira 0.
        const dia = Number(regra?.diaVencimento);
        if (regra?.diaVencimento == null || regra?.diaVencimento === ''
            || !Number.isInteger(dia) || dia < 1 || dia > 31) return null;
    }
    const { mes, ano } = partesDaCompetencia(competencia);
    const desloc = mes - 1 + Number(regra.mesesApos || 0);
    const anoAlvo = ano + Math.floor(desloc / 12);
    const mesAlvo = ((desloc % 12) + 12) % 12;

    if (regra.ultimoDiaUtilDoMes) {
        const d = new Date(anoAlvo, mesAlvo + 1, 0);
        while (!ehDiaUtil(d)) d.setDate(d.getDate() - 1);
        return d;
    }

    // O ajuste de dia não útil tem DONO (`ajustarDiaUtil`, o mesmo do DARF):
    // esta era a segunda cópia, com outro vocabulário de modo ('antecipa' aqui,
    // 'antecipar' lá) — a política da casa é ANTECIPAR (Paulo, 11/08), e o
    // campo da obrigação continua decidindo.
    const modo = regra.ajusteDiaNaoUtil === 'antecipa' ? 'antecipar' : 'postergar';
    const [y, m, dd] = ajustarDiaUtil(anoAlvo, mesAlvo + 1, Number(regra.diaVencimento), modo).split('-').map(Number);
    return new Date(y, m - 1, dd);
}

/**
 * As obrigações que se aplicam a um regime numa competência.
 *
 * @param {string} regime
 * @param {string} competencia MM/AAAA
 * @param {{incluirPropostas?: boolean}} [opts] — o cron chama SEM propostas
 *        (não cria tarefa que ninguém confirmou); as telas chamam COM, pra
 *        mostrar o que está esperando confirmação em vez de escondê-lo.
 */
export function obrigacoesAplicaveis(regime, competencia, opts = {}) {
    // Valida ANTES de qualquer atalho: a obrigação mensal não depende da
    // competência pra ser aplicável, então sem esta linha um "2026-05" passava
    // batido e o mês saía montado em cima de competência inválida.
    partesDaCompetencia(competencia);
    const lista = CATALOGO[regime];
    if (!lista) return [];
    const incluirPropostas = opts.incluirPropostas === true;
    return lista.filter((r) => {
        if (!incluirPropostas && r.status !== 'ativa') return false;
        // Obrigação com INÍCIO de vigência não nasce em competência anterior a
        // ele — cobrar a DeRE em 09/2026 seria cobrar o que ainda não existia.
        if (r.vigenciaDesde && compararCompetencias(competencia, r.vigenciaDesde) < 0) return false;
        if (r.frequencia === M) return true;
        if (r.frequencia === T) return competenciaFechaTrimestre(competencia);
        if (r.frequencia === A) return competenciaFechaAno(competencia);
        return false;
    });
}

/**
 * Normaliza o regime para as CHAVES do catálogo.
 *
 * 🚨 O app tem DOIS vocabulários de regime e eles não batem. O perfil do
 * cliente usa `LUCRO_REAL_INDUSTRIA` / `LUCRO_REAL_SERVICOS` /
 * `LUCRO_REAL_COMERCIO`; o catálogo tem `LUCRO_REAL`. `CATALOGO[regime]` com
 * uma dessas chaves é `undefined`, e `obrigacoesAplicaveis` devolvia **lista
 * vazia em SILÊNCIO** — ou seja, o caminho de auto-gerar tarefas da tela de
 * Tarefas criava ZERO obrigação para todo cliente do Lucro Real, e as
 * estatísticas mostravam "0 criadas" como se não houvesse o que criar.
 *
 * @returns {{regime: string, reconhecido: boolean}}
 */
/**
 * 'MM/AAAA' (formato deste catálogo) → 'AAAA-MM' (formato do resto do app).
 *
 * ⚠️ Este descasamento mordeu TRÊS vezes em 15/08 — uma delas em silêncio, com
 * a vigência nunca casando e o ISS continuando pendente como se ninguém
 * tivesse cadastrado nada. A conversão mora AQUI, num lugar só: mudar o
 * formato do catálogo quebraria o cron que cria o mês inteiro.
 */
export function competenciaIsoDe(competencia) {
    const { mes, ano } = partesDaCompetencia(competencia);
    return `${ano}-${String(mes).padStart(2, '0')}`;
}

export function normalizarRegimeCatalogo(regime) {
    const r = String(regime || '').trim().toUpperCase();
    if (!r) return { regime: 'INDEFINIDO', reconhecido: false };
    if (CATALOGO[r]) return { regime: r, reconhecido: true };
    // A sub-especialização do Lucro Real (indústria/serviços/comércio) muda a
    // ANÁLISE de crédito, não as obrigações do mês.
    if (r.startsWith('LUCRO_REAL')) return { regime: 'LUCRO_REAL', reconhecido: true };
    if (r.startsWith('LUCRO_PRESUMIDO')) return { regime: 'LUCRO_PRESUMIDO', reconhecido: true };
    if (r.startsWith('SIMPLES')) return { regime: 'SIMPLES', reconhecido: true };
    // Desconhecido NÃO vira lista vazia calada: quem chama precisa poder
    // contar e nomear o que ficou de fora.
    return { regime: 'INDEFINIDO', reconhecido: false };
}

/**
 * As obrigações de UM cliente, já com o calendário MUNICIPAL resolvido.
 *
 * É o núcleo compartilhado entre `mesDoCliente` (usado pelo cron e pela
 * Rotina) e os caminhos que já sabem o regime. Sem isto, cada caminho
 * reimplementaria a resolução municipal — e um deles ficaria para trás, que é
 * exatamente o que aconteceu com o cron.
 */
export function obrigacoesDoCliente(regime, competencia, {
    uf = '', codMunIBGE = '', prazosMunicipais = [], cnae = '', regimeEspecificoIbsCbs = '',
} = {}) {
    const { regime: chave, reconhecido } = normalizarRegimeCatalogo(regime);
    const mes = mesDoCliente({
        // 🏦 DeRE: sem estes dois o mês responderia `sem-sinal` para TODO
        // cliente — o cadastro que afirma o regime específico nunca chegaria.
        cnae, regimeEspecificoIbsCbs,
        colecao: chave === 'SIMPLES' ? 'simples_empresas' : 'lucro_empresas',
        regimePadrao: chave === 'LUCRO_PRESUMIDO' ? 'presumido' : (chave === 'LUCRO_REAL' ? 'real' : ''),
        // IMUNE/ISENTA não têm coleção própria — sem o campo explícito aqui,
        // `resolverRegime` cairia em INDEFINIDO e a entidade voltaria a receber
        // a lista comum do Lucro, que é justamente o defeito corrigido.
        regimeTributario: (chave === 'IMUNE' || chave === 'ISENTA') ? chave : undefined,
        uf, codMunIBGE, prazosMunicipais,
    }, competencia);
    return { ...mes, regimeReconhecido: reconhecido, regimeInformado: regime };
}

/**
 * A entrada vale para este cliente? Responde pela ABRANGÊNCIA.
 *
 * 🚨 O CAMPO EXISTIA DESDE 11/08 E NUNCA FOI APLICADO. O comentário no topo
 * deste arquivo já dizia *"o app prefere dizer 'não sei o prazo deste
 * município' a carimbar o de SP"* — e era exatamente o contrário que
 * acontecia: o prazo do SPED (`UF:SP`, CAT 147/2009) era entregue a TODO
 * cliente do Lucro, morasse ele onde morasse. Prazo errado entregue com
 * confiança é o erro mais caro que este app pode cometer, porque quem lê não
 * tem como desconfiar.
 *
 * @returns {'aplica'|'fora-de-abrangencia'|'uf-desconhecida'}
 */
export function alcanceDaObrigacao(regra, { uf } = {}) {
    const abr = String(regra?.abrangencia || 'BR').trim();
    if (abr === 'BR' || !abr) return 'aplica';
    if (abr.startsWith('UF:')) {
        const alvo = abr.slice(3).toUpperCase();
        const daEmpresa = String(uf || '').trim().toUpperCase();
        // SEM UF NÃO SE AFIRMA NADA. Assumir "é de SP" seria carimbar o prazo
        // paulista em quem talvez não seja — e assumir "não é" faria a
        // obrigação sumir de quem tem ela. Ausência é ausência.
        if (!daEmpresa) return 'uf-desconhecida';
        return daEmpresa === alvo ? 'aplica' : 'fora-de-abrangencia';
    }
    // 'IBGE:?' e afins: o município ainda não tem prazo cadastrado. Já cai em
    // `status: 'proposta'` e é tratado como pendência nomeada.
    return 'aplica';
}

/**
 * O MÊS DE UM CLIENTE — a resposta que o colaborador precisa.
 *
 * Devolve o que gerar, o que está esperando confirmação e o que NÃO dá pra
 * afirmar por falta de regime. Farol honesto: nada some em silêncio.
 */
export function mesDoCliente(empresa, competencia) {
    const { regime, motivo } = resolverRegime(empresa);
    const ativas = obrigacoesAplicaveis(regime, competencia);
    const todas = obrigacoesAplicaveis(regime, competencia, { incluirPropostas: true });
    const propostas = todas.filter((r) => r.status !== 'ativa');

    // ── ABRANGÊNCIA: o prazo é DAQUELE cliente? ─────────────────────────────
    // O catálogo só tem o prazo ESTADUAL de SP. Para cliente de outra UF a
    // obrigação existe e o PRAZO não — e isso precisa ser dito, não coberto.
    const uf = String(empresa?.uf || '').trim().toUpperCase();
    const prazosCadastrados = empresa?.prazosMunicipais || [];
    const prazoDeOutraUf = [];
    const prazoSemUfDoCliente = [];
    // Obrigação estadual que ganhou o prazo do estado DO CLIENTE. Antes o
    // alerta da manhã não tinha saída: quem era do Paraná via "a data é a de
    // SP" e não tinha onde cadastrar a do Paraná. Denunciar sem dar caminho é
    // meia correção.
    const estaduaisResolvidas = new Map();
    for (const r of ativas) {
        const alcance = alcanceDaObrigacao(r, { uf });
        if (alcance === 'fora-de-abrangencia') {
            const doEstado = resolverPrazoEstadual(prazosCadastrados, {
                uf, obrigacao: r.obrigacao, competencia: competenciaIsoDe(competencia),
            });
            if (doEstado.achou) {
                estaduaisResolvidas.set(r.obrigacao, {
                    ...r,
                    diaVencimento: doEstado.prazo.diaVencimento,
                    mesesApos: doEstado.prazo.mesesApos,
                    ajusteDiaNaoUtil: doEstado.prazo.ajusteDiaNaoUtil,
                    abrangencia: `UF:${uf}`,
                    baseLegal: doEstado.prazo.baseLegal,
                    prazoEstadual: doEstado.prazo,
                });
                continue; // resolvido: não é mais "prazo de outra UF"
            }
            prazoDeOutraUf.push({
                ...r,
                motivoAbrangencia: `O prazo cadastrado é o de ${r.abrangencia.replace('UF:', '')} `
                    + `(${r.baseLegal}) e este cliente é de ${uf}. A obrigação existe; o PRAZO do estado dele não está no app. `
                    + `Cadastre em ⚙️ Config Admin → Calendário de prazos (esfera estadual, UF ${uf}).`,
            });
        } else if (alcance === 'uf-desconhecida') {
            prazoSemUfDoCliente.push({
                ...r,
                motivoAbrangencia: 'A UF do cliente não está cadastrada, então não dá para afirmar '
                    + `se o prazo de ${r.abrangencia.replace('UF:', '')} vale para ele.`,
            });
        }
    }

    // ── CALENDÁRIO MUNICIPAL: o ISS deixa de ser pendência PARA QUEM TEM ────
    //
    // A entrada do ISS nasce `proposta` porque não existe "dia do ISS"
    // nacional. Quando o calendário do MUNICÍPIO daquele cliente está
    // cadastrado (com vigência e base legal), ela vira obrigação de verdade,
    // com data — para AQUELE cliente, nunca para os outros.
    const prazosMunicipais = empresa?.prazosMunicipais || [];
    // ⚠️ ESTE CATÁLOGO FALA 'MM/AAAA' e o resto do app fala 'AAAA-MM'. Passar
    // direto faz a vigência NUNCA casar — e o efeito é silencioso: o ISS
    // simplesmente continua pendente, como se ninguém tivesse cadastrado nada.
    // É a SEGUNDA vez que este mesmo descasamento morde hoje (a primeira foi a
    // cobertura na Rotina, e ali ele ao menos explodia). Convertido na
    // fronteira: mudar o formato do catálogo quebraria o cron do mês inteiro.
    const competenciaIso = competenciaIsoDe(competencia);
    const municipaisResolvidas = [];
    for (const r of propostas) {
        if (r.esfera !== 'municipal') continue;
        const achado = resolverPrazoMunicipal(prazosMunicipais, {
            codMunIBGE: empresa?.codMunIBGE, obrigacao: r.obrigacao, competencia: competenciaIso,
        });
        if (!achado.achou) continue;
        municipaisResolvidas.push({
            ...r,
            status: 'ativa',
            diaVencimento: achado.prazo.diaVencimento,
            mesesApos: achado.prazo.mesesApos,
            ajusteDiaNaoUtil: achado.prazo.ajusteDiaNaoUtil,
            abrangencia: `IBGE:${achado.prazo.codMunIBGE}`,
            // A base legal do MUNICÍPIO substitui o "a cadastrar" genérico —
            // é ela que a pessoa confere se o prazo for questionado.
            baseLegal: achado.prazo.baseLegal,
            dependeDe: null,
            revisar: false,
            prazoMunicipal: achado.prazo,
        });
    }
    const resolvidasPorCodigo = new Set(municipaisResolvidas.map((r) => r.obrigacao));

    // ═══ O ISS DEIXA DE SER PENDÊNCIA BLOQUEANTE (Paulo, 16/08) ═════════════
    //
    // *"Eu não vou fazer nada manual. (...) No caso de ISS de outra cidade,
    // deve abrir o modal de data de vencimento para que o colaborador insira a
    // data na hora do cálculo e geração da guia — assim eliminamos esta
    // pendência e seguimos para o próximo."*
    //
    // Antes, cidade sem calendário fazia a obrigação NÃO EXISTIR: ela ficava
    // numa fila de admin e o mês do cliente saía sem ISS. Agora ela NASCE, sem
    // data, marcada `vencimentoAInformar` — some da fila e aparece onde o
    // trabalho acontece. É a régua de sempre: **sumir da tela é pior que
    // aparecer com ressalva**.
    //
    // A data continua NÃO SENDO CHUTADA: sem calendário não há vencimento, e o
    // app diz isso em vez de carimbar o dia de outra cidade.
    const municipaisSemPrazo = propostas
        .filter((r) => r.esfera === 'municipal' && !resolvidasPorCodigo.has(r.obrigacao) && !!empresa?.codMunIBGE)
        .map((r) => ({
            ...r,
            status: 'ativa',
            dependeDe: null,
            /** A tarefa nasce SEM data — quem informa é quem gera a guia. */
            vencimentoAInformar: true,
            // 🚨 O PLACEHOLDER SAI. A entrada do ISS no catálogo carrega
            // `diaVencimento: 10` desde que ela era só pendência (não circulava
            // e ninguém lia). Agora que a obrigação VIAJA, esse 10 seria lido
            // como dia de verdade — e é justamente o dia de São Paulo, o que
            // faria o número certo aparecer na cidade errada por coincidência.
            // Campo de prazo não recebe default: sem calendário, é NULO.
            diaVencimento: null,
            mesesApos: null,
            motivoSemPrazo: 'O calendário de ISS deste município ainda não foi informado. '
                + 'A data é pedida na hora de trabalhar a obrigação, e depois disso vale para todos os clientes da cidade.',
        }));
    const semPrazoPorCodigo = new Set(municipaisSemPrazo.map((r) => r.obrigacao));

    // ═══ 🏦 DeRE: O CADASTRO DECIDE, E O SILÊNCIO NÃO ACENDE A CARTEIRA ═════
    //
    // A entrada nasce `proposta` porque "esta empresa fornece sob regime
    // específico de IBS/CBS?" é fato de CADASTRO. Quatro saídas, com ações
    // opostas, e por isso separadas (ver `decidirDereNoCadastro`):
    //   · obrigada        ⇒ vira obrigação ATIVA, com vencimento — o cron cria;
    //   · nao-se-aplica / sem-sinal ⇒ SAI das pendências (não é alarme: é o
    //     caso comum da carteira), mas fica DITA em `dere.decisao`;
    //   · candidata (CNAE sugere) / regime-nao-confirmado ⇒ continua pendência
    //     NOMEADA, com o motivo específico no lugar do genérico.
    const dere = resolverDereDoCliente(empresa, regime, propostas);

    // O que continua pendente é só o que NÃO foi resolvido pelo cadastro NEM
    // virou obrigação com data a informar (hoje sobra o INSS patronal, que
    // depende da folha — informação que ninguém no fiscal tem para dar).
    const propostasPendentes = propostas
        .filter((r) => !resolvidasPorCodigo.has(r.obrigacao) && !semPrazoPorCodigo.has(r.obrigacao))
        .filter((r) => r.obrigacao !== 'DERE' || dere.pendente)
        .map((r) => (r.obrigacao === 'DERE' && dere.pendente ? dere.pendente : r));

    const alertas = [];
    if (prazoDeOutraUf.length) {
        alertas.push({
            tipo: 'prazo-de-outra-uf',
            texto: `${prazoDeOutraUf.length} obrigação(ões) ESTADUAL(is) com prazo cadastrado de outra UF: `
                + prazoDeOutraUf.map((r) => `${r.label} (${r.abrangencia})`).join(', ')
                + `. Este cliente é de ${uf}.`,
            acao: 'Confira o prazo na SEFAZ do estado do cliente antes de entregar — a data que aparece aqui é a de SP.',
        });
    }
    if (prazoSemUfDoCliente.length) {
        alertas.push({
            tipo: 'uf-do-cliente-ausente',
            texto: `A UF do cliente não está cadastrada, então ${prazoSemUfDoCliente.length} `
                + 'obrigação(ões) estadual(is) ficam sem prazo confiável.',
            acao: 'Preencha a UF nos Dados Fiscais do cliente — é ela que decide qual calendário estadual vale.',
        });
    }
    if (regime === 'INDEFINIDO') {
        alertas.push({
            tipo: 'regime-indefinido',
            texto: motivo,
            acao: 'Defina o Regime padrão (Presumido ou Real) na ficha do cliente no card Lucro.',
        });
    }
    if (propostasPendentes.length) {
        alertas.push({
            tipo: 'obrigacoes-a-confirmar',
            texto: `${propostasPendentes.length} obrigação(ões) do regime dependem de informação que este app não tem: `
                + propostasPendentes.map((r) => `${r.label} (depende de ${r.dependeDe})`).join(', ') + '.',
            acao: 'Confirmar caso a caso — enquanto isso elas NÃO viram tarefa automática.',
        });
    }

    return {
        regime,
        regimeLabel: REGIME_LABEL[regime],
        competencia,
        obrigacoes: [
            ...ativas.map((r) => estaduaisResolvidas.get(r.obrigacao) || r),
            ...municipaisResolvidas,
            ...(dere.ativa ? [dere.ativa] : []),
        ].map((r) => ({ ...r, vencimento: calcularVencimento(competencia, r) }))
            // Sem calendário não há data: `vencimento` fica NULO em vez de
            // receber o dia de outra cidade. Ausente ≠ chutado.
            .concat(municipaisSemPrazo.map((r) => ({ ...r, vencimento: null }))),
        /** Municipais que existem mas ainda não têm data — pedida no fluxo. */
        municipaisSemPrazo,
        /** Estaduais que ganharam o prazo do estado do cliente. */
        estaduaisResolvidas: [...estaduaisResolvidas.values()],
        propostas: propostasPendentes,
        /** Municipais que o cadastro do município resolveu — deixaram de ser pendência. */
        municipaisResolvidas,
        /** Obrigações cujo prazo cadastrado é de OUTRA UF (ou indeterminado). */
        prazoDeOutraUf,
        prazoSemUfDoCliente,
        /** 🏦 A decisão da DeRE para este cliente nesta competência (null antes
         *  da vigência ou fora do regime que a tem). Sai SEMPRE que a entrada
         *  existir — inclusive `nao-se-aplica`/`sem-sinal`, que não acendem
         *  nada mas ficam DITOS. */
        dere: dere.veredicto,
        alertas,
        /** true quando o catálogo NÃO cobre o cliente — a etapa 4 não pode dar
         *  verde nesse caso (trava T1 do escopo). */
        coberturaIncompleta: regime === 'INDEFINIDO' || propostasPendentes.length > 0
            || prazoDeOutraUf.length > 0 || prazoSemUfDoCliente.length > 0,
    };
}

/**
 * 🏦 A DeRE de UM cliente numa competência: promove, tira ou mantém pendente.
 *
 * Só age se a entrada DERE está entre as propostas da competência (ou seja, no
 * regime e dentro da vigência). Devolve:
 *   ativa     — a entrada promovida (cadastro afirma regime obrigado);
 *   pendente  — a entrada com o motivo ESPECÍFICO (só a CANDIDATA por CNAE);
 *   veredicto — a decisão do dono, para a tela dizer o que aconteceu.
 */
function resolverDereDoCliente(empresa, regime, propostas) {
    const entrada = propostas.find((r) => r.obrigacao === 'DERE');
    if (!entrada) return { ativa: null, pendente: null, veredicto: null };
    const v = decidirDereNoCadastro(empresa, { regimeCatalogo: regime });
    if (v.decisao === 'obrigada') {
        return {
            ativa: {
                ...entrada,
                status: 'ativa', dependeDe: null, revisar: false,
                regimeEspecifico: v.regimeEspecifico,
                regimeEspecificoRotulo: v.rotulo,
                baseLegal: `${entrada.baseLegal} · ${v.motivo}`,
            },
            pendente: null,
            veredicto: v,
        };
    }
    if (v.decisao === 'candidata') {
        return {
            ativa: null,
            // A frase do `dependeDe` é o que a Rotina imprime ao lado do nome —
            // genérico ("cadastro") mandaria procurar sem dizer o quê.
            pendente: { ...entrada, dependeDe: v.motivo, acaoDere: v.acao },
            veredicto: v,
        };
    }
    // nao-se-aplica · sem-sinal · dispensada-simples · regime-fora-do-leiaute:
    // fora do mês, DITO em `dere.decisao`. O "fora do leiaute" NÃO é pendência:
    // o leiaute 1.1.0 não tem grupo para o regime, então não há o que entregar
    // — cobrar seria alarme que ninguém consegue apagar (a lição do aluguel).
    return { ativa: null, pendente: null, veredicto: v };
}

/** As esferas que definem prazo. A taxonomia é estável — o que muda é a data. */
export const ESFERAS = ['federal', 'estadual', 'municipal'];

/**
 * Agrupa as obrigações de uma competência por ESFERA — que é como o órgão
 * publica e, portanto, como a conferência mensal se faz (Paulo, 11/08).
 */
export function porEsfera(regime, competencia, opts = {}) {
    const lista = obrigacoesAplicaveis(regime, competencia, opts);
    const out = { federal: [], estadual: [], municipal: [] };
    for (const r of lista) if (out[r.esfera]) out[r.esfera].push(r);
    return out;
}

/**
 * Checklist pro Paulo/Alexandre: tudo que este catálogo ainda não pode afirmar
 * sozinho. Existir é o que impede o "sync manual" de virar mentira de novo.
 */
export function pendenciasDeConfirmacao() {
    const vistos = new Map();
    for (const regime of Object.keys(CATALOGO)) {
        for (const r of CATALOGO[regime]) {
            if (r.status !== 'ativa' || r.revisar) {
                // 🚨 A CHAVE É A REGRA, NÃO SÓ O NOME DA OBRIGAÇÃO.
                //
                // Desde 18/08 a MESMA obrigação tem regras diferentes por regime:
                // o FGTS do Lucro é 'ativa' e conferido, o da imune é 'proposta'
                // (depende de folha). Deduplicar só por `obrigacao` colapsaria as
                // duas numa linha e o checklist diria "FGTS não conferido" — uma
                // afirmação falsa sobre o FGTS de toda a carteira.
                const chave = [r.obrigacao, r.status, r.dependeDe || '', r.frequencia].join('|');
                if (!vistos.has(chave)) {
                    vistos.set(chave, {
                        obrigacao: r.obrigacao,
                        label: r.label,
                        frequencia: r.frequencia,
                        esfera: r.esfera,
                        abrangencia: r.abrangencia,
                        status: r.status,
                        ajusteDiaNaoUtil: r.ajusteDiaNaoUtil,
                        baseLegal: r.baseLegal,
                        dependeDe: r.dependeDe || null,
                        oQueFalta: r.status !== 'ativa'
                            ? `depende de "${r.dependeDe}" — o app não avalia essa condição hoje`
                            : 'conferir prazo/ajuste de dia não útil (a existência da obrigação já é da equipe)',
                        regimes: [],
                    });
                }
                vistos.get(chave).regimes.push(regime);
            }
        }
    }
    return Array.from(vistos.values());
}

/**
 * 🏦 A entrada da DeRE, exportada para o dono do resto da obrigação
 * (`dere.js`: eventos, cronograma, situação por empresa, triagem). O prazo
 * mora AQUI, com as demais obrigações — `dere.js` importa, nunca recalcula.
 */
export const OBRIGACAO_DERE = DERE;
