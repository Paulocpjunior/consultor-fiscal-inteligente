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
// A direção errada custa multa (ou pinta "atrasada" falsa), então NENHUMA
// entrada nasce sem ela e as não conferidas saem em pendenciasDeConfirmacao().
// ONDE OS DOIS DISCORDAVAM, ficou o que a TELA fazia — é o que a equipe vê e
// usa hoje; trocar a data por dedução minha seria inventar prazo. Corrigir é
// uma palavra por linha, depois do aval do Paulo/Alexandre.
// ============================================================================

import { ehDiaUtil } from './feriados-nacionais.js';

/** Regimes que o mês entende. INDEFINIDO é um estado real, não um erro. */
export const REGIMES = ['SIMPLES', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'INDEFINIDO'];

export const REGIME_LABEL = {
    SIMPLES: 'Simples Nacional',
    LUCRO_PRESUMIDO: 'Lucro Presumido',
    LUCRO_REAL: 'Lucro Real',
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
    const colecao = String(empresa?.colecao || '').trim();
    if (colecao === 'simples_empresas') return { regime: 'SIMPLES', motivo: null };

    if (colecao === 'lucro_empresas') {
        const rp = String(empresa?.regimePadrao || '').trim().toLowerCase();
        if (rp === 'presumido') return { regime: 'LUCRO_PRESUMIDO', motivo: null };
        if (rp === 'real') return { regime: 'LUCRO_REAL', motivo: null };
        return {
            regime: 'INDEFINIDO',
            motivo: 'Cliente do Lucro sem "Regime padrão" (Presumido ou Real) na ficha. '
                + 'Sem ele o mês sai incompleto: só as obrigações comuns aos dois regimes são geradas.',
        };
    }
    return {
        regime: 'INDEFINIDO',
        motivo: `Coleção "${colecao || '(vazia)'}" não corresponde a nenhum regime conhecido.`,
    };
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
    ajusteDiaNaoUtil: 'prorroga',
    baseLegal: 'LC 123/2006 art. 21 §3º (prorroga quando não há expediente bancário)',
    status: 'ativa',
};
const FGTS = {
    obrigacao: 'FGTS', label: 'FGTS Digital', nome: 'FGTS Digital',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: M, diaVencimento: 20, mesesApos: 1,
    // 🚩 CONFLITO REAL, PENDENTE DO PAULO/ALEXANDRE: o cron antigo ANTECIPAVA
    // (dia útil anterior) e a tela de Vencimentos PRORROGAVA — a mesma
    // competência tinha 19/06 na tarefa e 22/06 na tela. Aqui fica PRORROGA
    // porque é o que a equipe vê hoje na tela (mudar a data que ela usa, por
    // dedução minha, é o tipo de invenção que este catálogo existe pra impedir).
    // Se a régua do FGTS for antecipar, é UMA palavra — e a pendência já está
    // nomeada em pendenciasDeConfirmacao().
    ajusteDiaNaoUtil: 'prorroga',
    baseLegal: 'Lei 8.036/90 art. 15 (dia 20) — direção do ajuste A CONFERIR',
    status: 'ativa', revisar: true,
};
const DCTFWEB = {
    obrigacao: 'DCTFWEB', label: 'DCTFWeb', nome: 'DCTFWeb',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: M, diaVencimento: 15, mesesApos: 1,
    ajusteDiaNaoUtil: 'prorroga',
    baseLegal: 'IN RFB 2.005/2021 (até o dia 15 do mês seguinte)',
    status: 'ativa',
};
const SPED = {
    obrigacao: 'SPED', label: 'SPED Fiscal', nome: 'EFD ICMS/IPI',
    // ESTADUAL: este prazo é o de SÃO PAULO. Cliente de outra UF tem outro e o
    // catálogo ainda não os tem — a abrangência denuncia isso em vez de fingir.
    esfera: 'estadual', abrangencia: 'UF:SP',
    frequencia: M, diaVencimento: 25, mesesApos: 2,
    ajusteDiaNaoUtil: 'prorroga',
    baseLegal: 'Portaria CAT 147/2009 (SP) — prazo estadual',
    status: 'ativa', revisar: true,
};
const INSS_CPP = {
    obrigacao: 'INSS_CPP', label: 'INSS Patronal', nome: 'INSS Patronal (CPP)',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: M, diaVencimento: 20, mesesApos: 1,
    ajusteDiaNaoUtil: 'prorroga',
    baseLegal: 'Lei 8.212/91 art. 30, I, "b" — direção do ajuste A CONFERIR',
    // Só existe com FOLHA, e a folha mora no módulo de DP — este app não tem
    // como afirmar que o cliente tem empregado. Gerar pra todos criaria uma
    // pendência falsa por mês em quem não tem folha.
    status: 'proposta', dependeDe: 'folha', revisar: true,
};
const PIS_COFINS = {
    obrigacao: 'PIS_COFINS', label: 'PIS/COFINS', nome: 'PIS/COFINS',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: M, diaVencimento: 25, mesesApos: 1,
    ajusteDiaNaoUtil: 'prorroga',
    baseLegal: 'Lei 11.933/2009 (25º dia do mês seguinte) — direção do ajuste A CONFERIR',
    status: 'ativa', revisar: true,
};
const EFD_CONTRIB = {
    obrigacao: 'EFD_CONTRIB', label: 'EFD-Contribuições', nome: 'EFD-Contribuições',
    esfera: 'federal', abrangencia: 'BR',
    frequencia: M, diaVencimento: 14, mesesApos: 2,
    ajusteDiaNaoUtil: 'prorroga',
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
    ajusteDiaNaoUtil: 'prorroga',
    baseLegal: 'LC 116/2003 + legislação do MUNICÍPIO — prazo A CADASTRAR por município',
    status: 'proposta', dependeDe: 'calendário do município', revisar: true,
};

const COMUNS_LUCRO = [DCTFWEB, FGTS, INSS_CPP, PIS_COFINS, EFD_CONTRIB, SPED, ISS];

export const CATALOGO = {
    SIMPLES: [DAS, FGTS, DEFIS],
    LUCRO_PRESUMIDO: [...COMUNS_LUCRO, IRPJ_TRIM, CSLL_TRIM, ECF, ECD],
    LUCRO_REAL: [...COMUNS_LUCRO, IRPJ_TRIM, CSLL_TRIM, ECF, ECD],
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
    const { mes, ano } = partesDaCompetencia(competencia);
    const desloc = mes - 1 + Number(regra.mesesApos || 0);
    const anoAlvo = ano + Math.floor(desloc / 12);
    const mesAlvo = ((desloc % 12) + 12) % 12;

    if (regra.ultimoDiaUtilDoMes) {
        const d = new Date(anoAlvo, mesAlvo + 1, 0);
        while (!ehDiaUtil(d)) d.setDate(d.getDate() - 1);
        return d;
    }

    const d = new Date(anoAlvo, mesAlvo, regra.diaVencimento);
    const passo = regra.ajusteDiaNaoUtil === 'antecipa' ? -1 : 1;
    while (!ehDiaUtil(d)) d.setDate(d.getDate() + passo);
    return d;
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
        if (r.frequencia === M) return true;
        if (r.frequencia === T) return competenciaFechaTrimestre(competencia);
        if (r.frequencia === A) return competenciaFechaAno(competencia);
        return false;
    });
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

    const alertas = [];
    if (regime === 'INDEFINIDO') {
        alertas.push({
            tipo: 'regime-indefinido',
            texto: motivo,
            acao: 'Defina o Regime padrão (Presumido ou Real) na ficha do cliente no card Lucro.',
        });
    }
    if (propostas.length) {
        alertas.push({
            tipo: 'obrigacoes-a-confirmar',
            texto: `${propostas.length} obrigação(ões) do regime dependem de informação que este app não tem: `
                + propostas.map((r) => `${r.label} (depende de ${r.dependeDe})`).join(', ') + '.',
            acao: 'Confirmar caso a caso — enquanto isso elas NÃO viram tarefa automática.',
        });
    }

    return {
        regime,
        regimeLabel: REGIME_LABEL[regime],
        competencia,
        obrigacoes: ativas.map((r) => ({ ...r, vencimento: calcularVencimento(competencia, r) })),
        propostas,
        alertas,
        /** true quando o catálogo NÃO cobre o cliente — a etapa 4 não pode dar
         *  verde nesse caso (trava T1 do escopo). */
        coberturaIncompleta: regime === 'INDEFINIDO' || propostas.length > 0,
    };
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
                const chave = r.obrigacao;
                if (!vistos.has(chave)) {
                    vistos.set(chave, {
                        obrigacao: r.obrigacao,
                        label: r.label,
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
