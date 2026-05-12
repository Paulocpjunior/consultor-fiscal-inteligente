// ============================================================================
// sefaz-backend/sharepoint-sync-orchestrator.js
// Orquestrador que sincroniza documentos_fiscais (Firestore + Storage)
// pro SharePoint, organizado por /Empresas/{CNPJ}/XMLs/{YYYY-MM}/.
//
// Idempotente: marca sharepointSyncAt + sharepointUrl no doc Firestore.
// Re-execucoes nao re-uploadam o que ja foi sincronizado.
// ============================================================================

import admin from 'firebase-admin';
import * as sharepoint from './sharepoint-provider.js';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'consultorfiscalapp';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.appspot.com`;

// Lazy init — segue padrao dos outros orchestrators do projeto.
function ensureAdmin() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
}
function getDb() { ensureAdmin(); return admin.firestore(); }
function getStorage() { ensureAdmin(); return admin.storage(); }

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extrai periodo YYYY-MM de um documento_fiscal.
 * Tenta competencia (NFSe), depois dhEmi (NFe).
 */
function extrairPeriodo(doc) {
    // 1. competencia ISO: '2026-04' ou '2026-04-...'
    if (doc.competencia && /^\d{4}-\d{2}/.test(doc.competencia)) {
        return doc.competencia.slice(0, 7);
    }
    // 2. competencia BR curta: '3/2026' ou '03/2026'
    if (doc.competencia) {
        const mc = String(doc.competencia).match(/^(\d{1,2})\/(\d{4})$/);
        if (mc) return `${mc[2]}-${mc[1].padStart(2, '0')}`;
    }
    // 3. dhEmi ISO: '2026-04-15T10:30:00-03:00'
    if (doc.dhEmi) {
        const m1 = String(doc.dhEmi).match(/^(\d{4})-(\d{2})/);
        if (m1) return `${m1[1]}-${m1[2]}`;
        // 4. dhEmi BR: '30/03/2026 12:58:14'
        const m2 = String(doc.dhEmi).match(/^\d{1,2}\/(\d{1,2})\/(\d{4})/);
        if (m2) return `${m2[2]}-${m2[1].padStart(2, '0')}`;
    }
    return null;
}

/**
 * Constroi nome do arquivo no SharePoint.
 * NFe: chave-44digitos.xml
 * NFSe: nfsesp-num-codverif.xml
 */
function buildFileName(doc) {
    if (doc.chave && /^\d{44}$/.test(doc.chave)) {
        return `${doc.chave}.xml`;
    }
    if (doc.tipoDoc === 'NFSe' && doc.numero) {
        const verif = doc.codigoVerificacao ? `-${doc.codigoVerificacao}` : '';
        return `NFSe-${doc.numero}${verif}.xml`;
    }
    // fallback
    return `${doc.id || doc.chave || 'doc'}.xml`;
}

/**
 * Baixa XML do Storage.
 * @returns {string|null} conteudo XML (UTF-8) ou null se nao existir
 */
async function baixarXmlDoStorage(storagePath) {
    if (!storagePath) return null;
    try {
        const bucket = getStorage().bucket(STORAGE_BUCKET);
        const file = bucket.file(storagePath);
        const [exists] = await file.exists();
        if (!exists) return null;
        const [buf] = await file.download();
        return buf.toString('utf-8');
    } catch (err) {
        console.error(`[sync] erro baixando ${storagePath}:`, err.message);
        return null;
    }
}

// ── API publica ────────────────────────────────────────────────────────────

/**
 * Sincroniza todos os XMLs de uma empresa+periodo.
 * @param {object} opts { cnpj, periodo: 'YYYY-MM', force: bool, dryRun: bool }
 * @returns {object} estatisticas { total, sincronizados, jaSincronizados, semXml, erros }
 */
export async function syncEmpresaPeriodo({ cnpj, periodo, force = false, dryRun = false } = {}) {
    if (!cnpj) throw new Error('cnpj obrigatorio');
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
        throw new Error('periodo obrigatorio formato YYYY-MM');
    }

    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const stats = {
        cnpj: cnpjLimpo,
        periodo,
        total: 0,
        sincronizados: 0,
        jaSincronizados: 0,
        semXml: 0,
        erros: 0,
        detalhes: [],
        dryRun,
        startedAt: new Date().toISOString(),
    };

    // 1. Busca documentos_fiscais filtrados por empresa
    // (Firestore nao suporta startsWith, entao filtra por mes inteiro depois)
    const snap = await getDb().collection('documentos_fiscais')
        .where('empresaCnpj', '==', cnpjLimpo)
        .get();

    if (snap.empty) {
        stats.message = 'Nenhum documento_fiscal encontrado pra essa empresa';
        return stats;
    }

    // 2. Filtra por periodo
    const docs = [];
    snap.forEach(s => {
        const d = s.data();
        const p = extrairPeriodo(d);
        if (p === periodo) {
            docs.push({ ref: s.ref, data: d });
        }
    });

    stats.total = docs.length;

    if (dryRun) {
        stats.message = `Dry run: ${docs.length} documentos seriam sincronizados`;
        stats.detalhes = docs.map(({ data }) => ({
            id: data.id,
            chave: data.chave,
            fileName: buildFileName(data),
            jaSincronizado: !!data.sharepointSyncAt,
        }));
        return stats;
    }

    // 3. Pra cada documento, decide se sincroniza
    for (const { ref, data } of docs) {
        const fileName = buildFileName(data);

        // 3a. Skip se ja sincronizado (a menos que force=true)
        if (!force && data.sharepointSyncAt && data.sharepointUrl) {
            stats.jaSincronizados++;
            stats.detalhes.push({
                fileName, status: 'ja_sincronizado',
                url: data.sharepointUrl,
            });
            continue;
        }

        // 3b. Baixa XML do Storage
        const xmlContent = await baixarXmlDoStorage(data.storagePath);
        if (!xmlContent) {
            stats.semXml++;
            stats.detalhes.push({
                fileName, status: 'sem_xml_no_storage',
                storagePath: data.storagePath,
            });
            continue;
        }

        // 3c. Upload pro SharePoint
        try {
            const result = await sharepoint.uploadXmlParaEmpresa(
                cnpjLimpo, periodo, fileName, xmlContent
            );

            // 3d. Marca sync no Firestore
            await ref.update({
                sharepointSyncAt: admin.firestore.FieldValue.serverTimestamp(),
                sharepointUrl: result.url,
                sharepointFileName: fileName,
            });

            stats.sincronizados++;
            stats.detalhes.push({
                fileName, status: 'sincronizado',
                url: result.url,
                alreadyExisted: result.alreadyExisted,
            });
        } catch (err) {
            stats.erros++;
            stats.detalhes.push({
                fileName, status: 'erro', error: err.message,
            });
            console.error(`[sync] erro upload ${fileName}:`, err.message);
        }
    }

    stats.finishedAt = new Date().toISOString();
    return stats;
}

/**
 * Sincroniza TODAS as empresas (simples + lucro) pra um periodo.
 * Usado pelo cron noturno.
 * @param {object} opts { periodo, maxEmpresas, force, dryRun }
 */
export async function syncAllEmpresas({ periodo, maxEmpresas = null, force = false, dryRun = false } = {}) {
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
        throw new Error('periodo obrigatorio formato YYYY-MM');
    }

    const runStats = {
        periodo,
        empresasProcessadas: 0,
        empresasComErro: 0,
        totalDocsSincronizados: 0,
        totalDocsJaSincronizados: 0,
        totalDocsSemXml: 0,
        totalDocsErros: 0,
        empresas: [],
        startedAt: new Date().toISOString(),
        dryRun,
    };

    // 1. Coleta CNPJs de todas as empresas
    const cnpjs = new Set();
    const empresasInfo = new Map();  // cnpj -> { id, nome, regime }

    for (const colecao of ['simples_empresas', 'lucro_empresas']) {
        const snap = await getDb().collection(colecao).get();
        snap.forEach(s => {
            const d = s.data();
            const cnpj = (d.cnpj || '').replace(/\D/g, '');
            if (cnpj && cnpj.length === 14) {
                cnpjs.add(cnpj);
                empresasInfo.set(cnpj, {
                    id: s.id, nome: d.nome || d.razaoSocial || '',
                    regime: colecao === 'simples_empresas' ? 'simples' : 'lucro',
                });
            }
        });
    }

    let lista = Array.from(cnpjs);
    if (maxEmpresas) lista = lista.slice(0, maxEmpresas);

    // 2. Pra cada empresa, sincroniza periodo
    for (const cnpj of lista) {
        try {
            const stats = await syncEmpresaPeriodo({ cnpj, periodo, force, dryRun });
            runStats.empresasProcessadas++;
            runStats.totalDocsSincronizados += stats.sincronizados;
            runStats.totalDocsJaSincronizados += stats.jaSincronizados;
            runStats.totalDocsSemXml += stats.semXml;
            runStats.totalDocsErros += stats.erros;
            runStats.empresas.push({
                cnpj,
                nome: empresasInfo.get(cnpj)?.nome || '',
                regime: empresasInfo.get(cnpj)?.regime || '',
                total: stats.total,
                sincronizados: stats.sincronizados,
                jaSincronizados: stats.jaSincronizados,
                semXml: stats.semXml,
                erros: stats.erros,
            });
        } catch (err) {
            runStats.empresasComErro++;
            runStats.empresas.push({
                cnpj,
                nome: empresasInfo.get(cnpj)?.nome || '',
                erro: err.message,
            });
            console.error(`[syncAll] empresa ${cnpj}:`, err.message);
        }
    }

    runStats.finishedAt = new Date().toISOString();

    // 3. Persiste log de execucao (pra UI mostrar)
    if (!dryRun) {
        try {
            await getDb().collection('sharepoint_sync_log').add({
                ...runStats,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        } catch (e) {
            console.warn('[syncAll] falha ao gravar log:', e.message);
        }
    }

    return runStats;
}
