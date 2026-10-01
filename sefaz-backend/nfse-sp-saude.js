// ============================================================================
// sefaz-backend/nfse-sp-saude.js  (PURO — testável)
// ----------------------------------------------------------------------------
// Saúde do trilho de captura da NFS-e SP (portal CSV), pra ser mostrada ONDE A
// PESSOA TRABALHA — não só no painel de Diagnóstico.
//
// Paulo, 05/08: *"a questão do erro de ws não pode acontecer ou você não pode
// deixar de avisar! Isso é muito grave! Imagina o cliente esperando a guia p
// pagamento e o colaborador não consegue capturar as nfs e só descobre
// tentando!"*.
//
// A regra que faltava não é sobre o cron — é sobre a LEITURA DO ZERO: quando o
// trilho está quebrado, "nenhuma nota na competência" e "não conseguimos
// buscar" ficam idênticos na tela. O primeiro encerra o assunto; o segundo é
// uma guia que não vai sair. Por isso `zeroConfiavel`: só se pode concluir
// "não houve nota" quando a captura rodou e teve sucesso.
// ============================================================================

const HORA_MS = 3600 * 1000;

/** Acima disto sem rodar, o trilho está parado (o cron é diário). */
export const MAX_IDLE_HORAS = 48;

const ms = (v) => {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v?.toMillis === 'function') return v.toMillis();
    if (typeof v?._seconds === 'number') return v._seconds * 1000;
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? t : 0;
};

/**
 * @param {Array} logs   docs de nfsesp_portal_cron_logs (mais recente primeiro)
 * @param {number} agora timestamp de referência (injetado pra ser testável)
 */
export function saudeNfseSp(logs, agora = Date.now()) {
    const lista = (logs || []).map((l) => ({ ...l, _ts: ms(l.executadoEm || l.iniciadoEm) }))
        .sort((a, b) => b._ts - a._ts);

    if (lista.length === 0) {
        return {
            farol: 'quebrado',
            motivo: 'A captura de NFS-e SP nunca rodou.',
            acao: 'Rode "Forçar captura agora" na aba Captura e confira o resultado antes de fechar o mês.',
            zeroConfiavel: false,
            ultimaExecucaoMs: 0,
            ultimoSucessoMs: 0,
            horasSemRodar: null,
        };
    }

    const ultima = lista[0];
    const ultimoSucesso = lista.find((l) => l.status === 'sucesso' && Number(l.sucessos || 0) > 0);
    const horasSemRodar = Math.floor((agora - ultima._ts) / HORA_MS);

    const base = {
        ultimaExecucaoMs: ultima._ts,
        ultimoSucessoMs: ultimoSucesso?._ts || 0,
        horasSemRodar,
        erroDominante: (ultima.erroFatal || ultima.errosResumo?.[0]?.erroPrestador
            || ultima.errosResumo?.[0]?.motivo || '').slice(0, 200) || null,
    };

    // Parado além da janela: o cron é diário, então 48h sem rodar não é
    // "ainda vai rodar" — é trilho parado, e ninguém foi avisado.
    if (horasSemRodar >= MAX_IDLE_HORAS) {
        return {
            ...base,
            farol: 'quebrado',
            motivo: `A captura de NFS-e SP não roda há ${horasSemRodar}h (limite ${MAX_IDLE_HORAS}h).`,
            acao: 'Rode "Forçar captura agora" e, se falhar, avise o Paulo antes de prometer guia ao cliente.',
            zeroConfiavel: false,
        };
    }

    if (ultima.status === 'falha' || ultima.erroFatal) {
        return {
            ...base,
            farol: 'quebrado',
            motivo: `A última captura de NFS-e SP FALHOU${base.erroDominante ? `: ${base.erroDominante}` : '.'}`,
            acao: 'Não conclua que o cliente não emitiu nota — rode de novo e confira antes de apurar o ISS.',
            zeroConfiavel: false,
        };
    }

    // Rodou, mas nenhuma empresa capturada: all-failed NUNCA é verde (regra do
    // farol honesto). É o caso que fez a NFS-e SP passar semanas "verde" com
    // 0 sucessos e 121 falhas.
    const processadas = Number(ultima.processadas || ultima.totalEmpresas || 0);
    const sucessos = Number(ultima.sucessos || 0);
    const falhas = Number(ultima.falhas || 0);
    if (processadas > 0 && sucessos === 0) {
        return {
            ...base,
            farol: 'quebrado',
            motivo: `A última captura terminou com 0 sucesso(s) e ${falhas} falha(s) em ${processadas} empresa(s).`,
            acao: 'O trilho está quebrado (login do portal, CCM ou autorização). Resolva antes de apurar ISS do mês.',
            zeroConfiavel: false,
        };
    }

    if (ultima.status === 'iniciado') {
        return {
            ...base,
            farol: 'atencao',
            motivo: 'Uma captura de NFS-e SP está em andamento.',
            acao: 'Espere terminar (leva de 15 a 25 min) antes de concluir que falta nota.',
            zeroConfiavel: false,
        };
    }
    if (ultima.status === 'interrompido') {
        return {
            ...base,
            farol: 'atencao',
            motivo: 'A última captura foi INTERROMPIDA no meio (deploy ou reinício).',
            acao: 'Rode "Forçar captura agora" — parte das empresas pode não ter sido varrida.',
            zeroConfiavel: false,
        };
    }

    if (falhas > 0) {
        return {
            ...base,
            farol: 'atencao',
            motivo: `Última captura OK, mas ${falhas} empresa(s) falharam de ${processadas}.`,
            acao: 'Confira se o SEU cliente está entre as que falharam antes de apurar o ISS.',
            // Houve sucesso geral, mas a empresa específica pode estar entre as
            // que falharam — quem decide é a tela, com o CNPJ na mão.
            zeroConfiavel: false,
        };
    }

    return {
        ...base,
        farol: 'ok',
        motivo: `Última captura OK — ${sucessos} empresa(s), há ${horasSemRodar}h.`,
        acao: null,
        zeroConfiavel: true,
    };
}

/**
 * A empresa apareceu com erro na última varredura?
 *
 * O resumo de erros do cron guarda até 10 casos com CNPJ/CCM — é o que
 * transforma "algumas falharam" em "a SUA falhou", que é a única versão
 * acionável pra quem está fechando o mês daquele cliente.
 */
export function empresaComFalhaNaCaptura(logs, cnpj) {
    const alvo = String(cnpj || '').replace(/\D/g, '');
    if (!alvo) return null;
    const ultima = (logs || [])[0];
    for (const e of ultima?.errosResumo || []) {
        if (String(e.cnpj || '').replace(/\D/g, '') === alvo) {
            return { erro: e.erroPrestador || e.erroTomador || e.motivo || 'falha não detalhada', ccm: e.ccm || null };
        }
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 O ZERO É CONFIÁVEL PARA ESTA EMPRESA? (dono único, 01/10)
//
// Paulo, 01/10, na ALMEIDA e na BRISKA: *"agora diz que está incerto as notas
// da prefeitura de SP, porém consultei na prefeitura e no consultor e consta
// as notas de serviços tomados da BRISKA"*.
//
// A régua antiga era `saude.zeroConfiavel && !empresaComFalhaNaCaptura(...)`
// — e `saudeNfseSp` devolve `zeroConfiavel:false` para TODO MUNDO quando UMA
// empresa falha na rodada. Numa carteira de ~200 sempre há uma: o zero da
// empresa que o portal respondeu sem erro virava "captura incerta", e o fim do
// mês travava sem nada que o colaborador pudesse corrigir.
//
// O que prova a captura DESTA empresa, nesta ordem:
//  1. ela está no resumo de erros da última rodada ⇒ NÃO confiável, com o erro;
//  2. o registro POR MÊS da empresa (`nfsesp_portal_state.porPeriodo[AAAA-MM]`,
//     gravado a partir de 01/10): mês inteiro baixado, sem erro ⇒ confiável;
//     com erro ⇒ não, com o erro;
//  3. rodada geral sem falha nenhuma (a régua antiga) ⇒ confiável;
//  4. a última rodada CONCLUÍDA cobriu o mês inteiro, VISITOU a empresa
//     (`ultimaSync` depois do início dela, sem erro gravado) e a lista de erros
//     dela está COMPLETA (o cron guarda só 10) sem esta empresa ⇒ confiável.
//
// ⚠️ Farol honesto: lista de erros cortada, rodada que não cobriu o mês, ou
// empresa que a rodada não visitou (CCM que não casa, lock) continuam "não
// sei" — e a frase diz QUAL dos casos, porque a parada é outra em cada um.
// ─────────────────────────────────────────────────────────────────────────────

/** O cron guarda no máximo 10 erros por rodada (`log.errosResumo`). */
export const LIMITE_ERROS_RESUMO = 10;

const ultimoDiaDoMes = (anoMes) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(anoMes || ''));
    if (!m) return null;
    const ano = Number(m[1]);
    const mes = Number(m[2]);
    const dia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return `${String(dia).padStart(2, '0')}/${m[2]}/${m[1]}`;
};

/**
 * O período baixado cobre o mês INTEIRO? Download feito no meio do mês não
 * prova nada sobre os dias que ainda não tinham acontecido.
 * @param {{anoMes?: string, dataInicio?: string, dataFim?: string}} periodo
 */
export function periodoCobreMesInteiro(periodo) {
    const fim = ultimoDiaDoMes(periodo?.anoMes);
    if (!fim) return false;
    const ini = `01/${String(periodo.anoMes).slice(5, 7)}/${String(periodo.anoMes).slice(0, 4)}`;
    return String(periodo?.dataInicio || '') === ini && String(periodo?.dataFim || '') === fim;
}

/**
 * @param {object} p
 * @param {object|null} p.saude      saída de `saudeNfseSp`
 * @param {Array} p.logs             docs de nfsesp_portal_cron_logs (mais recente primeiro)
 * @param {object|null} p.state      doc `nfsesp_portal_state/{cnpj}`
 * @param {string} p.cnpj
 * @param {string} p.competencia     'AAAA-MM'
 * @returns {{confiavel: boolean, via: string, motivo: string|null}}
 */
export function zeroConfiavelDaEmpresa({ saude = null, logs = [], state = null, cnpj, competencia } = {}) {
    const falha = empresaComFalhaNaCaptura(logs, cnpj);
    if (falha) {
        return {
            confiavel: false, via: 'falhou-na-rodada',
            motivo: `A captura DESTA empresa falhou na última rodada do portal de SP: ${falha.erro}. `
                + 'Rode a captura de novo antes de dizer que não há guia.',
        };
    }

    const per = state?.porPeriodo?.[competencia];
    if (per) {
        const erro = per.erroPrestadas || per.erroTomadas;
        if (erro) {
            return {
                confiavel: false, via: 'periodo-com-erro',
                motivo: `O download de ${competencia} desta empresa no portal de SP falhou: ${erro}. Rode a captura de novo.`,
            };
        }
        if (per.mesInteiro === true) {
            return { confiavel: true, via: 'periodo-da-empresa', motivo: null };
        }
    }

    if (saude?.zeroConfiavel) return { confiavel: true, via: 'rodada-geral', motivo: null };

    const lista = (logs || []).map((l) => ({ ...l, _ts: ms(l.iniciadoEm || l.executadoEm) }))
        .sort((a, b) => b._ts - a._ts);
    const rodada = lista.find((l) => l.status === 'sucesso' && !l.erroFatal && Number(l.sucessos || 0) > 0);
    const naoSei = (motivo) => ({ confiavel: false, via: 'sem-prova', motivo });
    if (!rodada) {
        return naoSei(saude?.motivo
            ? `${saude.motivo} Rode a captura antes de dizer que não há guia.`
            : 'Nenhuma rodada da captura de NFS-e SP concluiu com sucesso — rode a captura antes de dizer que não há guia.');
    }
    const cobriu = (rodada.periodos || []).some((p) => p?.anoMes === competencia && periodoCobreMesInteiro(p));
    if (!cobriu) {
        return naoSei(`A última rodada concluída do portal de SP não baixou ${competencia} inteiro — `
            + 'rode a captura deste mês antes de dizer que não há guia.');
    }
    const erros = rodada.errosResumo || [];
    const alvo = String(cnpj || '').replace(/\D/g, '');
    const nela = erros.find((e) => String(e?.cnpj || '').replace(/\D/g, '') === alvo);
    if (nela) {
        return {
            confiavel: false, via: 'falhou-na-rodada',
            motivo: `A captura DESTA empresa falhou na rodada do portal de SP: ${nela.erroPrestador || nela.erroTomador || nela.motivo || 'falha não detalhada'}. Rode a captura de novo.`,
        };
    }
    if (erros.length >= LIMITE_ERROS_RESUMO) {
        return naoSei(`A rodada do portal de SP teve ${Number(rodada.falhas || erros.length)} falha(s) e só as ${LIMITE_ERROS_RESUMO} primeiras ficam gravadas — `
            + 'não dá para afirmar que esta empresa não está entre elas. Rode a captura de novo.');
    }
    const visitadaEm = ms(state?.ultimaSync);
    if (!visitadaEm || visitadaEm < rodada._ts) {
        return naoSei('A última rodada do portal de SP não chegou a esta empresa (CCM que não casa com o portal, '
            + 'autorização do escritório pendente ou lock ativo). Confira o CCM em Dados Fiscais e rode a captura.');
    }
    if (state?.erroPrestadas || state?.erroTomadas) {
        return {
            confiavel: false, via: 'falhou-na-rodada',
            motivo: `O último download desta empresa no portal de SP falhou: ${state.erroPrestadas || state.erroTomadas}. Rode a captura de novo.`,
        };
    }
    return { confiavel: true, via: 'rodada-cobriu-a-empresa', motivo: null };
}

/**
 * A pergunta "o zero deste CNPJ é confiável?" já com a competência e o estado
 * de cada empresa na mão — é o que as DUAS telas (Rotina e aba 🏛️ ISS SP)
 * passam a `montarPainelIssCarteira`. Uma montagem só: tela com régua própria
 * diverge sozinha.
 *
 * @param {object} p
 * @param {object|null} p.saude
 * @param {Array} p.logs
 * @param {Map<string, object>} [p.estados] `nfsesp_portal_state` por CNPJ (só dígitos)
 * @param {string} p.competencia
 */
export function zeroConfiavelParaCompetencia({ saude = null, logs = [], estados = new Map(), competencia } = {}) {
    return (cnpj) => zeroConfiavelDaEmpresa({
        saude, logs, competencia, cnpj,
        state: estados?.get?.(String(cnpj || '').replace(/\D/g, '')) || null,
    });
}
