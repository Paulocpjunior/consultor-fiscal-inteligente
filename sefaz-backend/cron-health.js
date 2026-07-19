// ============================================================================
// sefaz-backend/cron-health.js  (ESM)
//
// Observabilidade dos crons: agrega o ÚLTIMO log de cada coleção *_cron_logs
// numa visão única de saúde (verde/amarelo/vermelho). Antes cada cron logava
// numa coleção própria e ninguém tinha um lugar pra ver "todos rodaram? algum
// travou?" — só dava pra descobrir cron parado olhando coleção por coleção.
//
// As funções de classificação/normalização são PURAS (sem firebase) → testáveis.
// coletarSaudeCrons faz o IO (lê o doc mais recente de cada coleção).
// ============================================================================

// Registro das coleções de log. tsField = campo de timestamp usado pra ordenar
// e achar o último run (varia por cron: executadoEm / criadoEm / iniciadoEm).
// maxIdleHoras = a partir de quantas horas sem rodar marcamos "atrasado" (aviso
// amarelo, não vermelho — folga generosa cobre fim de semana em crons úteis).
export const CRON_LOG_COLLECTIONS = [
    { collection: 'sefaz_cron_logs',            label: 'Captura NF-e (DistDFe)',       tsField: 'executadoEm', maxIdleHoras: 48 },
    { collection: 'nfsesp_cron_logs',           label: 'NFS-e SP (WS)',                tsField: 'executadoEm', maxIdleHoras: 48 },
    { collection: 'nfsesp_portal_cron_logs',    label: 'NFS-e SP (portal CSV)',        tsField: 'executadoEm', maxIdleHoras: 48 },
    { collection: 'nfse_nacional_dfe_cron_logs', label: 'NFS-e Nacional (ADN/DF-e)',   tsField: 'executadoEm', maxIdleHoras: 48 },
    { collection: 'das_cron_logs',              label: 'DAS (vencimentos)',            tsField: 'executadoEm', maxIdleHoras: 48 },
    { collection: 'dctfweb_cron_logs',          label: 'DCTFWeb (apuração)',           tsField: 'executadoEm', maxIdleHoras: 48 },
    { collection: 'manifestacoes_cron_logs',    label: 'Manifestações (ciência)',      tsField: 'iniciadoEm',  maxIdleHoras: 48 },
    { collection: 'caixa_postal_cron_logs',     label: 'Caixa postal e-CAC',           tsField: 'executadoEm', maxIdleHoras: 48 },
    { collection: 'cert_alerta_cron_logs',      label: 'Alerta de certificado',        tsField: 'criadoEm',    maxIdleHoras: 48 },
    { collection: 'tarefas_cron_logs',          label: 'Tarefas/obrigações mensais',   tsField: 'criadoEm',    maxIdleHoras: 800 }, // mensal
    { collection: 'vencimentos_cron_logs',      label: 'Vencimentos (alertas)',        tsField: 'executadoEm', maxIdleHoras: 48 },
];

// Converte os vários formatos de timestamp (Firestore Timestamp, ISO string,
// epoch ms, {seconds}/{_seconds}) para epoch ms. null se não der.
export function tsToMillis(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch { return null; } }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    if (typeof v._seconds === 'number') return v._seconds * 1000;
    return null;
}

// Extrai um resumo compacto (contadores comuns) do log pra exibir no painel.
const CAMPOS_RESUMO = ['totalEmpresas', 'sucessos', 'falhas', 'total', 'totalNovos', 'novosXmls', 'atualizados', 'alertasEnviados'];
export function extrairResumoLog(data) {
    const out = {};
    for (const k of CAMPOS_RESUMO) {
        if (typeof data?.[k] === 'number') out[k] = data[k];
    }
    return out;
}

// Normaliza um doc de log (formato variável) para o shape comum do painel.
export function normalizarEntradaLog(reg, data) {
    const d = data || {};
    const tsMs = tsToMillis(d[reg.tsField])
        ?? tsToMillis(d.finalizadoEm) ?? tsToMillis(d.executadoEm)
        ?? tsToMillis(d.criadoEm) ?? tsToMillis(d.iniciadoEm);
    // status só existe no heartbeat (sefaz); nas demais, a presença do log já
    // indica conclusão → 'sucesso'. 'iniciado' órfão = travado.
    const status = d.status || 'sucesso';
    const duracaoMs = (typeof d.duracaoMs === 'number' ? d.duracaoMs
        : typeof d.durationMs === 'number' ? d.durationMs
        : typeof d.duration === 'number' ? d.duration : null);
    return {
        collection: reg.collection,
        label: reg.label,
        maxIdleHoras: reg.maxIdleHoras,
        tsMs,
        status,
        duracaoMs,
        resumo: extrairResumoLog(d),
    };
}

/**
 * Classifica a saúde de um cron a partir da entrada normalizada.
 * saude: 'ok' (verde) | 'atrasado' (amarelo) | 'travado' (vermelho, órfão em
 * 'iniciado') | 'falha' (vermelho) | 'sem-dados' (cinza, nunca logou).
 * Função PURA — recebe o "agora" pra ser determinística em teste.
 */
export function classificarSaudeCron(entry, agoraMs) {
    const maxIdle = entry.maxIdleHoras ?? 48;
    if (!entry.tsMs) {
        return { ...entry, idadeHoras: null, saude: 'sem-dados' };
    }
    const idadeHoras = (agoraMs - entry.tsMs) / 3_600_000;
    let saude;
    if (entry.status === 'falha') saude = 'falha';
    else if (entry.status === 'iniciado' && idadeHoras > 2) saude = 'travado';
    else if (entry.status === 'iniciado') saude = 'ok'; // rodando agora
    else if (idadeHoras > maxIdle) saude = 'atrasado';
    else saude = 'ok';
    return { ...entry, idadeHoras: Math.round(idadeHoras * 10) / 10, saude };
}

// Ordem de severidade pra ordenar o painel (pior primeiro).
const ORDEM_SAUDE = { falha: 0, travado: 1, atrasado: 2, 'sem-dados': 3, ok: 4 };

/**
 * Lê o último log de cada coleção e devolve a lista de saúde ordenada por
 * severidade. `db` é um Firestore admin handle; `agoraMs` injetável p/ teste.
 */
export async function coletarSaudeCrons(db, agoraMs = Date.now()) {
    const linhas = [];
    for (const reg of CRON_LOG_COLLECTIONS) {
        try {
            const snap = await db.collection(reg.collection)
                .orderBy(reg.tsField, 'desc').limit(1).get();
            const data = snap.empty ? null : snap.docs[0].data();
            linhas.push(classificarSaudeCron(normalizarEntradaLog(reg, data), agoraMs));
        } catch (e) {
            linhas.push({
                collection: reg.collection, label: reg.label,
                saude: 'erro-leitura', erro: String(e.message || e).slice(0, 200),
            });
        }
    }
    linhas.sort((a, b) => (ORDEM_SAUDE[a.saude] ?? 9) - (ORDEM_SAUDE[b.saude] ?? 9));
    const problemas = linhas.filter(l => l.saude === 'falha' || l.saude === 'travado').length;
    return {
        geradoEm: new Date(agoraMs).toISOString(),
        totalCrons: CRON_LOG_COLLECTIONS.length,
        problemas,
        linhas,
    };
}
