// ============================================================================
// sefaz-backend/notificacoes-orchestrator.js
// Monta o resumo diario de capturas (SEFAZ XML + SharePoint) e dispara
// a notificacao por e-mail via Graph.
// ============================================================================

import admin from 'firebase-admin';
import { enviarEmail, isGraphConfigured } from './graph-provider.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Le os logs de captura das ultimas `horas` horas e devolve um resumo agregado.
 */
export async function coletarResumoCapturas(horas = 24) {
    const db = fa().firestore();
    const desde = new Date(Date.now() - horas * 60 * 60 * 1000);

    // --- SEFAZ XML (sefaz_cron_logs) ---
    let sefaz = { execucoes: 0, novosXmls: 0, sucessos: 0, falhas: 0 };
    try {
        const snap = await db.collection('sefaz_cron_logs')
            .where('executadoEm', '>=', desde)
            .get();
        snap.forEach(d => {
            const x = d.data();
            sefaz.execucoes++;
            sefaz.novosXmls += x.totalNovosXmls || 0;
            sefaz.sucessos += x.sucessos || 0;
            sefaz.falhas += x.falhas || 0;
        });
    } catch (e) {
        console.warn('[notif] leitura sefaz_cron_logs:', e.message);
    }

    // --- SharePoint (sharepoint_sync_log) ---
    let sharepoint = { execucoes: 0, docsSincronizados: 0, empresas: 0, erros: 0 };
    try {
        const snap = await db.collection('sharepoint_sync_log')
            .where('createdAt', '>=', desde)
            .get();
        snap.forEach(d => {
            const x = d.data();
            sharepoint.execucoes++;
            sharepoint.docsSincronizados += x.totalDocsSincronizados || 0;
            sharepoint.empresas += x.empresasProcessadas || 0;
            sharepoint.erros += x.totalDocsErros || 0;
        });
    } catch (e) {
        console.warn('[notif] leitura sharepoint_sync_log:', e.message);
    }

    return {
        horas,
        sefaz,
        sharepoint,
        totalCapturas: sefaz.novosXmls + sharepoint.docsSincronizados,
    };
}

/** Monta o corpo HTML do e-mail de resumo diario. */
export function montarCorpoResumo(resumo) {
    const { sefaz, sharepoint, totalCapturas } = resumo;
    return `
        <h2 style="color:#020026">Resumo diário de capturas</h2>
        <p>Nas últimas ${resumo.horas} horas, o Consultor Fiscal Inteligente capturou
        <strong>${totalCapturas}</strong> documento(s).</p>

        <h3 style="color:#020026;margin-bottom:4px">Captura SEFAZ (XML)</h3>
        <ul>
            <li>Novos XMLs: <strong>${sefaz.novosXmls}</strong></li>
            <li>Execuções do cron: ${sefaz.execucoes}</li>
            <li>Empresas com sucesso: ${sefaz.sucessos} · falhas: ${sefaz.falhas}</li>
        </ul>

        <h3 style="color:#020026;margin-bottom:4px">SharePoint</h3>
        <ul>
            <li>Documentos sincronizados: <strong>${sharepoint.docsSincronizados}</strong></li>
            <li>Execuções: ${sharepoint.execucoes}</li>
            <li>Empresas processadas: ${sharepoint.empresas} · erros: ${sharepoint.erros}</li>
        </ul>

        <p style="color:#888;font-size:12px">Enviado automaticamente pelo Consultor Fiscal Inteligente — não responda.</p>
    `;
}

/**
 * Coleta o resumo e envia o e-mail diario para os destinatarios informados.
 * @param {object} p
 * @param {string} p.remetente  caixa de origem
 * @param {string|string[]} p.destinatarios
 * @param {number} [p.horas]
 */
export async function enviarResumoDiario({ remetente, destinatarios, horas = 24 }) {
    if (!isGraphConfigured()) {
        return { ok: false, error: 'Graph não configurado' };
    }
    const resumo = await coletarResumoCapturas(horas);
    const r = await enviarEmail({
        remetente,
        para: destinatarios,
        assunto: `Resumo diário de capturas — ${resumo.totalCapturas} documento(s)`,
        corpoHtml: montarCorpoResumo(resumo),
    });
    return { ...r, resumo };
}
