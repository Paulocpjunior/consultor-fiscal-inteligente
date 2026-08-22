// ============================================================================
// sefaz-backend/envio-imposto.js  (ESM)
// ----------------------------------------------------------------------------
// ORDEM TÉCNICA do envio de imposto ao cliente (Paulo, 24/07/2026) — todo
// imposto/guia/obrigação enviada pelo app segue o mesmo rito:
//
//   1. CÓPIA NO SHAREPOINT — pasta do cliente no padrão já existente do
//      sync/arquivo, sub-pasta IMPOSTOS do período:
//        Empresas/{grupo}/DEPARTAMENTO FISCAL/{ano}/{mês}-{ano}/{empresaPasta}/IMPOSTOS
//      (empresaPasta = "CNPJ NOME" configurada em sharePointConfig; empresa
//      sem config não bloqueia o envio — o gap aparece no resultado).
//   2. CÓPIA AUTOMÁTICA AO GESTOR — alexandre@spassessoriacontabil.com.br em
//      TODO envio (BCC no Graph; CC no mailto do colaborador).
//   3. BAIXA NA ABA DE VENCIMENTOS E OBRIGAÇÕES — o reverso da pendência: a
//      tarefa da obrigação correspondente (empresa + competência) vira
//      'concluida'. As obrigações mensais são zeradas todo mês pelo cron de
//      tarefas (novas tarefas por competência) — o ciclo recomeça sozinho.
//   4. AUDITORIA — coleção impostos_enviados (o quê, pra quem, quem enviou,
//      o que o rito conseguiu fazer).
//
// Helpers de montagem são PUROS (testáveis); executarRitoEnvioImposto é o
// orquestrador com I/O (Firestore + proxy SharePoint).
// ============================================================================

import admin from 'firebase-admin';
import { normalizarCompetencia, competenciaTarefa } from './competencia.js';

export const GESTOR_EMAIL = process.env.ENVIO_IMPOSTO_GESTOR
    || 'alexandre@spassessoriacontabil.com.br';

const PROXY_URL = process.env.SHAREPOINT_PROXY_URL
    || 'https://consultor-fiscal-proxy-631239634290.us-west1.run.app';
const PROXY_TOKEN = process.env.SHAREPOINT_PROXY_TOKEN || process.env.PROXY_SHARED_TOKEN || '';

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

// ─── Helpers puros ──────────────────────────────────────────────────────────

/**
 * Normaliza competência pra 'AAAA-MM' — RE-EXPORTADO do dono único.
 *
 * 🚨 Esta função era uma SEGUNDA cópia: ela recusava `AAAA-MM-DD` (a forma que
 * a ficha financeira usa conforme a época do lançamento) enquanto a cópia do
 * `ipi-varredura` recusava `AAAAMM`. Cada uma devolvia null para a forma que a
 * outra entendia — e null aqui não falha, some.
 */
export { normalizarCompetencia };

/** Competência no formato da coleção tarefas ('MM/AAAA') — dono único. */
export { competenciaTarefa };


/**
 * Pasta IMPOSTOS do período no SharePoint — MESMA árvore do sync/arquivo de
 * XMLs (buildFolderPathArquivo), trocando a folha por IMPOSTOS.
 */
export function buildFolderPathImpostos(grupo, empresaPasta, competencia) {
    const n = normalizarCompetencia(competencia);
    if (!grupo || !empresaPasta || !n) return null;
    const [ano, mes] = n.split('-');
    return `Empresas/${grupo}/DEPARTAMENTO FISCAL/${ano}/${mes}-${ano}/${empresaPasta}/IMPOSTOS`;
}

/**
 * Tipo de imposto/guia → obrigação da coleção tarefas (a pendência que o
 * cron mensal cria e que o envio dá BAIXA). Tipo sem tarefa mensal → null
 * (o rito registra 'sem-tarefa' e segue — não é erro).
 */
export function obrigacaoDoTipo(tipo) {
    const t = String(tipo || '').toUpperCase();
    if (t === 'DAS') return 'DAS';
    if (t === 'DARF' || t === 'DCTFWEB') return 'DCTFWEB';
    if (t === 'FGTS') return 'FGTS';
    if (t === 'SPED') return 'SPED';
    return null;
}

/**
 * Monta o link mailto: do envio pelo e-mail padrão do colaborador — SEMPRE
 * com o gestor em cópia (regra 2 da ordem técnica).
 */
export function montarMailtoEnvio({ para, assunto, corpo, cc }) {
    const dest = String(para || '').trim();
    const listaCc = [...new Set([GESTOR_EMAIL, ...(Array.isArray(cc) ? cc : [])]
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e && e !== dest.toLowerCase()))];
    const qs = new URLSearchParams();
    if (listaCc.length) qs.set('cc', listaCc.join(','));
    if (assunto) qs.set('subject', assunto);
    if (corpo) qs.set('body', corpo);
    const query = qs.toString().replace(/\+/g, '%20');
    return `mailto:${encodeURIComponent(dest)}${query ? `?${query}` : ''}`;
}

function limparBase64(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.includes(',') ? (raw.split(',').pop() || '').replace(/\s/g, '') : raw.replace(/\s/g, '');
}

// ─── I/O ────────────────────────────────────────────────────────────────────

async function uploadProxy(folderPath, filename, contentBase64, mimeType) {
    const resp = await fetch(`${PROXY_URL}/api/sharepoint/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(PROXY_TOKEN ? { Authorization: `Bearer ${PROXY_TOKEN}` } : {}) },
        body: JSON.stringify({ folderPath, filename, contentBase64, mimeType }),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Proxy upload ${resp.status}`);
    }
    return resp.json();
}

// Resolve a empresa (por id OU por CNPJ) nas duas coleções, pulando zumbis.
async function resolverEmpresa(db, { empresaId, empresaCnpj }) {
    const cnpjAlvo = String(empresaCnpj || '').replace(/\D/g, '');
    for (const col of ['simples_empresas', 'lucro_empresas']) {
        if (empresaId) {
            const doc = await db.collection(col).doc(empresaId).get();
            if (doc.exists) {
                const d = doc.data();
                if (!d._merged_into && !d._deleted) return { id: doc.id, col, data: d };
            }
        }
    }
    if (!cnpjAlvo) return null;
    for (const col of ['simples_empresas', 'lucro_empresas']) {
        const snap = await db.collection(col).get();
        for (const doc of snap.docs) {
            const d = doc.data();
            if (d._merged_into || d._deleted) continue;
            if (String(d.cnpj || '').replace(/\D/g, '') === cnpjAlvo) {
                return { id: doc.id, col, data: d };
            }
        }
    }
    return null;
}

/**
 * Executa a ORDEM TÉCNICA completa de um envio de imposto. Nunca lança por
 * falha parcial — cada etapa reporta o que conseguiu (farol honesto no
 * resultado); o chamador decide o que mostrar.
 *
 * @param {object} p
 * @param {string} [p.empresaId]
 * @param {string} p.empresaCnpj
 * @param {string} p.empresaNome
 * @param {string} p.tipo         'DAS' | 'DARF' | 'DCTFWEB' | 'DARE' | 'FGTS' | 'SPED' | ...
 * @param {string} p.competencia  'AAAA-MM' | 'MM/AAAA'
 * @param {string} [p.canal]      'email-graph' (servidor) | 'email-app' (mailto) | 'whatsapp'
 * @param {string} [p.para]       destinatário
 * @param {string[]} [p.copiaPara]
 * @param {string} [p.pdfBase64]  arquivo enviado (cópia pro SharePoint)
 * @param {string} [p.pdfFileName]
 * @param {string} [p.enviadoPor] e-mail/uid do colaborador
 * @param {number} [p.valor]
 */
export async function executarRitoEnvioImposto(p) {
    const db = getDb();
    const resultado = {
        sharePoint: { status: 'sem-pdf' },
        baixa: { status: 'sem-tarefa' },
        logId: null,
    };

    const empresa = await resolverEmpresa(db, { empresaId: p.empresaId, empresaCnpj: p.empresaCnpj });

    // 1. Cópia no SharePoint (pasta IMPOSTOS do período do cliente).
    const pdf = limparBase64(p.pdfBase64);
    if (pdf) {
        const cfg = empresa?.data?.sharePointConfig;
        const folder = cfg ? buildFolderPathImpostos(cfg.grupo, cfg.empresaPasta, p.competencia) : null;
        if (!folder) {
            resultado.sharePoint = {
                status: 'sem-config',
                motivo: 'Empresa sem sharePointConfig (grupo + pasta) — preencha na Central de XMLs → Integrações → SharePoint.',
            };
        } else {
            const nome = p.pdfFileName
                || `${String(p.tipo || 'imposto').toLowerCase()}_${String(p.empresaCnpj).replace(/\D/g, '')}_${normalizarCompetencia(p.competencia) || 'competencia'}.pdf`;
            try {
                await uploadProxy(folder, nome, pdf, 'application/pdf');
                resultado.sharePoint = { status: 'arquivado', folder, filename: nome };
            } catch (e) {
                resultado.sharePoint = { status: 'erro', motivo: e.message, folder };
            }
        }
    }

    // 2. Baixa da obrigação na aba Vencimentos e Obrigações (reverso da
    //    pendência do cron mensal). Sem tarefa correspondente → segue em paz.
    const obrigacao = obrigacaoDoTipo(p.tipo);
    const compTarefa = competenciaTarefa(p.competencia);
    if (obrigacao && compTarefa) {
        try {
            const snap = await db.collection('tarefas')
                .where('obrigacao', '==', obrigacao)
                .where('competencia', '==', compTarefa)
                .get();
            const cnpjAlvo = String(p.empresaCnpj || '').replace(/\D/g, '');
            const alvos = snap.docs.filter((d) => {
                const t = d.data();
                if (t.status === 'concluida' || t.status === 'cancelada') return false;
                if (p.empresaId && t.empresaId === p.empresaId) return true;
                if (empresa && t.empresaId === empresa.id) return true;
                return cnpjAlvo && String(t.empresaCnpj || '').replace(/\D/g, '') === cnpjAlvo;
            });
            for (const d of alvos) {
                await d.ref.update({
                    status: 'concluida',
                    concluidaEm: admin.firestore.FieldValue.serverTimestamp(),
                    concluidaPor: p.enviadoPor || 'envio-imposto',
                    baixaOrigem: 'envio-imposto',
                    baixaCanal: p.canal || null,
                });
            }
            resultado.baixa = alvos.length > 0
                ? { status: 'baixada', obrigacao, competencia: compTarefa, tarefas: alvos.length }
                : {
                    status: 'sem-tarefa', obrigacao, competencia: compTarefa,
                    motivo: 'Nenhuma tarefa pendente desta obrigação/competência (já concluída ou ainda não gerada pelo cron).',
                };
        } catch (e) {
            resultado.baixa = { status: 'erro', motivo: e.message, obrigacao, competencia: compTarefa };
        }
    } else if (!obrigacao) {
        resultado.baixa = { status: 'sem-tarefa', motivo: `Tipo ${p.tipo} não tem obrigação mensal correspondente na aba de tarefas.` };
    }

    // 3. Auditoria central.
    try {
        const ref = await db.collection('impostos_enviados').add({
            empresaId: empresa?.id || p.empresaId || null,
            empresaCnpj: String(p.empresaCnpj || '').replace(/\D/g, ''),
            empresaNome: p.empresaNome || empresa?.data?.razaoSocial || empresa?.data?.nome || '',
            tipo: String(p.tipo || '').toUpperCase(),
            competencia: normalizarCompetencia(p.competencia),
            canal: p.canal || null,
            para: p.para || null,
            copiaPara: [...new Set([GESTOR_EMAIL, ...(p.copiaPara || [])])],
            valor: Number.isFinite(Number(p.valor)) ? Number(p.valor) : null,
            // 🚨 A COMPOSIÇÃO DA GUIA — é o que permite barrar o SEGUNDO envio do
            // mesmo débito (Paulo, 17/08, depois do caso HYPE). Sem isto a
            // auditoria sabe que "um DARF foi enviado" e não sabe O QUE ele
            // cobrava, então dois departamentos cobram o mesmo código sem que
            // nada acuse. Débito é a unidade, não a guia.
            debitos: Array.isArray(p.debitos)
                ? p.debitos.map((d) => ({
                    codigo: String(d?.codigo || d?.codReceita || '').replace(/\D/g, ''),
                    extensao: String(d?.extensao ?? '').replace(/\D/g, '') || null,
                    descricao: String(d?.descricao || '').trim() || null,
                    valor: Number.isFinite(Number(d?.valor)) ? Number(d.valor) : null,
                    departamento: d?.departamento || null,
                })).filter((d) => d.codigo)
                : null,
            // Reenvio proposital: o motivo fica gravado com quem seguiu. Trava
            // sem caminho é trava que a equipe contorna (T3 da DCTFWeb, 12/08).
            reenvioMotivo: String(p.reenvioMotivo || '').trim() || null,
            anexouPdf: Boolean(pdf),
            // Canal whatsapp-api: o id que a Meta devolveu é o COMPROVANTE de
            // envio (equivalente ao Graph 202 do e-mail) — fica na auditoria.
            whatsappMessageId: p.whatsappMessageId || null,
            sharePoint: resultado.sharePoint,
            baixa: resultado.baixa,
            enviadoPor: p.enviadoPor || null,
            enviadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
        resultado.logId = ref.id;
    } catch (e) {
        console.warn('[envio-imposto] rito OK, auditoria falhou:', e.message);
    }

    return resultado;
}
