// ============================================================================
// sefaz-backend/legalizacao-orchestrator.js
// Módulo Legalização — orquestração com I/O:
//   1. sincronizarJotform()  — importa os formulários do departamento
//      (certidões/certificados e parcelamentos) pra `legalizacao_vencimentos`.
//   2. processarAlertasLegalizacao() — analisa vencimentos (Jotform +
//      processos manuais com vencimento, ex. procurações) e envia alerta
//      antecipado ao cliente por e-mail (Graph), com gestor em BCC.
//   3. executarCronLegalizacao() — sync + alertas + log em
//      `legalizacao_cron_logs` (farol honesto: contadores + motivo dominante).
//
// Idempotência dos alertas: doc `legalizacao_alertas/{itemId}_{faixa}` —
// cada item alerta UMA vez por faixa (30/15/7/3/1/0/vencido).
// ============================================================================

import admin from 'firebase-admin';
import { isJotformConfigured, listarSubmissions } from './jotform-provider.js';
import {
    normalizarLote,
    normalizarSubmissionCertidao,
    normalizarSubmissionParcelamento,
} from './legalizacao-normalizer.js';
import {
    classificarVencimento,
    faixaAlertaDevida,
    montarEmailAlerta,
    resumirPorFarol,
    CATEGORIA_LABEL,
    fmtDataBr,
} from './legalizacao-helper.js';
import { diffDiasBrt } from './vencimentos-orchestrator.js';
import { isGraphConfigured, enviarEmail } from './graph-provider.js';
import { fetchAllDocs } from './firestore-paginate.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

// Formulários do departamento (IDs reais da conta Jotform da SP; override por env).
export const FORM_CERTIDOES = process.env.JOTFORM_FORM_CERTIDOES || '203618343863862';
export const FORM_PARCELAMENTOS = process.env.JOTFORM_FORM_PARCELAMENTOS || '210087778597674';

const REMETENTE_DEFAULT = process.env.GRAPH_REMETENTE || 'contabil@spassessoriacontabil.com.br';
// Gestor do departamento SEMPRE em cópia oculta nos alertas ao cliente
// (mesmo pacto do rito de envio de imposto).
const GESTOR_EMAIL = process.env.LEGALIZACAO_GESTOR_EMAIL || 'alexandre@spassessoriacontabil.com.br';

const COL_VENCIMENTOS = 'legalizacao_vencimentos';
const COL_PROCESSOS = 'legalizacao_processos';
const COL_ALERTAS = 'legalizacao_alertas';
const COL_LOGS = 'legalizacao_cron_logs';
const COL_META = 'legalizacao_meta';

async function gravarEmLotes(db, colecao, docsMap) {
    const entradas = [...docsMap.entries()];
    const agora = admin.firestore.FieldValue.serverTimestamp();
    for (let i = 0; i < entradas.length; i += 400) {
        const batch = db.batch();
        for (const [id, doc] of entradas.slice(i, i + 400)) {
            batch.set(db.collection(colecao).doc(id), { ...doc, atualizadoEm: agora }, { merge: true });
        }
        await batch.commit();
    }
    return entradas.length;
}

/**
 * Importa os dois formulários do Jotform pra `legalizacao_vencimentos`.
 * Full sync idempotente (docId = jf_{submissionId}); nunca duplica.
 */
export async function sincronizarJotform({ disparadoPor = 'cron' } = {}) {
    if (!isJotformConfigured()) {
        return { ok: false, motivo: 'JOTFORM_API_KEY não configurada — cadastre o secret no Cloud Run e redeploye', gravados: 0 };
    }
    const db = fa().firestore();
    const resultado = { ok: true, gravados: 0, ignorados: 0, porForm: {}, erros: [] };

    const forms = [
        { id: FORM_CERTIDOES, nome: 'certidoes-certificados', normalizar: normalizarSubmissionCertidao },
        { id: FORM_PARCELAMENTOS, nome: 'parcelamentos', normalizar: normalizarSubmissionParcelamento },
    ];
    for (const form of forms) {
        try {
            const subs = await listarSubmissions(form.id);
            const { docs, ignorados } = normalizarLote(subs, form.normalizar);
            const gravados = await gravarEmLotes(db, COL_VENCIMENTOS, docs);
            resultado.gravados += gravados;
            resultado.ignorados += ignorados;
            resultado.porForm[form.nome] = { submissions: subs.length, gravados, ignorados };
        } catch (e) {
            resultado.erros.push(`${form.nome}: ${e.message}`);
        }
    }
    // Sync que não gravou NADA e só tem erro não é sucesso (farol honesto).
    if (resultado.gravados === 0 && resultado.erros.length > 0) resultado.ok = false;

    await db.collection(COL_META).doc('sync').set({
        ultimaSyncEm: admin.firestore.FieldValue.serverTimestamp(),
        disparadoPor,
        ...resultado,
    }, { merge: false }).catch(e => console.error('[legalizacao] meta sync:', e.message));

    return resultado;
}

/** Itens alertáveis: vencimentos do Jotform + processos manuais com vencimento em aberto. */
async function carregarItensAlertaveis(db) {
    const itens = [];
    const vencSnap = await fetchAllDocs(db.collection(COL_VENCIMENTOS), { label: COL_VENCIMENTOS });
    for (const d of vencSnap) {
        itens.push({ id: d.id, ...d.data() });
    }
    const procSnap = await fetchAllDocs(db.collection(COL_PROCESSOS), { label: COL_PROCESSOS });
    for (const d of procSnap) {
        const p = d.data();
        if (!p.dataVencimento) continue;
        if (['concluido', 'cancelado'].includes(p.status)) continue;
        itens.push({
            id: d.id,
            categoria: p.tipo === 'procuracao' ? 'procuracao' : (p.tipo === 'certificado_digital' ? 'certificado' : p.tipo === 'certidao' ? 'certidao' : 'processo'),
            tipoDetalhe: p.titulo || CATEGORIA_LABEL[p.tipo] || p.tipo || 'Processo',
            empresaNome: p.empresaNome || '—',
            cnpj: p.cnpj || null,
            emailCliente: p.emailCliente || null,
            dataVencimento: p.dataVencimento,
            origem: 'processo',
        });
    }
    return itens;
}

async function enviarComTimeout(p, ms = 8000) {
    return Promise.race([
        enviarEmail(p),
        new Promise(resolve => setTimeout(() => resolve({ ok: false, error: `timeout ${ms}ms` }), ms)),
    ]);
}

/**
 * Varre os itens, decide faixa de alerta devida e envia e-mail ao cliente.
 * @returns log com contadores + motivo dominante de falha (farol honesto).
 */
export async function processarAlertasLegalizacao({ disparadoPor = 'cron', force = false } = {}) {
    const db = fa().firestore();
    const log = {
        disparadoPor, examinados: 0, alertasDevidos: 0, emailsEnviados: 0,
        semEmailCliente: 0, jaAlertados: 0, falhasEmail: 0, motivos: {},
    };
    if (!isGraphConfigured()) {
        log.motivoDominante = 'Graph não configurado (GRAPH_CLIENT_ID/TENANT_ID/SECRET) — nenhum e-mail enviado';
        return log;
    }

    const itens = await carregarItensAlertaveis(db);
    log.examinados = itens.length;

    for (const item of itens) {
        if (!item.dataVencimento) continue;
        const dias = diffDiasBrt(item.dataVencimento);
        const faixa = faixaAlertaDevida(dias);
        if (faixa === null) continue;
        log.alertasDevidos++;

        const alertaId = `${item.id}_${faixa}`;
        const alertaRef = db.collection(COL_ALERTAS).doc(alertaId);
        if (!force && (await alertaRef.get()).exists) { log.jaAlertados++; continue; }

        if (!item.emailCliente) {
            log.semEmailCliente++;
            // Registra mesmo sem e-mail: o painel mostra o gap de cadastro e o
            // digest ao gestor cobre o aviso — sem isso o item sumiria mudo.
            await alertaRef.set({
                itemId: item.id, faixa, categoria: item.categoria, empresaNome: item.empresaNome,
                cnpj: item.cnpj || null, dataVencimento: item.dataVencimento, diasRestantes: dias,
                emailCliente: null, emailOk: false, emailErro: 'Cliente sem e-mail cadastrado no formulário',
                criadoEm: admin.firestore.FieldValue.serverTimestamp(),
            });
            continue;
        }

        const { assunto, corpoHtml } = montarEmailAlerta({
            categoria: item.categoria, tipoDetalhe: item.tipoDetalhe, empresaNome: item.empresaNome,
            cnpj: item.cnpj, dataVencimento: item.dataVencimento, diasRestantes: dias,
        });
        const r = await enviarComTimeout({
            remetente: REMETENTE_DEFAULT, para: item.emailCliente, bcc: GESTOR_EMAIL, assunto, corpoHtml,
        });
        if (r.ok) log.emailsEnviados++;
        else {
            log.falhasEmail++;
            const motivo = String(r.error || 'erro desconhecido').slice(0, 120);
            log.motivos[motivo] = (log.motivos[motivo] || 0) + 1;
        }
        await alertaRef.set({
            itemId: item.id, faixa, categoria: item.categoria, empresaNome: item.empresaNome,
            cnpj: item.cnpj || null, dataVencimento: item.dataVencimento, diasRestantes: dias,
            emailCliente: item.emailCliente, emailOk: r.ok, emailErro: r.ok ? null : String(r.error || ''),
            criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    if (log.falhasEmail > 0) {
        log.motivoDominante = Object.entries(log.motivos).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    }
    return log;
}

/** Cron diário: sync Jotform + alertas + log persistido. */
export async function executarCronLegalizacao({ disparadoPor = 'cron-scheduler', force = false } = {}) {
    const db = fa().firestore();
    const inicio = Date.now();
    const sync = await sincronizarJotform({ disparadoPor });
    const alertas = await processarAlertasLegalizacao({ disparadoPor, force });
    const registro = {
        disparadoPor, force, duracaoMs: Date.now() - inicio,
        sync, alertas,
        // all-failed nunca é verde: ok exige sync sem erro fatal E zero falha de e-mail.
        ok: sync.ok !== false && alertas.falhasEmail === 0,
        motivoDominante: sync.ok === false ? (sync.motivo || sync.erros?.[0] || null) : (alertas.motivoDominante || null),
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection(COL_LOGS).add(registro).catch(e => console.error('[legalizacao] log cron:', e.message));
    return registro;
}

/** Resumo pro painel: contadores por categoria × farol + última sync/cron. */
export async function resumoLegalizacao() {
    const db = fa().firestore();
    const itens = await carregarItensAlertaveis(db);
    const comDias = itens.map(it => ({
        ...it,
        diasRestantes: it.dataVencimento ? diffDiasBrt(it.dataVencimento) : null,
    }));
    const farol = resumirPorFarol(comDias);

    const meta = await db.collection(COL_META).doc('sync').get();
    const ultimoLogSnap = await db.collection(COL_LOGS).orderBy('criadoEm', 'desc').limit(1).get();
    const ultimoLog = ultimoLogSnap.empty ? null : ultimoLogSnap.docs[0].data();

    const proximos = comDias
        .filter(it => it.diasRestantes !== null && it.diasRestantes >= -7 && it.diasRestantes <= 30)
        .sort((a, b) => a.diasRestantes - b.diasRestantes)
        .slice(0, 20)
        .map(it => ({
            id: it.id, categoria: it.categoria, tipoDetalhe: it.tipoDetalhe || null,
            empresaNome: it.empresaNome, cnpj: it.cnpj || null,
            dataVencimento: it.dataVencimento, dataVencimentoFmt: fmtDataBr(it.dataVencimento),
            diasRestantes: it.diasRestantes, nivel: classificarVencimento(it.diasRestantes),
        }));

    return {
        totalItens: itens.length,
        farol,
        proximos,
        jotformConfigured: isJotformConfigured(),
        graphConfigured: isGraphConfigured(),
        ultimaSync: meta.exists ? {
            em: meta.data().ultimaSyncEm?.toDate?.()?.toISOString() || null,
            gravados: meta.data().gravados ?? null,
            erros: meta.data().erros || [],
            ok: meta.data().ok !== false,
        } : null,
        ultimoCron: ultimoLog ? {
            em: ultimoLog.criadoEm?.toDate?.()?.toISOString() || null,
            ok: ultimoLog.ok === true,
            motivoDominante: ultimoLog.motivoDominante || null,
            emailsEnviados: ultimoLog.alertas?.emailsEnviados ?? 0,
            falhasEmail: ultimoLog.alertas?.falhasEmail ?? 0,
        } : null,
    };
}
