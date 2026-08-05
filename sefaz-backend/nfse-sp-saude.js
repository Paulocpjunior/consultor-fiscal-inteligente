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
