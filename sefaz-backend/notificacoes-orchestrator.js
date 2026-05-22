// ============================================================================
// sefaz-backend/notificacoes-orchestrator.js
// Monta o resumo diario de capturas (SEFAZ XML + SharePoint) e dispara
// a notificacao por e-mail via Graph.
//
// MODOS:
//   - GLOBAL (admin): le sefaz_cron_logs + sharepoint_sync_log agregados.
//                     Visao operacional (execucoes, falhas, etc).
//   - CARTEIRA (colab): le documentos_fiscais filtrando por empresaCnpj na
//                       carteira do usuario. Visao do colaborador.
// ============================================================================

import admin from 'firebase-admin';
import { enviarEmail, isGraphConfigured } from './graph-provider.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

// ─── GLOBAL (admin) ─────────────────────────────────────────────────────────

/**
 * Le os logs agregados das ultimas `horas` horas e devolve resumo operacional.
 * Mantida sem alteracao para preservar comportamento atual para admins.
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
        modo: 'global',
        sefaz,
        sharepoint,
        totalCapturas: sefaz.novosXmls + sharepoint.docsSincronizados,
    };
}

// ─── CARTEIRA (colaborador) ─────────────────────────────────────────────────

const normCnpj = (s) => String(s || '').replace(/\D/g, '');

/**
 * Conta documentos novos nas ultimas `horas` horas, filtrados pelos CNPJs
 * da carteira do colaborador. Le direto de documentos_fiscais.
 *
 * @param {number} horas
 * @param {string[]} cnpjsPermitidos
 */
export async function coletarResumoParaCarteira(horas, cnpjsPermitidos) {
    const cnpjs = (cnpjsPermitidos || []).map(normCnpj).filter(c => c.length === 14);
    if (cnpjs.length === 0) {
        return {
            horas,
            modo: 'carteira',
            cnpjsCarteira: 0,
            totalCapturas: 0,
            porTipo: {},
            porEmpresa: {},
        };
    }

    const db = fa().firestore();
    const desde = new Date(Date.now() - horas * 60 * 60 * 1000);
    const cnpjsSet = new Set(cnpjs);

    const porTipo = {};
    const porEmpresa = {};
    const jaContado = new Set();
    let total = 0;

    // documentos_fiscais.createdAt (SEFAZ, NFSe SP, etc)
    try {
        const snap = await db.collection('documentos_fiscais')
            .where('createdAt', '>=', desde)
            .limit(5000)
            .get();
        snap.forEach(d => {
            const x = d.data();
            const cnpj = normCnpj(x.empresaCnpj);
            if (!cnpjsSet.has(cnpj)) return;
            if (jaContado.has(d.id)) return;
            jaContado.add(d.id);
            total++;
            const tipo = x.tipo || 'desconhecido';
            porTipo[tipo] = (porTipo[tipo] || 0) + 1;
            porEmpresa[cnpj] = (porEmpresa[cnpj] || 0) + 1;
        });
    } catch (e) {
        console.warn('[notif/carteira] documentos_fiscais createdAt:', e.message);
    }

    // documentos_fiscais.capturadoEm (NFSe Nacional DFe e qualquer outro
    // importer mais novo que use capturadoEm em vez de createdAt)
    try {
        const snap = await db.collection('documentos_fiscais')
            .where('capturadoEm', '>=', desde)
            .limit(5000)
            .get();
        snap.forEach(d => {
            if (jaContado.has(d.id)) return;
            const x = d.data();
            const cnpj = normCnpj(x.empresaCnpj);
            if (!cnpjsSet.has(cnpj)) return;
            jaContado.add(d.id);
            total++;
            const tipo = x.tipo || 'desconhecido';
            porTipo[tipo] = (porTipo[tipo] || 0) + 1;
            porEmpresa[cnpj] = (porEmpresa[cnpj] || 0) + 1;
        });
    } catch (e) {
        console.warn('[notif/carteira] documentos_fiscais capturadoEm:', e.message);
    }

    return {
        horas,
        modo: 'carteira',
        cnpjsCarteira: cnpjs.length,
        totalCapturas: total,
        porTipo,
        porEmpresa,
    };
}

// ─── Renderizacao ───────────────────────────────────────────────────────────

/** Monta o corpo HTML do e-mail de resumo (admin). */
export function montarCorpoResumo(resumo) {
    if (resumo.modo === 'carteira') return montarCorpoResumoCarteira(resumo);
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

/** Monta o corpo HTML do e-mail de resumo (colaborador, filtrado por carteira). */
export function montarCorpoResumoCarteira(resumo) {
    const { totalCapturas, porTipo, porEmpresa, cnpjsCarteira, horas } = resumo;

    if (cnpjsCarteira === 0) {
        return `
            <h2 style="color:#020026">Resumo diário — sua carteira</h2>
            <p>Você ainda não tem empresas vinculadas à sua carteira. Fale com o admin
            pra que ele te atribua empresas em <em>Carteira de Colaboradores</em>.</p>
            <p style="color:#888;font-size:12px">Enviado automaticamente pelo Consultor Fiscal Inteligente — não responda.</p>
        `;
    }

    const tiposItens = Object.entries(porTipo)
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `<li>${t}: <strong>${n}</strong></li>`)
        .join('');

    // Top 10 empresas com mais capturas — pra não inundar o email
    const topEmpresas = Object.entries(porEmpresa)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([cnpj, n]) => `<li>${formatCnpj(cnpj)}: ${n}</li>`)
        .join('');

    return `
        <h2 style="color:#020026">Resumo diário — sua carteira</h2>
        <p>Nas últimas ${horas} horas, foram capturados
        <strong>${totalCapturas}</strong> documento(s) nas ${cnpjsCarteira} empresa(s) da sua carteira.</p>

        ${tiposItens ? `
        <h3 style="color:#020026;margin-bottom:4px">Por tipo</h3>
        <ul>${tiposItens}</ul>` : ''}

        ${topEmpresas ? `
        <h3 style="color:#020026;margin-bottom:4px">Top empresas</h3>
        <ul>${topEmpresas}</ul>` : ''}

        <p style="color:#888;font-size:12px">Enviado automaticamente pelo Consultor Fiscal Inteligente — não responda.</p>
    `;
}

function formatCnpj(c) {
    const n = normCnpj(c);
    if (n.length !== 14) return c;
    return `${n.slice(0,2)}.${n.slice(2,5)}.${n.slice(5,8)}/${n.slice(8,12)}-${n.slice(12)}`;
}

// ─── Envio em lote (admin + colaborador individualizado) ────────────────────

/**
 * Coleta o resumo e envia o e-mail diario para os destinatarios informados.
 *
 * Comportamento mantido: 1 email com resumo global para varios destinatarios.
 * Usado pela rota manual /enviar-resumo (sem contexto de usuarios).
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

/**
 * NOVO: envia 1 email POR usuario, com resumo filtrado pela carteira dele.
 * Admin recebe resumo global. Colaborador recebe resumo da carteira.
 *
 * @param {object} p
 * @param {string} p.remetente
 * @param {Array<{email,uid,role,nome?}>} p.usuarios
 * @param {number} [p.horas]
 */
export async function enviarResumoIndividualizado({ remetente, usuarios, horas = 24 }) {
    if (!isGraphConfigured()) {
        return { ok: false, error: 'Graph não configurado' };
    }
    if (!Array.isArray(usuarios) || usuarios.length === 0) {
        return { ok: true, enviados: 0, falhas: 0, aviso: 'sem usuarios' };
    }

    const db = fa().firestore();
    const resumoGlobal = await coletarResumoCapturas(horas); // 1x; admins compartilham
    let enviados = 0, falhas = 0;
    const detalhes = [];

    for (const u of usuarios) {
        if (!u?.email || !u.email.includes('@')) { falhas++; continue; }

        let resumo;
        if (u.role === 'admin') {
            resumo = resumoGlobal;
        } else {
            // Busca CNPJs da carteira do colaborador
            let cnpjsCarteira = [];
            try {
                const snap = await db.collection('carteiras')
                    .where('colaboradorUid', '==', u.uid)
                    .get();
                cnpjsCarteira = snap.docs.map(d => d.data().empresaCnpj || '');
            } catch (e) {
                console.warn(`[notif/individual] carteira de ${u.email}:`, e.message);
            }
            resumo = await coletarResumoParaCarteira(horas, cnpjsCarteira);
        }

        try {
            const r = await enviarEmail({
                remetente,
                para: u.email,
                assunto: `Resumo diário de capturas — ${resumo.totalCapturas} documento(s)`,
                corpoHtml: montarCorpoResumo(resumo),
            });
            if (r.ok) {
                enviados++;
                detalhes.push({ email: u.email, modo: resumo.modo, total: resumo.totalCapturas });
            } else {
                falhas++;
                detalhes.push({ email: u.email, erro: r.error });
            }
        } catch (e) {
            falhas++;
            detalhes.push({ email: u.email, erro: e.message });
        }
    }

    return { ok: true, enviados, falhas, total: usuarios.length, detalhes };
}
