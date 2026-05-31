// ============================================================================
// sefaz-backend/vencimentos-orchestrator.js
//
// Cron diário 08:00 BRT — examina coleção `tarefas` e dispara alertas:
//
//   D-3, D-1: aviso de vencimento próximo (email + notificação in-app)
//   D-0 (vence hoje): URGENTE (email + push browser)
//   D+1 em diante: aviso de atraso com multa estimada
//
// Idempotente por dia: marca `ultimoEmailEm` na tarefa pra não disparar 2x
// no mesmo dia. Cron noturno é seguro pra rodar várias vezes.
//
// Notificações in-app são gravadas em `notificacoes/{uid}/items/{id}` pro
// front exibir no banner topo + sino de notificações.
// ============================================================================

import admin from 'firebase-admin';
import { enviarEmail, isGraphConfigured } from './graph-provider.js';
import { calcularMultaPorObrigacao } from './multa-calculator.js';

const TZ_OFFSET_BRT = -3; // BRT = UTC-3
const REMETENTE_DEFAULT = process.env.GRAPH_REMETENTE || 'contabil@spassessoriacontabil.com.br';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

// Data atual no fuso BRT, normalizada pra 00:00
function hojeBrt() {
    const agora = new Date();
    const brt = new Date(agora.getTime() + (TZ_OFFSET_BRT * 60 * 60 * 1000) - (agora.getTimezoneOffset() * 60 * 1000));
    brt.setHours(0, 0, 0, 0);
    return brt;
}

function diffDiasBrt(dataVencimento, hoje = hojeBrt()) {
    const v = dataVencimento instanceof Date
        ? new Date(dataVencimento.getTime())
        : (dataVencimento?.toDate?.() || new Date(dataVencimento));
    v.setHours(0, 0, 0, 0);
    return Math.round((v.getTime() - hoje.getTime()) / (24 * 60 * 60 * 1000));
}

// Classifica gravidade
function classificar(diasAteVencimento) {
    if (diasAteVencimento < 0) return { categoria: 'atrasada', urgencia: 'critica', emoji: '🔴' };
    if (diasAteVencimento === 0) return { categoria: 'vence_hoje', urgencia: 'critica', emoji: '🟠' };
    if (diasAteVencimento <= 1) return { categoria: 'vence_amanha', urgencia: 'alta', emoji: '🟡' };
    if (diasAteVencimento <= 3) return { categoria: 'vence_3d', urgencia: 'media', emoji: '🟢' };
    return { categoria: 'futura', urgencia: 'baixa', emoji: '⚪' };
}

// Decide se manda email/push pra essa tarefa hoje
function deveAlertar(tarefa, diasAteVencimento) {
    if (!['a_fazer', 'em_andamento'].includes(tarefa.status)) return false;
    // Alerta TODA tarefa não concluída que está atrasada ou vence em <=7 dias.
    // Idempotência diária (ultimoEmailEm) previne email duplicado.
    return diasAteVencimento <= 7;
}

function getEmailResponsavel(tarefa, mapaUsuarios) {
    if (!tarefa.responsavel) return null;
    return mapaUsuarios.get(tarefa.responsavel)?.email || null;
}

async function carregarUsuarios(db) {
    const snap = await db.collection('users').get();
    const mapa = new Map();
    snap.forEach(d => mapa.set(d.id, { uid: d.id, ...d.data() }));
    return mapa;
}

// Gera o assunto/corpo do email
function montarConteudoEmail(tarefa, dias, categoria) {
    const venc = tarefa.vencimento?.toDate?.() || new Date(tarefa.vencimento);
    const dataFmt = venc.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const titulo = `${categoria.emoji} ${tarefa.titulo} — ${tarefa.empresaNome}`;
    let labelVencimento;
    if (dias < 0) labelVencimento = `<b style="color:#d33">ATRASADA HÁ ${Math.abs(dias)} DIA${Math.abs(dias) > 1 ? 'S' : ''}</b>`;
    else if (dias === 0) labelVencimento = `<b style="color:#d33">VENCE HOJE</b>`;
    else if (dias === 1) labelVencimento = `<b style="color:#e80">VENCE AMANHÃ</b>`;
    else labelVencimento = `Vence em ${dias} dia${dias > 1 ? 's' : ''}`;

    const corpo = `
<!DOCTYPE html><html><body style="font-family: -apple-system, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">${categoria.emoji} Alerta de Obrigação Fiscal</h1>
    </div>
    <div style="background: white; padding: 24px; border: 1px solid #e5e7eb; border-radius: 0 0 12px 12px;">
        <h2 style="margin: 0 0 12px; color: #111827;">${tarefa.titulo}</h2>
        <p style="margin: 0 0 16px; color: #4b5563;">${tarefa.descricao || ''}</p>
        <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #6b7280; width: 35%;">Empresa</td><td style="padding: 6px 0; font-weight: 600;">${tarefa.empresaNome}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">CNPJ</td><td style="padding: 6px 0; font-family: monospace;">${tarefa.empresaCnpj}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Obrigação</td><td style="padding: 6px 0;">${tarefa.obrigacao}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Competência</td><td style="padding: 6px 0;">${tarefa.competencia || '—'}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Vencimento</td><td style="padding: 6px 0;">${dataFmt}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Status</td><td style="padding: 6px 0;">${labelVencimento}</td></tr>
        </table>
        ${tarefa.valorEstimado && dias < 0 ? `
        <div style="margin-top: 16px; padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px;">
            <b>⚠️ Multa + juros estimados:</b><br>
            Valor original: R$ ${(tarefa.valorEstimado || 0).toFixed(2)}<br>
            Multa: R$ ${(tarefa.multaEstimada?.multaValor || 0).toFixed(2)} (${tarefa.multaEstimada?.multaPct?.toFixed(2)}%)<br>
            Juros: R$ ${(tarefa.multaEstimada?.jurosValor || 0).toFixed(2)} (${tarefa.multaEstimada?.jurosPct?.toFixed(2)}%)<br>
            <b>Total estimado: R$ ${(tarefa.multaEstimada?.total || 0).toFixed(2)}</b>
        </div>` : ''}
        <div style="margin-top: 24px; text-align: center;">
            <a href="https://consultor-fiscal-inteligente-631239634290.us-west1.run.app/" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">Abrir no sistema →</a>
        </div>
        <p style="margin: 24px 0 0; color: #9ca3af; font-size: 12px; text-align: center;">
            Consultor Fiscal Inteligente — SP Assessoria Contábil
        </p>
    </div>
</body></html>`;
    return { assunto: titulo, corpoHtml: corpo };
}

// Cria item em `notificacoes/{uid}/items` pra mostrar no UI
async function criarNotificacaoInApp(db, uidDestinatario, tarefa, dias, categoria) {
    const ref = db.collection('notificacoes').doc(uidDestinatario).collection('items').doc(`venc-${tarefa.id}-${new Date().toISOString().slice(0, 10)}`);
    await ref.set({
        tipo: 'vencimento',
        urgencia: categoria.urgencia,
        emoji: categoria.emoji,
        titulo: tarefa.titulo,
        empresaNome: tarefa.empresaNome,
        empresaCnpj: tarefa.empresaCnpj,
        obrigacao: tarefa.obrigacao,
        competencia: tarefa.competencia,
        diasAteVencimento: dias,
        lida: false,
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        tarefaId: tarefa.id,
        link: '/Tarefas',
    }, { merge: true });
}

// Monta o email-resumo (digest) que vai pros admins. Lista TODAS as
// obrigações da janela de alerta, agrupando atrasadas / hoje / próximas.
function montarDigestEmail(itens, hojeIso) {
    const atrasadas = itens.filter(i => i.dias < 0);
    const hoje = itens.filter(i => i.dias === 0);
    const proximas = itens.filter(i => i.dias > 0);

    const linha = (i) => {
        const quando = i.dias < 0 ? `<b style="color:#d33">há ${Math.abs(i.dias)}d</b>`
            : i.dias === 0 ? `<b style="color:#d33">hoje</b>`
            : i.dias === 1 ? `<b style="color:#e80">amanhã</b>`
            : `em ${i.dias}d`;
        const valor = i.valorEstimado ? `R$ ${Number(i.valorEstimado).toFixed(2)}` : '—';
        return `<tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap">${quando}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee">${i.titulo || i.obrigacao || '—'}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee">${i.empresaNome || '—'}<br><span style="color:#999;font-size:11px">${i.empresaCnpj || ''}</span></td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee">${i.responsavelNome || '<span style="color:#c00">(sem responsável)</span>'}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">${valor}</td>
        </tr>`;
    };

    const secao = (titulo, cor, lista) => lista.length === 0 ? '' : `
        <tr><td colspan="5" style="padding:10px 8px 4px;font-weight:700;color:${cor};border-bottom:2px solid ${cor}">${titulo} (${lista.length})</td></tr>
        ${lista.slice(0, 80).map(linha).join('')}
        ${lista.length > 80 ? `<tr><td colspan="5" style="padding:6px 8px;color:#999;font-style:italic">… e mais ${lista.length - 80}</td></tr>` : ''}`;

    const corpo = `
<!DOCTYPE html><html><body style="font-family:-apple-system,Arial,sans-serif;max-width:760px;margin:0 auto;color:#111">
    <div style="background:linear-gradient(135deg,#dc2626,#7c3aed);color:#fff;padding:22px;border-radius:12px 12px 0 0">
        <h1 style="margin:0;font-size:20px">📋 Resumo diário de obrigações</h1>
        <p style="margin:6px 0 0;opacity:.9;font-size:13px">${hojeIso} — SP Assessoria Contábil</p>
    </div>
    <div style="background:#fff;padding:18px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        <p style="margin:0 0 12px;font-size:14px">
            <b>${atrasadas.length}</b> atrasada${atrasadas.length === 1 ? '' : 's'} ·
            <b>${hoje.length}</b> vence${hoje.length === 1 ? '' : 'm'} hoje ·
            <b>${proximas.length}</b> próxima${proximas.length === 1 ? '' : 's'} (≤7d)
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="background:#f3f4f6">
                <th style="padding:6px 8px;text-align:left">Quando</th>
                <th style="padding:6px 8px;text-align:left">Obrigação</th>
                <th style="padding:6px 8px;text-align:left">Empresa</th>
                <th style="padding:6px 8px;text-align:left">Responsável</th>
                <th style="padding:6px 8px;text-align:right">Valor est.</th>
            </tr></thead>
            <tbody>
                ${secao('🔴 Atrasadas', '#dc2626', atrasadas)}
                ${secao('🟠 Vencem hoje', '#ea580c', hoje)}
                ${secao('🟡 Próximas (≤7 dias)', '#ca8a04', proximas)}
            </tbody>
        </table>
        <div style="margin-top:20px;text-align:center">
            <a href="https://consultor-fiscal-inteligente-631239634290.us-west1.run.app/" style="display:inline-block;padding:11px 22px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Abrir no sistema →</a>
        </div>
    </div>
</body></html>`;
    return corpo;
}

/**
 * Pipeline principal: roda diariamente.
 * @param {object} opts
 * @param {string} opts.disparadoPor
 * @param {boolean} opts.force  ignora idempotência diária (re-dispara hoje)
 */
export async function processarVencimentos({ disparadoPor = 'cron-08h', force = false } = {}) {
    const db = fa().firestore();
    const t0 = Date.now();
    const log = {
        iniciadoEm: new Date(t0).toISOString(),
        disparadoPor,
        examinadas: 0,
        alertadas: 0,
        emailsEnviados: 0,
        emailsFalhados: 0,
        notificacoesIn: 0,
        porCategoria: { atrasada: 0, vence_hoje: 0, vence_amanha: 0, vence_3d: 0 },
        erros: [],
    };

    try {
        const usuariosMapa = await carregarUsuarios(db);
        const hoje = hojeBrt();
        const janelaFutura = new Date(hoje.getTime() + 5 * 24 * 60 * 60 * 1000);

        // Pega TODAS tarefas ativas (sem filtro de vencimento Firestore-side
        // porque tarefas antigas podem ter vencimento como string em vez de
        // Timestamp). Filtra janela em memória. 2 queries paralelas pra
        // evitar 'in' operator.
        const baseQuery = (status) => db.collection('tarefas')
            .where('status', '==', status)
            .limit(5000);

        const [snapAfazer, snapAndamento] = await Promise.all([
            baseQuery('a_fazer').get(),
            baseQuery('em_andamento').get(),
        ]);

        // Filtra janela em memória: [hoje-90d, hoje+5d]
        // (90d passados pra cobrir tarefas atrasadas mais antigas)
        const inicioJanela = new Date(hoje.getTime() - 90 * 24 * 60 * 60 * 1000).getTime();
        const fimJanela = janelaFutura.getTime();

        const todasDocs = [...snapAfazer.docs, ...snapAndamento.docs];
        log.totalAtivas = todasDocs.length;

        // DEBUG: amostra primeira tarefa pra ver formato vencimento
        if (todasDocs.length > 0) {
            const sample = todasDocs[0].data();
            const v = sample.vencimento;
            console.log(`[vencimentos] DEBUG sample tarefa: id=${todasDocs[0].id} vencimento=${JSON.stringify(v)} typeof=${typeof v} hasToDate=${typeof v?.toDate === 'function'}`);
        }

        let semVencimento = 0;
        let foraJanela = 0;
        const docs = todasDocs.filter(d => {
            const v = d.data().vencimento;
            let ms = null;
            if (v && typeof v.toDate === 'function') ms = v.toDate().getTime();
            else if (v && typeof v.seconds === 'number') ms = v.seconds * 1000;
            else if (v) {
                const parsed = new Date(v).getTime();
                if (!Number.isNaN(parsed)) ms = parsed;
            }
            if (ms === null) { semVencimento++; return false; }
            if (ms < inicioJanela || ms > fimJanela) { foraJanela++; return false; }
            return true;
        });

        log.semVencimento = semVencimento;
        log.foraJanela = foraJanela;
        log.examinadas = docs.length;
        log.graphConfigured = isGraphConfigured();
        console.log(`[vencimentos] totalAtivas=${log.totalAtivas} semVenc=${semVencimento} foraJanela=${foraJanela} examinadas=${log.examinadas} force=${force} graphConfigured=${log.graphConfigured} janela=[${new Date(inicioJanela).toISOString()},${new Date(fimJanela).toISOString()}]`);

        // Pré-computa UIDs admin (1 vez, não por tarefa)
        const adminUids = [];
        for (const [uid, user] of usuariosMapa) {
            if (user.role === 'admin') adminUids.push(uid);
        }

        // Email com timeout pra não travar o loop se Graph estiver lento/off
        const enviarEmailComTimeout = (args, ms = 8000) => Promise.race([
            enviarEmail(args),
            new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'timeout' }), ms)),
        ]);

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        let processadas = 0;

        for (const doc of docs) {
            processadas++;
            if (processadas % 100 === 0) {
                console.log(`[vencimentos] progresso ${processadas}/${docs.length} — alertadas=${log.alertadas} emails=${log.emailsEnviados}`);
            }
            try {
                const tarefa = { id: doc.id, ...doc.data() };
                const dias = diffDiasBrt(tarefa.vencimento, hoje);
                const categoria = classificar(dias);

                if (!deveAlertar(tarefa, dias)) continue;

                // Idempotência por dia (force ignora pra re-disparar)
                const hojeIso = hoje.toISOString().slice(0, 10);
                const ultimoEmail = tarefa.ultimoEmailEm?.toDate?.()?.toISOString?.()?.slice(0, 10);
                if (!force && ultimoEmail === hojeIso) continue;

                // Multa estimada se atrasada e tem valorEstimado
                let multaEstimada = null;
                if (dias < 0 && tarefa.valorEstimado) {
                    multaEstimada = calcularMultaPorObrigacao(tarefa.obrigacao, tarefa.valorEstimado, tarefa.vencimento.toDate?.() || new Date(tarefa.vencimento), hoje);
                }

                // Email pro responsável (só se tiver responsável com email)
                const emailResp = getEmailResponsavel(tarefa, usuariosMapa);
                if (emailResp) {
                    const tarefaComMulta = { ...tarefa, multaEstimada };
                    const { assunto, corpoHtml } = montarConteudoEmail(tarefaComMulta, dias, categoria);
                    const r = await enviarEmailComTimeout({ remetente: REMETENTE_DEFAULT, para: emailResp, assunto, corpoHtml });
                    if (r.ok) {
                        log.emailsEnviados++;
                        if (log.emailsEnviados % 10 === 0) await sleep(2500); // throttle Graph
                    } else {
                        log.emailsFalhados++;
                        if (log.erros.length < 20) log.erros.push({ tarefa: tarefa.id, motivo: r.error });
                    }
                    // Notificação in-app pro responsável
                    await criarNotificacaoInApp(db, tarefa.responsavel, tarefa, dias, categoria);
                    log.notificacoesIn++;
                }

                // Marca ultimoEmailEm
                await doc.ref.update({ ultimoEmailEm: admin.firestore.FieldValue.serverTimestamp() });

                log.alertadas++;
                if (log.porCategoria[categoria.categoria] !== undefined) log.porCategoria[categoria.categoria]++;
            } catch (eDoc) {
                if (log.erros.length < 20) log.erros.push({ tarefa: doc.id, motivo: eDoc.message });
            }
        }

        // ─── Digest pros admins (in-app + EMAIL) ────────────────────────────
        // Passada completa sobre TODAS as obrigações da janela que merecem
        // alerta (deveAlertar), independente de terem responsável ou de já
        // terem sido marcadas hoje. Garante que o admin tem a visão completa
        // todo dia e recebe 1 email-resumo diário (mesmo com 0 responsáveis).
        const hojeIso = hoje.toISOString().slice(0, 10);
        const digestItens = [];
        for (const doc of docs) {
            const t = doc.data();
            const dias = diffDiasBrt(t.vencimento, hoje);
            if (!deveAlertar(t, dias)) continue;
            digestItens.push({
                id: doc.id, titulo: t.titulo, empresaNome: t.empresaNome,
                empresaCnpj: t.empresaCnpj, obrigacao: t.obrigacao,
                competencia: t.competencia, dias,
                responsavelNome: t.responsavelNome || null,
                valorEstimado: t.valorEstimado || null,
            });
        }
        digestItens.sort((a, b) => a.dias - b.dias);
        log.digestTotal = digestItens.length;

        if (digestItens.length > 0 && adminUids.length > 0) {
            const atrasadas = digestItens.filter(i => i.dias < 0).length;
            const venceHoje = digestItens.filter(i => i.dias === 0).length;
            const proximas = digestItens.filter(i => i.dias > 0).length;
            const tituloDigest = `${digestItens.length} obrigações — ${atrasadas} atrasadas, ${venceHoje} hoje, ${proximas} próximas`;

            // (1) Notificação in-app por admin (idempotente por id de data)
            for (const uid of adminUids) {
                try {
                    await db.collection('notificacoes').doc(uid).collection('items').doc(`digest-venc-${hojeIso}`).set({
                        tipo: 'vencimento_digest',
                        urgencia: atrasadas > 0 || venceHoje > 0 ? 'critica' : 'media',
                        emoji: atrasadas > 0 || venceHoje > 0 ? '🔴' : '🟡',
                        titulo: tituloDigest,
                        total: digestItens.length,
                        atrasadas, venceHoje, proximas,
                        amostra: digestItens.slice(0, 15),
                        lida: false,
                        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
                        link: '/Tarefas',
                    }, { merge: true });
                    log.notificacoesIn++;
                } catch (e) {
                    if (log.erros.length < 20) log.erros.push({ admin: uid, motivo: e.message });
                }
            }
            log.adminsNotificados = adminUids.length;

            // (2) Email-resumo pros admins — 1x/dia (force ignora a trava)
            const emailsAdmin = adminUids.map(uid => usuariosMapa.get(uid)?.email).filter(Boolean);
            const metaRef = db.collection('vencimentos_meta').doc('digest-email');
            let jaEnviouHoje = false;
            try {
                const metaSnap = await metaRef.get();
                jaEnviouHoje = metaSnap.exists && metaSnap.data().ultimoEnvioIso === hojeIso;
            } catch { /* sem meta = nunca enviou */ }

            if (emailsAdmin.length > 0 && (force || !jaEnviouHoje)) {
                const corpoHtml = montarDigestEmail(digestItens, hojeIso);
                const r = await enviarEmailComTimeout({
                    remetente: REMETENTE_DEFAULT,
                    para: emailsAdmin,
                    assunto: `📋 [Obrigações ${hojeIso}] ${tituloDigest}`,
                    corpoHtml,
                }, 12000);
                if (r.ok) {
                    log.emailDigestEnviado = true;
                    log.emailsEnviados++;
                    try {
                        await metaRef.set({
                            ultimoEnvioIso: hojeIso,
                            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
                            totalNoDigest: digestItens.length,
                            destinatarios: emailsAdmin,
                        }, { merge: true });
                    } catch { /* trava best-effort */ }
                } else {
                    log.emailDigestErro = r.error;
                    if (log.erros.length < 20) log.erros.push({ digestEmail: true, motivo: r.error });
                }
            } else {
                log.emailDigestPulado = emailsAdmin.length === 0 ? 'sem-email-admin' : 'ja-enviado-hoje';
            }
        }
    } catch (e) {
        log.erroFatal = e.message;
        console.error('[vencimentos] erro fatal:', e);
    } finally {
        log.duracaoMs = Date.now() - t0;
        try {
            await fa().firestore().collection('vencimentos_cron_logs').add({
                executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                ...log,
                erros: log.erros.slice(0, 20),
            });
        } catch (e) { console.warn('[vencimentos] log falhou:', e.message); }
    }

    return log;
}

/**
 * Retorna resumo de vencimentos pra dashboard/banner (sem disparar emails).
 */
export async function resumoVencimentos({ uid, role } = {}) {
    const db = fa().firestore();
    const hoje = hojeBrt();
    const janelaFutura = new Date(hoje.getTime() + 30 * 24 * 60 * 60 * 1000);
    const limitePassado = new Date(hoje.getTime() - 60 * 24 * 60 * 60 * 1000);

    const baseQ = (status) => db.collection('tarefas')
        .where('status', '==', status)
        .limit(2500);

    const [s1, s2] = await Promise.all([baseQ('a_fazer').get(), baseQ('em_andamento').get()]);
    const inicioJanela = limitePassado.getTime();
    const fimJanela = janelaFutura.getTime();
    const todos = [...s1.docs, ...s2.docs].filter(d => {
        const v = d.data().vencimento;
        const ms = v?.toDate?.()?.getTime?.() ?? (v ? new Date(v).getTime() : NaN);
        return !Number.isNaN(ms) && ms >= inicioJanela && ms <= fimJanela;
    });

    const resumo = { atrasadas: 0, venceHoje: 0, venceAmanha: 0, vence3d: 0, vence7d: 0, vence30d: 0, total: 0 };
    const proximas = [];

    todos.forEach(d => {
        const t = { id: d.id, ...d.data() };
        // Se for colaborador, só conta as dele
        if (role !== 'admin' && uid && t.responsavel && t.responsavel !== uid) return;
        const dias = diffDiasBrt(t.vencimento, hoje);
        resumo.total++;
        if (dias < 0) resumo.atrasadas++;
        else if (dias === 0) resumo.venceHoje++;
        else if (dias === 1) resumo.venceAmanha++;
        else if (dias <= 3) resumo.vence3d++;
        else if (dias <= 7) resumo.vence7d++;
        else if (dias <= 30) resumo.vence30d++;
        if (dias <= 7) {
            proximas.push({
                id: t.id,
                titulo: t.titulo,
                empresaNome: t.empresaNome,
                empresaCnpj: t.empresaCnpj,
                obrigacao: t.obrigacao,
                competencia: t.competencia,
                vencimento: t.vencimento?.toDate?.()?.toISOString?.() || null,
                diasAteVencimento: dias,
                responsavel: t.responsavel,
                responsavelNome: t.responsavelNome,
                valorEstimado: t.valorEstimado || null,
            });
        }
    });

    proximas.sort((a, b) => a.diasAteVencimento - b.diasAteVencimento);
    return { resumo, proximas: proximas.slice(0, 50), geradoEm: new Date().toISOString() };
}
