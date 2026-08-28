// ============================================================================
// sefaz-backend/fim-de-mes.js  (PURO — sem io, testável)
// ----------------------------------------------------------------------------
// 🔒 DAR FIM DE MÊS — o ato que vira a RÉGUA de todo mundo.
//
// Paulo, 26/08: *"o fechamento do fim do mês no CFI exige (DAR FIM DE MÊS);
// essa função é que deve ser usada como régua para nos nortear, usar como base
// p impostos, livros, ficha financeira, exatamente o que o CCI deve usar como
// base para importação do contábil"*.
//
// ═══ POR QUE ELE PRECISA EXISTIR ════════════════════════════════════════════
//
// Hoje o app **DEDUZ** que o mês fechou: a Rotina do Mês olha documentos,
// ficha, tarefas e envios e conclui. Isso é honesto para GUIAR — e não serve
// para NORTEAR, porque dedução muda quando a fonte muda:
//
//   · o livro de entradas de agosto reimpresso em dezembro sai DIFERENTE, se
//     uma nota de agosto chegou em novembro;
//   · a ficha de uma competência já entregue pode ser editada e o número muda
//     **em silêncio** — não há `fechadoEm`, `fechadoPor` nem versão no
//     `FichaFinanceiraRegistro`;
//   · e o Contábil, no CCI, importa um valor que pode mudar depois dele ter
//     importado. É essa divergência que este módulo mata.
//
// A composição, que é o coração do desenho:
//
//   as 5 ETAPAS da Rotina  →  respondem *"você PODE dar fim de mês?"*
//   DAR FIM DE MÊS          →  responde  *"o mês FOI fechado — quando, por
//                                          quem, com qual acervo, com quais
//                                          valores"*
//
// ⚠️ **E ISSO MUDA O SIGNIFICADO DO FAROL `ok` DA ROTINA**: ele deixa de
// querer dizer "mês fechado" e passa a querer dizer "pronto para fechar".
// Pela régua de 23/08 (o `capturaNfeOk`), os LEITORES desse booleano entram no
// MESMO PR — senão uma tela diz fechado e a outra diz aberto, que é o defeito
// que esta casa mais paga.
//
// ═══ O QUE O CARIMBO CONGELA — TRÊS COISAS, DE UMA VEZ ══════════════════════
//
// Elas têm de concordar por CONSTRUÇÃO, não por coincidência:
//
//   ACERVO   — o instante do corte + `ultNSU`/`maxNSU` do `sefaz_state`.
//              É a prova de QUAIS documentos viraram aquele número. Sem ela o
//              valor fechado não se confere depois (a lição do IVA-ST sem
//              Portaria: índice órfão não se reconstrói).
//   VALORES  — os APURADOS da ficha, nunca os insumos. Quem recalcula do outro
//              lado produz um segundo número para o mesmo fato, que é o pior
//              defeito de um arquivo fiscal (a régua já provada no R-2055).
//   LASTRO   — quantos documentos existiam por trás. Sem ele o CCI recebe
//              número fechado com ZERO documento atrás — o caso EXPERTE
//              (15/08: R$ 7.352,90 de IPI apurado, banco vazio).
//
// ═══ AS TRÊS DECISÕES DO PAULO (26/08) ══════════════════════════════════════
//
//   1. **Fecha o COLABORADOR; reabre SÓ ADMIN.** Fechar é o trabalho do mês;
//      reabrir mexe em número que o Contábil já pode ter importado.
//   2. **BLOQUEIA.** Etapa em âmbar NÃO fecha o mês — não há justificativa que
//      passe por cima. ⚠️ Consequência dita e aceita: cliente com captura em
//      âmbar por infraestrutura (as 202 do A3, a EXPERTE) não fecha, e portanto
//      não chega ao CCI. O bloqueio NOMEIA a etapa e diz ONDE se resolve —
//      trava sem caminho é trava que a equipe contorna (13/08).
//   3. **UMA EMPRESA POR VEZ.** Fim de mês em série é a família do *"ninguém
//      emite em série"* (28/07): o erro sai multiplicado por 200 antes de
//      alguém ver.
// ============================================================================

import { etapaFechada } from './rotina-fiscal.js';
import { normalizarCompetencia } from './competencia.js';

/** Motivo de reabertura: texto livre, mas com corpo. Mesmo piso da trava T3 da
 *  DCTFWeb — "ajuste" não explica nada a quem ler daqui a três meses. */
export const MOTIVO_REABERTURA_MINIMO = 15;

/**
 * OS CAMPOS APURADOS DA FICHA — e SÓ eles.
 *
 * 🚨 O carimbo grava RESULTADO, nunca insumo. Se ele levasse faturamento,
 * despesa e folha, o outro lado seria convidado a recalcular — e dois números
 * para o mesmo fato é exatamente o que este módulo existe para impedir.
 *
 * ⚠️ E campo ausente vira **null, nunca zero**. Zero num campo de saldo é uma
 * AFIRMAÇÃO ("você não tem crédito a transportar") — está escrito no próprio
 * `types.ts`, ao lado do `saldoCredorIcmsTransportar`, e vale dobrado aqui,
 * porque este número atravessa para a contabilidade.
 */
export const CAMPOS_APURADOS = Object.freeze([
    'totalImpostos',
    'cargaTributaria',
    'ipiRecolher',
    'icmsProprioRecolher',
    'icmsStRecolher',
    'saldoCredorIcmsTransportar',
    'saldoCredorIpiTransportar',
    'saldoCredorIcms',
    'saldoCredorIpi',
    'saldoCredorPis',
    'saldoCredorCofins',
]);

const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/** Extrai da ficha os valores apurados, preservando a AUSÊNCIA como null. */
export function valoresApuradosDaFicha(ficha) {
    const out = {};
    for (const c of CAMPOS_APURADOS) out[c] = num(ficha?.[c]);
    return out;
}

/**
 * 🚨 O BLOQUEIO DE UMA ETAPA — DONO ÚNICO (28/08, VINCENZO GUERRA).
 *
 * ═══ POR QUE ELE PRECISOU NASCER ════════════════════════════════════════════
 *
 * Esta projeção existia DUAS vezes: aqui e em `bloqueiosDasEtapas`, na Rotina
 * do Mês. A da tela era montada À MÃO, com sete campos — e **esqueceu
 * `podeDeclararEnvio`**, que tinha nascido no dia anterior justamente para
 * fazer a porta do envio declarado sumir onde ela não resolve.
 *
 * O efeito, no print do Paulo: na VINCENZO o app ENVIOU a guia (e o cliente
 * PAGOU), o campo dizia `false`… e a Rotina oferecia *"📋 Já enviei esta guia
 * por fora"* assim mesmo, porque `undefined !== false`. Ele registrou, e o mês
 * continuou travado — *"mesmo fazendo esse registro ele não assume"*. A porta
 * existia convidando a declarar o que o app já tinha feito.
 *
 * ⚠️ E a MESMA lacuna, na direção contrária, apagava a porta NOVA: a etapa 4
 * manda `podeDeclararCobertura: true` e a tela pergunta `=== true`, então a
 * saída da MANTOAN ficava INVISÍVEL justamente na tela onde a trava aparece.
 *
 * 📌 É a lição de 27/08 (`rotina-empresa-insumo.js`) na outra ponta: lá era o
 * INSUMO montado à mão, aqui é a SAÍDA. **Objeto montado à mão para atravessar
 * uma fronteira é uma segunda cópia com outra roupa, e ela envelhece em
 * SILÊNCIO no primeiro campo novo** — e nada quebra: as duas telas só passam a
 * contar histórias diferentes sobre a mesma empresa.
 */
export function bloqueioDaEtapa(e) {
    return {
        id: e.id, ordem: e.ordem, nome: e.nome, status: e.status,
        resumo: e.resumo || null, acao: e.acao || null, onde: e.onde || null,
        // 📋 A porta do envio DECLARADO só aparece onde ela resolve — quem
        // decide é a etapa, não a tela (ver `podeDeclararEnvio` na Rotina).
        podeDeclararEnvio: typeof e.podeDeclararEnvio === 'boolean' ? e.podeDeclararEnvio : null,
        // 📋 E a porta da COBERTURA declarada, pela MESMA régua: ela só existe
        // quando o que trava é obrigação que o catálogo admite não cobrir. Nas
        // outras causas (regime indefinido, prazo de outra UF, UF ausente) há
        // conserto, e declarar por cima apagaria o caminho.
        podeDeclararCobertura: typeof e.podeDeclararCobertura === 'boolean' ? e.podeDeclararCobertura : null,
        // As obrigações NOMEADAS: é essa lista que a declaração precisa
        // mencionar, e é ela que a leitura compara depois.
        propostas: Array.isArray(e.propostas) ? e.propostas : null,
        // ⚠️ AS CAUSAS DO RITO, NOMEADAS pelo dono (`pendenciaSharePoint` /
        // `pendenciaBaixa`). Sem elas a tela só sabe DIZER o que falta e não
        // sabe para ONDE mandar — e foi assim que a única porta oferecida na
        // VINCENZO virou a que não resolvia nenhuma das duas causas.
        causas: Array.isArray(e.causas) ? e.causas : null,
    };
}

/**
 * PRÉ-CONDIÇÃO: esta competência pode ser fechada?
 *
 * Lê as ETAPAS que a Rotina produziu — **nunca reimplementa a régua delas**.
 * Quem decide se uma etapa está fechada é `etapaFechada`, no dono; uma segunda
 * cópia do `Set` divergiria no dia em que nascer um status novo, em silêncio.
 */
export function podeDarFimDeMes(rotina) {
    const etapas = Array.isArray(rotina?.etapas) ? rotina.etapas : [];
    if (!etapas.length) {
        return {
            pode: false,
            bloqueios: [],
            motivo: 'A rotina desta competência não pôde ser lida — sem ela não dá '
                + 'para saber o que está aberto, e fechar no escuro é fechar sem base.',
        };
    }
    const bloqueios = etapas.filter((e) => !etapaFechada(e)).map(bloqueioDaEtapa);
    if (bloqueios.length) {
        return {
            pode: false,
            bloqueios,
            motivo: `${bloqueios.length} etapa(s) da rotina ainda não fecharam — `
                + 'resolva-as antes de dar fim de mês.',
        };
    }
    return { pode: true, bloqueios: [], motivo: null };
}

/**
 * O ACERVO que virou este fechamento.
 *
 * O corte é o INSTANTE, e o NSU é a PROVA. Não trocar um pelo outro: o NSU só
 * existe no trilho DistDFe (NF-e da SEFAZ) — cofre de e-mail, portal de SP,
 * ADN e importação manual não têm NSU nenhum, então um corte ANCORADO nele
 * deixaria metade da captura fora da trava.
 *
 * ⚠️ E `ultNSU`/`maxNSU` ausentes NÃO viram zero: NSU 0 quer dizer "cursor no
 * começo", que é uma afirmação sobre a captura. Ausência é ausência.
 */
export function montarCorte({ agoraIso, state, documentos }) {
    return {
        instante: agoraIso,
        ultNSU: num(state?.ultNSU),
        maxNSU: num(state?.maxNSU),
        documentos: {
            entradas: num(documentos?.entradas) ?? 0,
            saidas: num(documentos?.saidas) ?? 0,
            total: num(documentos?.total) ?? 0,
        },
    };
}

/**
 * O CARIMBO.
 *
 * Devolve `{ ok:false, ... }` quando a pré-condição não passa — nunca lança:
 * quem chama é uma rota, e a recusa precisa chegar à tela com os bloqueios
 * NOMEADOS, não como 500.
 */
export function montarFimDeMes({
    empresaId, competencia, regime = null,
    rotina, ficha, corte, lastro = null,
    // 🚨 A APURAÇÃO VEM DO DONO (`acharApuracaoDaCompetencia`), não da ficha.
    // Ver o bloco da recusa logo abaixo: a ficha é do LUCRO, e o Simples —
    // que é a maior parte da carteira — não tem nenhuma.
    apuracao = null,
    quem, agoraIso, anterior = null,
}) {
    const comp = normalizarCompetencia(competencia);
    if (!comp) {
        return {
            ok: false, bloqueios: [],
            motivo: 'Competência ilegível — fechar o mês errado é entregar o número '
                + 'certo na competência errada.',
        };
    }
    if (!empresaId) {
        return { ok: false, bloqueios: [], motivo: 'Empresa não identificada.' };
    }
    if (anterior && anterior.estado === 'fechada') {
        return {
            ok: false, bloqueios: [],
            motivo: `Esta competência já foi fechada em ${anterior.fechadoEm || '—'}`
                + `${anterior.fechadoPor?.email ? ` por ${anterior.fechadoPor.email}` : ''}. `
                + 'Para mudar o número, um admin precisa reabrir com o motivo escrito.',
        };
    }

    const pre = podeDarFimDeMes(rotina);
    if (!pre.pode) return { ok: false, bloqueios: pre.bloqueios, motivo: pre.motivo };

    // ═══════════════════════════════════════════════════════════════════════
    // 🚨 ISTO BLOQUEAVA TODO O SIMPLES — e o comentário antigo dizia por quê,
    // com a premissa errada: *"a etapa 3 da rotina já teria barrado, então isto
    // é cinto e suspensório"*.
    //
    // Falso. A etapa 3 fecha pelo DONO (`acharApuracaoDaCompetencia`), que
    // conhece TRÊS fontes: a `fichaFinanceira[]` do Lucro, o `faturamentoManual`
    // e o `faturamentoMensalDetalhado` do Simples. Só a PRIMEIRA é "ficha".
    //
    // Resultado, no print do Paulo (REGINA CELIA PIRES · 07/2026, Simples): a
    // Rotina dizia **"✓ Pronto para dar fim de mês"** com as cinco etapas
    // verdes, e o botão recusava com *"sem apuração registrada"*. **Duas
    // leituras do mesmo fato na mesma tela**, pela terceira vez esta semana —
    // e desta o alcance é a maior parte da carteira, porque o Simples nunca
    // teve fim de mês.
    //
    // A pré-condição é a ROTINA. Quem chegou aqui já passou pela etapa 3.
    // ═══════════════════════════════════════════════════════════════════════
    if (!ficha && !apuracao) {
        return {
            ok: false, bloqueios: [],
            motivo: 'Sem apuração registrada nesta competência não há valor a fechar.',
        };
    }

    return {
        ok: true,
        fechamento: {
            empresaId,
            competencia: comp,
            regime: regime || null,
            estado: 'fechada',
            // Versão 1 no primeiro fechamento; reabrir + fechar de novo soma.
            // O CCI compara a versão que importou — sem ela, o Contábil fica
            // com o número velho sem saber que ele mudou.
            versao: Number(anterior?.versao || 0) + 1,
            fechadoEm: agoraIso,
            fechadoPor: quem ? { uid: quem.uid || null, email: quem.email || null, nome: quem.nome || null } : null,
            corte: corte || null,
            apurado: valoresApuradosDaFicha(ficha),
            // 🔒 DE ONDE VEIO O APURADO — sem isto o CCI não sabe interpretar o
            // que recebeu, e um `apurado` todo null do Simples se leria como
            // "este cliente não teve movimento", que é uma afirmação que
            // ninguém fez.
            apuradoFonte: ficha ? 'ficha-lucro' : (apuracao?.fonte || null),
            // ⚠️ E a RESSALVA do Simples: o valor do DAS **não vive na ficha**
            // — ele é calculado e emitido no card do Simples e registrado em
            // `das_emitidos`. Carimbar zero aqui seria afirmar que não há
            // imposto; carimbar a RECEITA seria levar INSUMO, e insumo convida
            // o outro lado a RECALCULAR (a régua do R-2055).
            apuradoRessalva: (!ficha && apuracao)
                ? 'Cliente do Simples Nacional: a apuração desta competência é o faturamento lançado, '
                  + 'e o valor do DAS não vive na ficha financeira — ele é emitido no card do Simples. '
                  + 'Este carimbo congela o ACERVO e o LASTRO do mês; o valor do DAS se confere lá.'
                : null,
            fichaId: ficha?.id || null,
            lastro: lastro || null,
            // O RETRATO das etapas no instante do fechamento. Sem ele, meses
            // depois ninguém sabe em que estado o mês foi dado por fechado.
            etapas: (rotina.etapas || []).map((e) => ({
                id: e.id, nome: e.nome, status: e.status, resumo: e.resumo || null,
            })),
            reaberturas: Array.isArray(anterior?.reaberturas) ? anterior.reaberturas : [],
        },
    };
}

/**
 * REABRIR — ato próprio, só admin, com motivo escrito.
 *
 * Não é "desfazer": é RETIFICAÇÃO. O que já foi importado pelo Contábil passa
 * a estar desatualizado, e é por isso que a versão sobe e o histórico fica.
 */
export function conferirReabertura({ fechamento, motivo, ehAdmin }) {
    if (!fechamento || fechamento.estado !== 'fechada') {
        return { pode: false, erro: 'Esta competência não está fechada — não há o que reabrir.' };
    }
    if (!ehAdmin) {
        return {
            pode: false,
            erro: 'Só um administrador reabre competência fechada. O número já pode ter '
                + 'sido importado pela contabilidade — peça a reabertura ao gestor.',
        };
    }
    const txt = String(motivo || '').trim();
    if (txt.length < MOTIVO_REABERTURA_MINIMO) {
        return {
            pode: false,
            erro: `Escreva o motivo da reabertura (mínimo ${MOTIVO_REABERTURA_MINIMO} caracteres). `
                + 'Daqui a três meses ninguém vai lembrar por que este mês mudou de valor.',
        };
    }
    return { pode: true, erro: null };
}

/** Aplica a reabertura, PRESERVANDO o que foi fechado — nada se apaga. */
export function aplicarReabertura({ fechamento, motivo, quem, agoraIso }) {
    return {
        ...fechamento,
        estado: 'reaberta',
        reabertoEm: agoraIso,
        reabertoPor: quem ? { uid: quem.uid || null, email: quem.email || null, nome: quem.nome || null } : null,
        reaberturas: [
            ...(Array.isArray(fechamento.reaberturas) ? fechamento.reaberturas : []),
            {
                em: agoraIso,
                por: quem?.email || null,
                motivo: String(motivo || '').trim(),
                versaoReaberta: Number(fechamento.versao || 0),
                // O valor que estava carimbado quando alguém reabriu. É a única
                // forma de responder depois "o Contábil importou QUAL número?".
                apuradoNaVersao: fechamento.apurado || null,
            },
        ],
    };
}

/**
 * A COMPETÊNCIA ESTÁ FECHADA? — a pergunta que os leitores fazem.
 *
 * `reaberta` é FALSE de propósito: reaberta é competência ABERTA de novo, e
 * tratá-la como fechada travaria justamente a edição que a reabertura veio
 * permitir.
 */
export function competenciaFechada(fechamento) {
    return fechamento?.estado === 'fechada';
}

/**
 * A frase que a tela mostra. Ela nasce aqui, junto do estado, porque duas
 * telas escrevendo a própria frase é o começo de duas leituras do mesmo fato.
 */
export function descreverFechamento(fechamento) {
    if (!fechamento) return { estado: 'aberta', texto: 'Competência aberta.' };
    if (fechamento.estado === 'reaberta') {
        const ultima = (fechamento.reaberturas || []).slice(-1)[0] || null;
        return {
            estado: 'reaberta',
            texto: `Reaberta${ultima?.por ? ` por ${ultima.por}` : ''}`
                + `${ultima?.motivo ? ` — ${ultima.motivo}` : ''}. `
                + 'Feche de novo para que a contabilidade receba o número corrigido.',
        };
    }
    if (fechamento.estado === 'fechada') {
        const p = fechamento.fechadoPor?.email || fechamento.fechadoPor?.nome || null;
        return {
            estado: 'fechada',
            texto: `Mês fechado${p ? ` por ${p}` : ''}`
                + `${fechamento.versao > 1 ? ` · versão ${fechamento.versao}` : ''}.`,
        };
    }
    return { estado: 'aberta', texto: 'Competência aberta.' };
}
