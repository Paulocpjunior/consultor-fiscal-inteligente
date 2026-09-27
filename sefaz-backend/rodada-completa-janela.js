// ============================================================================
// sefaz-backend/rodada-completa-janela.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚦 A JANELA DA RODADA COMPLETA DE CAPTURA NF-e (DistDFe).
//
// ═══ O CASO (25/09, "erro insistente hoje") ═════════════════════════════════
//
// Erros & Logs do dia: 06:00 rodada agendada interrompida pelo deploy 1032 →
// 06:32 retomada automática refaz a carteira INTEIRA → 109 falhas. 13:45
// rodada interrompida pelo deploy 1037 → 13:49 retomada, 119 ok → 14:19,
// 42 s depois do fim, OUTRA rodada completa → 147 de 147 falhas, 0 docs,
// 4,6 s por empresa. Nenhuma nota se perdeu; foi o app colidindo consigo.
//
// A regra física: cada CNPJ tem trava de 1 hora (`sefaz_locks`, `LOCK_TTL_MS`)
// e a SEFAZ devolve cStat 656 para consulta repetida na mesma janela. Duas
// rodadas completas dentro de 1 hora NUNCA trazem nota — só falha contada.
//
// ═══ AS TRÊS TRAVAS ═════════════════════════════════════════════════════════
//
// 1. RODADA COMPLETA DENTRO DA JANELA É RECUSADA ANTES DE COMEÇAR — com a hora
//    da última e quanto falta (`janelaDaRodadaCompleta`). Vale para o botão
//    "Forçar captura agora" e para a retomada.
// 2. A RETOMADA SÓ REFAZ RODADA AGENDADA (`fonteRetomavel`): rodada manual
//    interrompida não é refeita sozinha. E a empresa que a rodada interrompida
//    já alcançou ainda está na trava de 1 h: ela é PULADA como "janela", não
//    contada como falha (`classificarResultado`).
// 3. TODA rodada grava os motivos (o laço é um só) e o resumo DIZ a causa
//    dominante (`resumoDaRodada`) — "147 falhas" mudo era o que mandava a
//    equipe clicar de novo.
// ============================================================================

/** A mesma janela de `LOCK_TTL_MS` do sync-orchestrator — 1 hora por CNPJ. */
export const JANELA_RODADA_COMPLETA_MS = 60 * 60 * 1000;

/**
 * Fontes de rodada COMPLETA (carteira inteira) na coleção sefaz_cron_logs.
 * O que NÃO é rodada completa: drenagem (≤10 alvos), dirigida (lista), os
 * docs de `tipo` auto-preencher-*, e o marcador de captura por chave.
 */
export function ehRodadaCompleta(log) {
    if (!log || log.tipo) return false;
    const fonte = String(log.fonte || '');
    if (!fonte) return Number(log.totalEmpresas || 0) >= 30; // log antigo, sem fonte
    if (/drenagem|dirigida|targeted/i.test(fonte)) return false;
    return true;
}

/** Rodada manual: disparada por gente (botão), não pelo Scheduler. */
export function ehFonteManual(fonte) {
    return /^admin-/i.test(String(fonte || ''));
}

/**
 * Trava 2: a retomada pós-deploy só refaz rodada AGENDADA. Uma rodada manual
 * interrompida fica dita no log (âmbar) e quem a disparou decide se repete —
 * refazer sozinho é o que produziu as 109 e as 147 falhas de 25/09.
 */
export function fonteRetomavel(fonte) {
    return !ehFonteManual(fonte);
}

const msDe = (v) => {
    if (!v) return NaN;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (v._seconds != null) return v._seconds * 1000;
    if (v.seconds != null) return v.seconds * 1000;
    return Date.parse(v);
};

/** A rodada completa mais recente (por início) entre os logs recebidos. */
export function ultimaRodadaCompleta(logs) {
    let melhor = null;
    for (const l of logs || []) {
        if (!ehRodadaCompleta(l)) continue;
        const ini = msDe(l.iniciadoEm || l.executadoEm);
        if (!Number.isFinite(ini)) continue;
        if (!melhor || ini > melhor.inicioMs) melhor = { log: l, inicioMs: ini };
    }
    return melhor;
}

const fmtHoraBrt = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

/**
 * Trava 1: uma rodada completa pode começar agora?
 *
 * @param {object} p
 * @param {Array} p.logs       logs recentes de sefaz_cron_logs (qualquer ordem)
 * @param {number} [p.agoraMs]
 * @param {number} [p.janelaMs]
 * @returns {{ok: true} | {ok: false, motivo: string, faltaMin: number, ultimaInicioMs: number, fonte: string}}
 */
export function janelaDaRodadaCompleta({ logs, agoraMs = Date.now(), janelaMs = JANELA_RODADA_COMPLETA_MS } = {}) {
    const ultima = ultimaRodadaCompleta(logs);
    if (!ultima) return { ok: true };
    const idade = agoraMs - ultima.inicioMs;
    if (idade < 0 || idade >= janelaMs) return { ok: true };
    const faltaMin = Math.ceil((janelaMs - idade) / 60000);
    const fonte = String(ultima.log.fonte || 'rodada anterior');
    return {
        ok: false,
        faltaMin,
        ultimaInicioMs: ultima.inicioMs,
        fonte,
        motivo: `A última rodada completa (${fonte}) começou às ${fmtHoraBrt(ultima.inicioMs)}. `
            + `Cada CNPJ tem trava de 1 hora e a SEFAZ devolve cStat 656 na repetição: rodar agora daria `
            + `uma falha por empresa e nenhuma nota. Aguarde ${faltaMin} min. `
            + 'Para UMA empresa, use "↓ Sincronizar SEFAZ" na própria empresa.',
    };
}

/**
 * Trava 2 (nível empresa): o resultado de `sincronizarEmpresa` é sucesso,
 * pulo pela janela (a empresa foi consultada há menos de 1 h — não é defeito)
 * ou falha de verdade.
 */
export function classificarResultado(result) {
    if (result?.ok) return 'sucesso';
    if (result?.locked) return 'pulada-janela';
    return 'falha';
}

/** Código curto do motivo, para agrupar (mesma régua do errosResumo antigo). */
export function codigoDoResultado(result) {
    if (result?.rateLimited) return 'cStat=656';
    if (result?.certInvalido) return 'cStat=593';
    if (result?.semCert) return 'SEM_CERT';
    if (result?.locked) return 'JANELA';
    return null;
}

/**
 * Trava 3: a frase da rodada, com a causa dominante. É o que o toast, o
 * banner e a linha de Erros & Logs mostram — "147 falhas" sem causa era o
 * que mandava clicar de novo.
 *
 * @param {object} r  { totalEmpresas, sucessos, falhas, puladasJanela, totalNovosXmls, errosResumo }
 */
export function resumoDaRodada(r = {}) {
    const total = Number(r.totalEmpresas || 0);
    const novos = Number(r.totalNovosXmls ?? r.totalNovos ?? 0);
    const falhas = Number(r.falhas || 0);
    const puladas = Number(r.puladasJanela || 0);
    const partes = [`${novos} novos XMLs em ${total} empresa(s)`];
    if (falhas > 0) {
        const top = causaDominante(r.errosResumo);
        partes.push(`${falhas} falha(s)${top ? ` — ${top}` : ''}`);
    }
    if (puladas > 0) {
        partes.push(`${puladas} pulada(s) por terem sido consultadas há menos de 1 h (não é falha)`);
    }
    return partes.join(' · ');
}

/** "N× código — motivo" da causa mais frequente do errosResumo. */
export function causaDominante(errosResumo) {
    if (!Array.isArray(errosResumo) || errosResumo.length === 0) return '';
    const contagem = new Map();
    for (const e of errosResumo) {
        const chave = `${e?.codigo ? e.codigo + ' — ' : ''}${String(e?.motivo || 'sem motivo').slice(0, 90)}`;
        contagem.set(chave, (contagem.get(chave) || 0) + 1);
    }
    const [motivo, qtd] = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0];
    return `${qtd}× ${motivo}`;
}

/**
 * 🏷️ O NOME DA RODADA pelo `fonte` do log (26/09). O banner e o card do
 * Diagnóstico liam o ÚLTIMO doc de sefaz_cron_logs, fosse ele o que fosse, e
 * uma drenagem vazia das 19:00 saía como "Captura SEFAZ concluída — 0 novos
 * XMLs em 0 empresa(s)": lia-se "não houve captura". Cada rodada passa a
 * dizer o que é.
 */
export function rotuloDaFonte(fonte) {
    const f = String(fonte || '').trim();
    if (!f) return 'Rodada';
    if (/^retomada:/i.test(f)) return 'Retomada pós-deploy';
    if (/drenagem/i.test(f)) return 'Drenagem de pendências NSU';
    if (/dirigida|targeted/i.test(f)) return 'Captura dirigida';
    if (/admin-manual|cron-now/i.test(f)) return 'Captura manual';
    if (/noturno/i.test(f)) return 'Captura noturna';
    if (/xml-capture|intra/i.test(f)) return 'Captura intra-dia';
    return `Rodada ${f}`;
}

/**
 * A frase de UMA rodada com o seu nome na frente — é o que o banner e o
 * toast mostram. Drenagem sem alvo diz que não havia fila, em vez de "0
 * novos XMLs em 0 empresa(s)".
 */
export function fraseDaRodadaComTipo(s = {}) {
    const rotulo = rotuloDaFonte(s.fonte);
    if (s.status === 'pulada-janela') return `${rotulo} não iniciada — ${s.motivo || 'dentro da janela de 1 h da anterior'}`;
    if (/drenagem/i.test(String(s.fonte || '')) && Number(s.totalEmpresas || 0) === 0) {
        return `${rotulo}: nenhuma empresa com fila na SEFAZ — nada a drenar`;
    }
    return `${rotulo}: ${s.resumo || resumoDaRodada(s)}`;
}
