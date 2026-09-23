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
    // nfsesp_cron_logs (WS legado) REMOVIDO 23/07: trilho aposentado (erro 1102,
    // job pausado). Mantê-lo aqui mostrava "OK · 0 ok · 121 falhas" pra sempre.
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

// Extrai o motivo dominante da execução (quando o log traz agregado de erros).
// É o que transforma "0 ok · 500 falhas" de número mudo em causa acionável.
//
// 🚨 E ELE PASSOU A DIZER DE QUEM FOI A FALHA (30/08). O colaborador rodou uma
// captura e viu "1 falha(s)" com o motivo — e perguntou, com razão: *"agora não
// sei se foi dela"*. O painel não tinha como responder, e **o dado estava no
// log o tempo todo**: o cron grava `errosResumo[].nome` e `.cnpj` desde o #28,
// justamente porque *"painel só dizia '17 falhas' sem nenhuma pista de QUAIS
// empresas"* — e esta função lia só o `motivo`, jogando o nome fora.
//
// É a classe "o dado existe e ninguém lê" pela terceira vez na mesma semana
// (o `naoConferidos` no header que a tela não lê, a flag do `coberturaIncompleta`).
//
// ⚠️ Com MAIS DE UMA falha ele não finge que é uma só: diz o primeiro nome e
// "e mais N". Nomear só o primeiro faria a pessoa conferir uma empresa e
// concluir que o resto está certo.
export function extrairMotivoTop(d) {
    // Run interrompido carrega o próprio motivo (auto-cura) — vem primeiro pra
    // o card explicar o vermelho/âmbar em vez de só dizer "Travado".
    if (d?.motivoInterrupcao) return String(d.motivoInterrupcao).slice(0, 200);
    const lista = d?.motivosResumo || d?.errosResumo || null;
    const m = Array.isArray(lista) ? lista[0] : null;
    if (m) {
        const txt = typeof m === 'string' ? m
            : `${m.quantidade ? m.quantidade + '× ' : ''}${m.motivo || m.codigo || ''}`;
        const base = String(txt).slice(0, 160);
        if (!base) return null;
        // ⚠️ Nome VAZIO não vira rótulo inventado — sem ele, a frase é a de antes.
        const nome = typeof m === 'string' ? '' : String(m.nome || '').trim();
        if (!nome) return base;
        const outras = Array.isArray(lista) && lista.length > 1 ? ` e mais ${lista.length - 1}` : '';
        return `${nome}${outras}: ${base}`.slice(0, 220);
    }
    if (d?.erroFatal) return String(d.erroFatal).slice(0, 160);
    if (d?.erro) return String(d.erro).slice(0, 160);
    return null;
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
        motivoTop: extrairMotivoTop(d),
        // 🚨 A FONTE responde "foi o cron ou fui EU?" (30/08). O heartbeat grava
        // `fonte` desde sempre — o nome do job do Scheduler no automático,
        // 'admin-manual'/'admin-dirigida' no clique — e o painel a descartava.
        // Sem ela, quem acabou de rodar uma captura não tem como saber se a
        // falha do card é a dele ou a da madrugada.
        // ⚠️ Ausente devolve null, nunca um rótulo inventado: log antigo não
        // tem o campo, e afirmar "cron" ali mandaria procurar no lugar errado.
        fonte: d.fonte ? String(d.fonte).slice(0, 60) : null,
    };
}

// A partir de quantas horas um run em 'iniciado' deixa de ser "rodando agora" e
// passa a ser órfão (container reciclado por deploy/scale-down no meio do
// setImmediate). Vale pra classificação E pra auto-cura.
export const HORAS_RUN_ORFAO = 2;

/**
 * Decide se um doc de log em 'iniciado' virou órfão e precisa ser CURADO —
 * marcado como 'interrompido' com motivo honesto. Sem isso o doc fica
 * 'iniciado' pra sempre e o painel mostra "TRAVADO" eterno mesmo depois de o
 * cron voltar a rodar (caso NFS-e SP, 27/07: 9h "travado" sem nada travado).
 * Função PURA — devolve o patch, quem grava é coletarSaudeCrons.
 *
 * @returns {{curar: boolean, patch?: object}}
 */
export function decidirCuraOrfao(data, agoraMs) {
    const d = data || {};
    if (d.status !== 'iniciado') return { curar: false };
    const inicioMs = tsToMillis(d.iniciadoEm) ?? tsToMillis(d.executadoEm) ?? tsToMillis(d.criadoEm);
    if (!inicioMs) return { curar: false }; // sem hora de início não dá pra julgar idade
    const idadeHoras = (agoraMs - inicioMs) / 3_600_000;
    if (idadeHoras <= HORAS_RUN_ORFAO) return { curar: false }; // ainda pode estar rodando
    const idadeTxt = idadeHoras < 24 ? `${Math.round(idadeHoras)}h` : `${Math.round(idadeHoras / 24)}d`;
    return {
        curar: true,
        patch: {
            status: 'interrompido',
            interrompidoEm: new Date(agoraMs).toISOString(),
            motivoInterrupcao: `Execução interrompida após ${idadeTxt} sem concluir (reinício do servidor — deploy ou reciclagem da instância). Nada foi capturado nesta rodada: rode a captura de novo ou aguarde o próximo horário do cron.`,
        },
    };
}

/**
 * Classifica a saúde de um cron a partir da entrada normalizada.
 * saude: 'ok' (verde) | 'atrasado' (amarelo) | 'interrompido' (âmbar, run morto
 * no meio mas com próxima rodada dentro da janela) | 'travado' (vermelho, órfão
 * em 'iniciado' que a cura não alcançou) | 'falha' (vermelho) | 'sem-dados'
 * (cinza, nunca logou).
 * Função PURA — recebe o "agora" pra ser determinística em teste.
 */
export function classificarSaudeCron(entry, agoraMs) {
    const maxIdle = entry.maxIdleHoras ?? 48;
    if (!entry.tsMs) {
        return { ...entry, idadeHoras: null, saude: 'sem-dados' };
    }
    const idadeHoras = (agoraMs - entry.tsMs) / 3_600_000;
    // All-failed: rodou e TODAS as tentativas falharam. Antes o painel marcava
    // "OK" só porque o log existia — verde mentiroso ("OK · 0 ok · 500 falhas",
    // caso Manifestações 23/07). Concluir não é funcionar.
    const r = entry.resumo || {};
    const allFailed = typeof r.sucessos === 'number' && typeof r.falhas === 'number'
        && r.sucessos === 0 && r.falhas > 0;
    let saude;
    if (entry.status === 'falha') saude = 'falha';
    else if (entry.status === 'iniciado' && idadeHoras > HORAS_RUN_ORFAO) saude = 'travado';
    else if (entry.status === 'iniciado') saude = 'ok'; // rodando agora
    // Run interrompido (deploy/reciclagem): âmbar enquanto a próxima rodada
    // ainda cabe na janela; se passou do maxIdle sem nova execução, é falha de
    // verdade — o cron não voltou sozinho.
    else if (entry.status === 'interrompido') saude = idadeHoras > maxIdle ? 'falha' : 'interrompido';
    else if (allFailed) saude = 'falha';
    else if (idadeHoras > maxIdle) saude = 'atrasado';
    else saude = 'ok';
    return { ...entry, idadeHoras: Math.round(idadeHoras * 10) / 10, saude };
}

// Ordem de severidade pra ordenar o painel (pior primeiro).
const ORDEM_SAUDE = { falha: 0, travado: 1, interrompido: 2, atrasado: 3, 'sem-dados': 4, ok: 5 };

/**
 * Lê o último log de cada coleção e devolve a lista de saúde ordenada por
 * severidade. `db` é um Firestore admin handle; `agoraMs` injetável p/ teste.
 *
 * Também CURA runs órfãos: doc que ficou em 'iniciado' por mais de
 * HORAS_RUN_ORFAO vira 'interrompido' com motivo. Antes o doc órfão ficava
 * 'iniciado' pra sempre e o painel gritava "TRAVADO" eterno — o cron NFS-e SP
 * apareceu "travado há 9h" quando nada estava travado (o container tinha sido
 * reciclado num deploy). Passe `{ curar: false }` pra só ler.
 */
export async function coletarSaudeCrons(db, agoraMs = Date.now(), { curar = true } = {}) {
    const linhas = [];
    let curados = 0;
    for (const reg of CRON_LOG_COLLECTIONS) {
        try {
            const snap = await db.collection(reg.collection)
                .orderBy(reg.tsField, 'desc').limit(1).get();
            const doc = snap.empty ? null : snap.docs[0];
            let data = doc ? doc.data() : null;
            if (curar && data) {
                const cura = decidirCuraOrfao(data, agoraMs);
                // Sem ref (stub/teste) não dá pra gravar: cai no 'travado' —
                // vermelho honesto em vez de fingir que curou.
                if (cura.curar && typeof doc.ref?.update === 'function') {
                    try {
                        await doc.ref.update(cura.patch);
                        data = { ...data, ...cura.patch };
                        curados++;
                        console.warn(`[cron-health] run órfão curado em ${reg.collection}: ${cura.patch.motivoInterrupcao}`);
                    } catch (e) {
                        console.warn(`[cron-health] falha curando órfão em ${reg.collection}: ${e.message}`);
                    }
                }
            }
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
        curados,
        linhas,
    };
}

/**
 * Decide se dispara alerta de cron. Problema = cron em 'falha' ou 'travado'
 * (os vermelhos acionáveis; 'atrasado' é amarelo e não alerta, pra não spammar
 * na segunda de manhã por gap de fim de semana). Anti-spam por ASSINATURA: só
 * alerta quando o conjunto de crons problemáticos muda OU virou o dia — assim um
 * problema persistente re-alerta 1x/dia e um problema novo alerta na hora.
 * Função PURA (recebe hojeData 'YYYY-MM-DD' pra ser determinística em teste).
 */
export function decidirAlertaCron(saude, estadoAnterior, hojeData) {
    const problemas = (saude?.linhas || []).filter(l => l.saude === 'falha' || l.saude === 'travado');
    const assinatura = problemas.map(p => p.collection).sort().join(',');
    if (problemas.length === 0) {
        return { alertar: false, assinatura: '', problemas: [] };
    }
    const prevAssinatura = estadoAnterior?.assinatura || '';
    const prevData = estadoAnterior?.data || '';
    const alertar = assinatura !== prevAssinatura || hojeData !== prevData;
    return { alertar, assinatura, problemas };
}
