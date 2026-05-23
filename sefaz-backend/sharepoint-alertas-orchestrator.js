// ============================================================================
// sefaz-backend/sharepoint-alertas-orchestrator.js
// Frente 3 — Alerta de documento novo no SharePoint.
//
// Varre a pasta "Empresas" recursivamente (raiz -> subpastas de CNPJ -> ...),
// detecta arquivos novos comparando com um baseline no Firestore, e dispara
// um e-mail resumo para os admins.
//
// Baseline: colecao `sharepoint_alertas_state`, doc unico `empresas`.
//   { vistos: [driveItemId, ...], atualizadoEm }
// Primeira execucao: grava baseline e NAO alerta (evita e-mail gigante).
// ============================================================================

import admin from 'firebase-admin';
import * as sharepoint from './sharepoint-provider.js';
import { enviarEmail, isGraphConfigured } from './graph-provider.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

const PASTA_RAIZ = 'Empresas';
const STATE_COLLECTION = 'sharepoint_alertas_state';
const STATE_DOC = 'empresas';
const REMETENTE = process.env.NOTIF_REMETENTE_EMAIL || '';
const MAX_DEPTH = 6;  // profundidade maxima da recursao (trava de seguranca)

/**
 * Varre uma pasta recursivamente e retorna todos os ARQUIVOS encontrados.
 * Pastas viram recursao; arquivos sao coletados.
 */
async function varrerRecursivo(caminho, depth = 0, acc = []) {
    if (depth > MAX_DEPTH) return acc;
    let resp;
    try {
        resp = await sharepoint.listFolderItems(caminho);
    } catch (err) {
        console.warn(`[sharepoint-alertas] falha ao listar "${caminho}": ${err.message}`);
        return acc;
    }
    const itens = (resp && resp.value) || [];
    for (const it of itens) {
        if (it.folder) {
            // subpasta -> desce
            await varrerRecursivo(`${caminho}/${it.name}`, depth + 1, acc);
        } else if (it.file) {
            // arquivo -> coleta
            acc.push({
                id: it.id,
                nome: it.name,
                caminho: caminho,
                modificadoEm: it.lastModifiedDateTime || null,
                tamanho: it.size || 0,
                webUrl: it.webUrl || null,
            });
        }
    }
    return acc;
}

/** Le o baseline de IDs ja vistos. */
async function lerBaseline() {
    const snap = await fa().firestore()
        .collection(STATE_COLLECTION).doc(STATE_DOC).get();
    if (!snap.exists) return null;  // null = primeira execucao
    const data = snap.data() || {};
    return Array.isArray(data.vistos) ? data.vistos : [];
}

/** Grava o baseline com a lista completa de IDs atuais. */
async function gravarBaseline(ids) {
    await fa().firestore()
        .collection(STATE_COLLECTION).doc(STATE_DOC)
        .set({
            vistos: ids,
            atualizadoEm: new Date().toISOString(),
            total: ids.length,
        });
}

/** Monta o corpo HTML do e-mail resumo, agrupando por pasta. */
function montarCorpoResumo(novos) {
    const porPasta = {};
    for (const d of novos) {
        (porPasta[d.caminho] = porPasta[d.caminho] || []).push(d);
    }
    const blocos = Object.entries(porPasta).map(([pasta, docs]) => {
        const linhas = docs.map(d => {
            const link = d.webUrl
                ? `<a href="${d.webUrl}">${d.nome}</a>` : d.nome;
            const dt = d.modificadoEm
                ? new Date(d.modificadoEm).toLocaleString('pt-BR') : '';
            return `<li>${link} <span style="color:#888;font-size:12px">${dt}</span></li>`;
        }).join('');
        return `<h3 style="color:#020026;margin-bottom:4px">${pasta}</h3>
                <ul>${linhas}</ul>`;
    }).join('');

    return `<div style="font-family:Arial,sans-serif;color:#222">
        <h2 style="color:#020026">Novos documentos no SharePoint</h2>
        <p>Foram detectados <strong>${novos.length}</strong> documento(s)
           novo(s) na pasta <strong>${PASTA_RAIZ}</strong> desde a ultima verificacao.</p>
        ${blocos}
        <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
        <p style="color:#888;font-size:12px">
           Alerta automatico do Consultor Fiscal Inteligente — Frente 3.
           Verificacao a cada 6 horas.</p>
    </div>`;
}

/** Busca os e-mails dos usuarios admin. */
async function buscarAdmins() {
    const snap = await fa().firestore().collection('users').get();
    return snap.docs
        .filter(d => (d.data().role || '') === 'admin')
        .map(d => d.data().email)
        .filter(e => typeof e === 'string' && e.includes('@'));
}

/**
 * Fluxo principal: varre -> detecta novos -> alerta admins -> atualiza baseline.
 */
export async function processarAlertasSharePoint() {
    const inicio = Date.now();

    // 1. varre a arvore de Empresas
    const arquivos = await varrerRecursivo(PASTA_RAIZ);
    const idsAtuais = arquivos.map(a => a.id);

    // 2. le baseline
    const baseline = await lerBaseline();

    // 2a. primeira execucao: so grava baseline, nao alerta
    if (baseline === null) {
        await gravarBaseline(idsAtuais);
        return {
            ok: true,
            primeiraExecucao: true,
            totalArquivos: arquivos.length,
            novos: 0,
            duracaoMs: Date.now() - inicio,
        };
    }

    // 3. detecta novos (id que nao estava no baseline)
    const vistosSet = new Set(baseline);
    const novos = arquivos.filter(a => !vistosSet.has(a.id));

    // 4. atualiza baseline sempre (mesmo sem novos)
    await gravarBaseline(idsAtuais);

    if (novos.length === 0) {
        return { ok: true, novos: 0, totalArquivos: arquivos.length,
                 duracaoMs: Date.now() - inicio };
    }

    // 5. envia e-mail pros admins
    if (!isGraphConfigured()) {
        return { ok: false, error: 'Graph nao configurado', novos: novos.length };
    }
    const admins = await buscarAdmins();
    if (admins.length === 0) {
        return { ok: true, aviso: 'nenhum admin com e-mail', novos: novos.length };
    }

    const envio = await enviarEmail({
        remetente: REMETENTE,
        para: admins,
        assunto: `SharePoint — ${novos.length} documento(s) novo(s) em ${PASTA_RAIZ}`,
        corpoHtml: montarCorpoResumo(novos),
    });

    // 6. log no Firestore
    try {
        await fa().firestore().collection('sharepoint_alertas_log').add({
            quando: new Date().toISOString(),
            novos: novos.length,
            totalArquivos: arquivos.length,
            destinatarios: admins,
            envioOk: !!envio.ok,
            envioErro: envio.ok ? null : (envio.error || null),
        });
    } catch (logErr) {
        console.warn('[sharepoint-alertas] log falhou:', logErr.message);
    }

    return {
        ok: !!envio.ok,
        novos: novos.length,
        totalArquivos: arquivos.length,
        destinatarios: admins.length,
        error: envio.ok ? undefined : envio.error,
        duracaoMs: Date.now() - inicio,
    };
}
