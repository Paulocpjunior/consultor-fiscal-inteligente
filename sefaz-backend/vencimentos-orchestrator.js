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
import { enviarEmail } from './graph-provider.js';
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
    // Alerta em D-3, D-1, D-0, D+1, D+7
    const marcos = [3, 1, 0, -1, -7];
    return marcos.includes(diasAteVencimento);
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

/**
 * Pipeline principal: roda diariamente.
 */
export async function processarVencimentos({ disparadoPor = 'cron-08h' } = {}) {
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

        // Pega tarefas ativas (a_fazer | em_andamento) com vencimento na janela [hoje-30d, hoje+5d]
        const limiteFuturo = admin.firestore.Timestamp.fromDate(janelaFutura);
        const limitePassado = admin.firestore.Timestamp.fromDate(new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000));

        const snap = await db.collection('tarefas')
            .where('status', 'in', ['a_fazer', 'em_andamento'])
            .where('vencimento', '>=', limitePassado)
            .where('vencimento', '<=', limiteFuturo)
            .get();

        log.examinadas = snap.size;

        for (const doc of snap.docs) {
            try {
                const tarefa = { id: doc.id, ...doc.data() };
                const dias = diffDiasBrt(tarefa.vencimento, hoje);
                const categoria = classificar(dias);

                if (!deveAlertar(tarefa, dias)) continue;

                // Idempotência por dia
                const hojeIso = hoje.toISOString().slice(0, 10);
                const ultimoEmail = tarefa.ultimoEmailEm?.toDate?.()?.toISOString?.()?.slice(0, 10);
                if (ultimoEmail === hojeIso) continue;

                // Calcula multa estimada se atrasada e tem valorEstimado
                let multaEstimada = null;
                if (dias < 0 && tarefa.valorEstimado) {
                    multaEstimada = calcularMultaPorObrigacao(tarefa.obrigacao, tarefa.valorEstimado, tarefa.vencimento.toDate?.() || new Date(tarefa.vencimento), hoje);
                }

                const tarefaComMulta = { ...tarefa, multaEstimada };
                const { assunto, corpoHtml } = montarConteudoEmail(tarefaComMulta, dias, categoria);

                // Email pro responsável
                const emailResp = getEmailResponsavel(tarefa, usuariosMapa);
                if (emailResp) {
                    try {
                        const r = await enviarEmail({ remetente: REMETENTE_DEFAULT, para: emailResp, assunto, corpoHtml });
                        if (r.ok) log.emailsEnviados++;
                        else { log.emailsFalhados++; log.erros.push({ tarefa: tarefa.id, motivo: r.error }); }
                    } catch (e) {
                        log.emailsFalhados++;
                        log.erros.push({ tarefa: tarefa.id, motivo: e.message });
                    }
                }

                // Notificação in-app pro responsável + admins (master ve tudo)
                if (tarefa.responsavel) {
                    await criarNotificacaoInApp(db, tarefa.responsavel, tarefa, dias, categoria);
                    log.notificacoesIn++;
                }
                // Admins recebem notificação de atrasadas/vencendo hoje pra acompanhar
                if (dias <= 0) {
                    for (const [uid, user] of usuariosMapa) {
                        if (user.role === 'admin' && uid !== tarefa.responsavel) {
                            await criarNotificacaoInApp(db, uid, tarefa, dias, categoria);
                            log.notificacoesIn++;
                        }
                    }
                }

                // Marca ultimoEmailEm
                await doc.ref.update({ ultimoEmailEm: admin.firestore.FieldValue.serverTimestamp() });

                log.alertadas++;
                if (log.porCategoria[categoria.categoria] !== undefined) log.porCategoria[categoria.categoria]++;
            } catch (eDoc) {
                log.erros.push({ tarefa: doc.id, motivo: eDoc.message });
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

    const snap = await db.collection('tarefas')
        .where('status', 'in', ['a_fazer', 'em_andamento'])
        .where('vencimento', '>=', admin.firestore.Timestamp.fromDate(limitePassado))
        .where('vencimento', '<=', admin.firestore.Timestamp.fromDate(janelaFutura))
        .limit(500)
        .get();

    const resumo = { atrasadas: 0, venceHoje: 0, venceAmanha: 0, vence3d: 0, vence7d: 0, vence30d: 0, total: 0 };
    const proximas = [];

    snap.forEach(d => {
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
