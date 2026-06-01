// ============================================================================
// sefaz-backend/sharepoint-auto-sync.js
//
// Auto-sync: Cloud Scheduler calls POST /api/admin/sharepoint/auto-sync
// and this module syncs all empresas that have sharePointConfig enabled.
//
// For each empresa, it:
//   1. Builds folder paths (SAÍDA + ENTRADA) for the current month
//   2. Downloads XMLs via the proxy-backend
//   3. Parses each XML server-side using @xmldom/xmldom
//   4. Deduplicates by chave de acesso
//   5. Stores new documents in documentos_fiscais collection
//
// Also supports on-demand sync for a single empresa.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { DOMParser } from '@xmldom/xmldom';
import crypto from 'crypto';

const router = express.Router();
router.use(express.json());

const PROXY_URL = process.env.SHAREPOINT_PROXY_URL
    || 'https://consultor-fiscal-proxy-631239634290.us-west1.run.app';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

// ─── XML Parser (server-side, mirrors xmlParserService.ts) ──────────────────

function getTextContent(parent, tagName) {
    if (!parent) return '';
    const els = parent.getElementsByTagName(tagName);
    if (!els || els.length === 0) return '';
    return (els[0].textContent || '').trim();
}

function num(v) { return parseFloat(v) || 0; }
function onlyDigits(s) { return (s || '').replace(/\D/g, ''); }

function extractChaveFromId(id) {
    const m = (id || '').match(/\d{44}/);
    return m ? m[0] : '';
}

function parseXmlServer(xmlText) {
    const parser = new DOMParser({
        errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} },
    });
    const doc = parser.parseFromString(xmlText, 'text/xml');

    // CT-e
    const infCte = doc.getElementsByTagName('infCte')[0];
    if (infCte) return parseCTeServer(doc, infCte);

    const infNFe = doc.getElementsByTagName('infNFe')[0];
    if (!infNFe) return null;

    const ide = doc.getElementsByTagName('ide')[0];
    const emit = doc.getElementsByTagName('emit')[0];
    const dest = doc.getElementsByTagName('dest')[0];
    const total = doc.getElementsByTagName('total')[0];
    const icmsTot = total ? total.getElementsByTagName('ICMSTot')[0] : null;

    const modelo = getTextContent(ide, 'mod');
    const tipo = modelo === '65' ? 'NFCe' : 'NFe';

    const detElements = doc.getElementsByTagName('det');
    const itens = [];
    for (let i = 0; i < detElements.length; i++) {
        const det = detElements[i];
        const prod = det.getElementsByTagName('prod')[0];
        const icms = det.getElementsByTagName('ICMS')[0];
        const ipi = det.getElementsByTagName('IPI')[0];
        const pis = det.getElementsByTagName('PIS')[0];
        const cofins = det.getElementsByTagName('COFINS')[0];

        let cst = '', vICMS = 0, vBC = 0, aliqIcms = 0;
        let vBCST = 0, aliqST = 0, vICMSST = 0, pRedBC = 0, orig = '';
        if (icms && icms.childNodes) {
            for (let j = 0; j < icms.childNodes.length; j++) {
                const inner = icms.childNodes[j];
                if (inner.nodeType === 1) {
                    cst = getTextContent(inner, 'CST') || getTextContent(inner, 'CSOSN');
                    vICMS = num(getTextContent(inner, 'vICMS'));
                    vBC = num(getTextContent(inner, 'vBC'));
                    aliqIcms = num(getTextContent(inner, 'pICMS'));
                    vBCST = num(getTextContent(inner, 'vBCST'));
                    aliqST = num(getTextContent(inner, 'pICMSST'));
                    vICMSST = num(getTextContent(inner, 'vICMSST'));
                    pRedBC = num(getTextContent(inner, 'pRedBC'));
                    orig = getTextContent(inner, 'orig');
                    break;
                }
            }
        }

        let vIPI = 0, aliqIPI = 0;
        if (ipi) {
            const ipiTrib = ipi.getElementsByTagName('IPITrib')[0];
            if (ipiTrib) {
                vIPI = num(getTextContent(ipiTrib, 'vIPI'));
                aliqIPI = num(getTextContent(ipiTrib, 'pIPI'));
            }
        }

        let vPIS = 0, aliqPIS = 0;
        if (pis && pis.childNodes) {
            for (let j = 0; j < pis.childNodes.length; j++) {
                const inner = pis.childNodes[j];
                if (inner.nodeType === 1) {
                    vPIS = num(getTextContent(inner, 'vPIS'));
                    aliqPIS = num(getTextContent(inner, 'pPIS'));
                    break;
                }
            }
        }

        let vCOFINS = 0, aliqCOFINS = 0;
        if (cofins && cofins.childNodes) {
            for (let j = 0; j < cofins.childNodes.length; j++) {
                const inner = cofins.childNodes[j];
                if (inner.nodeType === 1) {
                    vCOFINS = num(getTextContent(inner, 'vCOFINS'));
                    aliqCOFINS = num(getTextContent(inner, 'pCOFINS'));
                    break;
                }
            }
        }

        itens.push({
            nItem: det.getAttribute('nItem') || String(i + 1),
            cProd: getTextContent(prod, 'cProd'),
            xProd: getTextContent(prod, 'xProd'),
            ncm: getTextContent(prod, 'NCM'),
            cest: getTextContent(prod, 'CEST') || undefined,
            cfop: getTextContent(prod, 'CFOP'),
            uCom: getTextContent(prod, 'uCom'),
            qCom: num(getTextContent(prod, 'qCom')),
            vUnCom: num(getTextContent(prod, 'vUnCom')),
            vProd: num(getTextContent(prod, 'vProd')),
            vDesc: num(getTextContent(prod, 'vDesc')) || undefined,
            vBC, aliqIcms, vICMS, vBCST, aliqST, vICMSST, pRedBC,
            vIPI, aliqIPI, vPIS, aliqPIS, vCOFINS, aliqCOFINS, cst, orig,
        });
    }

    const emitEnder = emit ? emit.getElementsByTagName('enderEmit')[0] : null;
    const destEnder = dest ? dest.getElementsByTagName('enderDest')[0] : null;

    const parseParticipante = (el, enderEl) => ({
        cnpjCpf: onlyDigits(getTextContent(el, 'CNPJ') || getTextContent(el, 'CPF')),
        nome: getTextContent(el, 'xNome'),
        fantasia: getTextContent(el, 'xFant') || undefined,
        ie: getTextContent(el, 'IE') || undefined,
        uf: getTextContent(enderEl, 'UF') || undefined,
        municipio: getTextContent(enderEl, 'xMun') || undefined,
        codMunIBGE: getTextContent(enderEl, 'cMun') || undefined,
        logradouro: getTextContent(enderEl, 'xLgr') || undefined,
        numero: getTextContent(enderEl, 'nro') || undefined,
        complemento: getTextContent(enderEl, 'xCpl') || undefined,
        bairro: getTextContent(enderEl, 'xBairro') || undefined,
        cep: onlyDigits(getTextContent(enderEl, 'CEP')) || undefined,
    });

    const cStat = getTextContent(doc.getElementsByTagName('infProt')[0], 'cStat');
    const status = cStat === '100' ? 'autorizado'
        : cStat === '101' ? 'cancelado'
        : cStat === '110' ? 'denegado'
        : cStat === '102' ? 'inutilizado'
        : !cStat ? 'desconhecido' : 'rejeitado';

    return {
        chave: extractChaveFromId(infNFe.getAttribute('Id') || ''),
        tipo, modelo,
        serie: getTextContent(ide, 'serie'),
        numero: getTextContent(ide, 'nNF'),
        natOp: getTextContent(ide, 'natOp'),
        dhEmi: getTextContent(ide, 'dhEmi') || getTextContent(ide, 'dEmi'),
        status,
        emitente: parseParticipante(emit, emitEnder),
        destinatario: parseParticipante(dest, destEnder),
        itens,
        totais: {
            vBC: num(getTextContent(icmsTot, 'vBC')),
            vICMS: num(getTextContent(icmsTot, 'vICMS')),
            vICMSDeson: num(getTextContent(icmsTot, 'vICMSDeson')),
            vFCP: num(getTextContent(icmsTot, 'vFCP')),
            vBCST: num(getTextContent(icmsTot, 'vBCST')),
            vST: num(getTextContent(icmsTot, 'vST')),
            vFCPST: num(getTextContent(icmsTot, 'vFCPST')),
            vProd: num(getTextContent(icmsTot, 'vProd')),
            vFrete: num(getTextContent(icmsTot, 'vFrete')),
            vSeg: num(getTextContent(icmsTot, 'vSeg')),
            vDesc: num(getTextContent(icmsTot, 'vDesc')),
            vII: num(getTextContent(icmsTot, 'vII')),
            vIPI: num(getTextContent(icmsTot, 'vIPI')),
            vIPIDevol: num(getTextContent(icmsTot, 'vIPIDevol')),
            vPIS: num(getTextContent(icmsTot, 'vPIS')),
            vCOFINS: num(getTextContent(icmsTot, 'vCOFINS')),
            vOutro: num(getTextContent(icmsTot, 'vOutro')),
            vNF: num(getTextContent(icmsTot, 'vNF')),
        },
    };
}

function parseCTeServer(doc, infCte) {
    const ide = doc.getElementsByTagName('ide')[0];
    const emit = doc.getElementsByTagName('emit')[0];
    const rem = doc.getElementsByTagName('rem')[0];
    const dest = doc.getElementsByTagName('dest')[0];
    const vPrest = doc.getElementsByTagName('vPrest')[0];
    const imp = doc.getElementsByTagName('imp')[0];
    const icmsEl = imp ? imp.getElementsByTagName('ICMS')[0] : null;

    const chave = extractChaveFromId(infCte.getAttribute('Id') || '');
    const enderEmit = emit ? emit.getElementsByTagName('enderEmit')[0] : null;
    const enderRem = rem ? rem.getElementsByTagName('enderReme')[0] : null;
    const enderDest = dest ? dest.getElementsByTagName('enderDest')[0] : null;

    const pp = (el, enderEl) => ({
        cnpjCpf: onlyDigits(getTextContent(el, 'CNPJ') || getTextContent(el, 'CPF')),
        nome: getTextContent(el, 'xNome'),
        ie: getTextContent(el, 'IE') || undefined,
        uf: getTextContent(enderEl, 'UF') || undefined,
        municipio: getTextContent(enderEl, 'xMun') || undefined,
        codMunIBGE: getTextContent(enderEl, 'cMun') || undefined,
    });

    let vICMS = 0, vBC = 0;
    if (icmsEl && icmsEl.childNodes) {
        for (let j = 0; j < icmsEl.childNodes.length; j++) {
            const inner = icmsEl.childNodes[j];
            if (inner.nodeType === 1) {
                vICMS = num(getTextContent(inner, 'vICMS'));
                vBC = num(getTextContent(inner, 'vBC'));
                break;
            }
        }
    }

    const valorPrest = num(getTextContent(vPrest, 'vTPrest'));
    const valorRec = num(getTextContent(vPrest, 'vRec'));

    const cStat = getTextContent(doc.getElementsByTagName('infProt')[0], 'cStat');
    const status = cStat === '100' ? 'autorizado'
        : cStat === '101' ? 'cancelado'
        : cStat === '110' ? 'denegado'
        : !cStat ? 'desconhecido' : 'rejeitado';

    const remetente = pp(rem, enderRem);
    const destinatario = pp(dest, enderDest);

    return {
        chave, tipo: 'CTe',
        modelo: getTextContent(ide, 'mod') || '57',
        serie: getTextContent(ide, 'serie'),
        numero: getTextContent(ide, 'nCT'),
        natOp: getTextContent(ide, 'natOp'),
        dhEmi: getTextContent(ide, 'dhEmi'),
        status,
        emitente: pp(emit, enderEmit),
        destinatario: remetente.cnpjCpf ? remetente : destinatario,
        itens: [],
        totais: {
            vBC, vICMS, vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0, vFCPST: 0,
            vProd: valorPrest, vFrete: valorPrest, vSeg: 0, vDesc: 0, vII: 0,
            vIPI: 0, vIPIDevol: 0, vPIS: 0, vCOFINS: 0, vOutro: 0,
            vNF: valorRec || valorPrest,
        },
    };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sha256Hex(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function competenciaFromIso(isoDate) {
    if (!isoDate) return '';
    const m = isoDate.match(/^(\d{4})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}` : '';
}

function classifyDirection(parsed, empresaCnpj) {
    const emp = onlyDigits(empresaCnpj);
    if (!emp) return 'desconhecida';
    if (onlyDigits(parsed.emitente?.cnpjCpf) === emp) return 'saida';
    if (onlyDigits(parsed.destinatario?.cnpjCpf) === emp) return 'entrada';
    return 'desconhecida';
}

function classifyCfop(itens, direcao) {
    const cfops = (itens || []).map(i => i.cfop).filter(Boolean);
    if (cfops.length === 0) return 'outro';
    const first = cfops[0].replace(/\D/g, '');
    if (['5102', '5405', '6102', '6108', '1102', '2102'].some(c => first.startsWith(c.slice(0, 1)))) {
        return direcao === 'entrada' ? 'compras' : 'vendas';
    }
    return 'outro';
}

function buildFolderPath(grupo, ano, mes, empresa, direcao) {
    return `Empresas/${grupo}/DEPARTAMENTO FISCAL/${ano}/${mes}-${ano}/${empresa}/XML ${direcao}`;
}

async function fetchFromProxy(path, body) {
    const resp = await fetch(`${PROXY_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Proxy error ${resp.status}`);
    }
    return resp.json();
}

// ─── Sync logic ─────────────────────────────────────────────────────────────

async function syncEmpresa(db, empresa, competencia) {
    const cfg = empresa.sharePointConfig;
    if (!cfg || !cfg.autoSyncEnabled) return null;
    if (!cfg.grupo || !cfg.empresaPasta) return null;

    const cnpj = onlyDigits(empresa.cnpj);
    if (!cnpj) return null;

    const [ano, mes] = competencia.split('-');
    const directions = ['SAÍDA', 'ENTRADA'];
    const summary = { empresaId: empresa.id, empresaNome: empresa.nome, novos: 0, duplicados: 0, erros: 0, total: 0 };

    for (const dir of directions) {
        const folderPath = buildFolderPath(cfg.grupo, ano, mes, cfg.empresaPasta, dir);
        let syncResult;
        try {
            syncResult = await fetchFromProxy('/api/sharepoint/sync', { folderPath });
        } catch (err) {
            console.warn(`[auto-sync] ${empresa.nome} ${dir}: ${err.message}`);
            summary.erros++;
            continue;
        }

        if (!syncResult.files || syncResult.files.length === 0) continue;
        summary.total += syncResult.files.length;

        for (const file of syncResult.files) {
            if (!file.content) { summary.erros++; continue; }

            try {
                const parsed = parseXmlServer(file.content);
                if (!parsed || !parsed.chave) { summary.erros++; continue; }

                const docId = parsed.chave;
                const existingDoc = await db.collection('documentos_fiscais').doc(docId).get();
                if (existingDoc.exists) {
                    summary.duplicados++;
                    continue;
                }

                const xmlHash = sha256Hex(file.content);
                const direcao = classifyDirection(parsed, cnpj);

                const documento = {
                    id: docId,
                    chave: parsed.chave,
                    xmlHash,
                    tipo: parsed.tipo,
                    modelo: parsed.modelo,
                    serie: parsed.serie,
                    numero: parsed.numero,
                    natOp: parsed.natOp,
                    dhEmi: parsed.dhEmi,
                    competencia: competenciaFromIso(parsed.dhEmi),
                    direcao,
                    categoriaOperacao: classifyCfop(parsed.itens, direcao),
                    status: parsed.status,
                    empresaId: empresa.id,
                    empresaCnpj: cnpj,
                    empresaNome: empresa.nome,
                    emitente: parsed.emitente,
                    destinatario: parsed.destinatario,
                    totais: parsed.totais,
                    itens: parsed.itens,
                    fileName: file.name,
                    tamanhoBytes: file.size || Buffer.byteLength(file.content, 'utf8'),
                    origem: 'sharepoint_auto',
                    importadoPor: 'system:auto-sync',
                    importadoPorEmail: 'auto-sync@system',
                    importadoEm: Date.now(),
                    createdBy: 'system:auto-sync',
                    createdByEmail: 'auto-sync@system',
                };

                // Remove undefined values (Firestore rejects them)
                const clean = JSON.parse(JSON.stringify(documento));
                await db.collection('documentos_fiscais').doc(docId).set(clean);
                summary.novos++;
            } catch (err) {
                console.warn(`[auto-sync] erro processando ${file.name}:`, err.message);
                summary.erros++;
            }
        }
    }

    return summary;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /auto-sync
 * Body: { competencia?: 'YYYY-MM' }
 *
 * Called by Cloud Scheduler or manually by admin.
 * Syncs all empresas with sharePointConfig.autoSyncEnabled = true.
 *
 * Auth: either Bearer (admin token) or X-CloudScheduler-JobName header.
 */
router.post('/auto-sync', async (req, res) => {
    try {
        // Auth: admin Bearer (token Firebase + role admin) OU x-cron-secret.
        // Antes aceitava QUALQUER request com header x-cloudscheduler-jobname,
        // que e trivialmente spoofavel via curl. Agora exige o cron-secret
        // (alinhado a /sync-cron e demais crons) ou um admin autenticado.
        const authHeader = req.headers.authorization || '';
        const cronSecret = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'] || '';
        const CRON_SECRET = process.env.SEFAZ_CRON_SECRET || '';

        const isCron = !!CRON_SECRET && cronSecret === CRON_SECRET;
        let isAdmin = false;
        if (!isCron && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const decoded = await fa().auth().verifyIdToken(token);
            const userDoc = await fa().firestore().collection('users').doc(decoded.uid).get();
            isAdmin = userDoc.exists && userDoc.data().role === 'admin';
        }
        if (!isCron && !isAdmin) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const db = fa().firestore();
        const now = new Date();
        const competencia = req.body?.competencia ||
            `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        // Read all empresas with auto-sync enabled
        const empresas = [];
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).get();
            for (const doc of snap.docs) {
                const data = { id: doc.id, ...doc.data() };
                if (data.sharePointConfig?.autoSyncEnabled) {
                    empresas.push(data);
                }
            }
        }

        if (empresas.length === 0) {
            return res.json({
                message: 'Nenhuma empresa com auto-sync habilitado.',
                competencia,
                results: [],
            });
        }

        console.log(`[auto-sync] Iniciando sync de ${empresas.length} empresa(s), competencia ${competencia}`);

        const results = [];
        for (const empresa of empresas) {
            try {
                const result = await syncEmpresa(db, empresa, competencia);
                if (result) results.push(result);
            } catch (err) {
                console.error(`[auto-sync] erro em ${empresa.nome}:`, err.message);
                results.push({
                    empresaId: empresa.id,
                    empresaNome: empresa.nome,
                    erro: err.message,
                });
            }
        }

        const totalNovos = results.reduce((s, r) => s + (r.novos || 0), 0);
        const totalDup = results.reduce((s, r) => s + (r.duplicados || 0), 0);
        const totalErros = results.reduce((s, r) => s + (r.erros || 0), 0);

        console.log(`[auto-sync] Concluido: ${totalNovos} novos, ${totalDup} duplicados, ${totalErros} erros`);

        // Log the sync run
        await db.collection('sharepoint_sync_log').add({
            competencia,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            empresasProcessadas: empresas.length,
            totalNovos, totalDup, totalErros,
            results,
        });

        return res.json({
            competencia,
            empresasProcessadas: empresas.length,
            totalNovos,
            totalDup,
            totalErros,
            results,
        });
    } catch (err) {
        console.error('[auto-sync] fatal:', err);
        return res.status(500).json({ error: err.message });
    }
});

/**
 * POST /config
 * Body: { empresaId, collection, sharePointConfig: { grupo, empresaPasta, autoSyncEnabled } }
 *
 * Admin-only endpoint to save SharePoint auto-sync config for an empresa.
 */
router.post('/config', async (req, res) => {
    try {
        const authHeader = req.headers.authorization || '';
        const m = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ error: 'Token ausente' });

        const decoded = await fa().auth().verifyIdToken(m[1]);
        const userDoc = await fa().firestore().collection('users').doc(decoded.uid).get();
        if (!userDoc.exists || userDoc.data().role !== 'admin') {
            return res.status(403).json({ error: 'Admin only' });
        }

        const { empresaId, collection, sharePointConfig } = req.body;
        if (!empresaId || !collection || !sharePointConfig) {
            return res.status(400).json({ error: 'empresaId, collection e sharePointConfig sao obrigatorios' });
        }

        if (!['simples_empresas', 'lucro_empresas'].includes(collection)) {
            return res.status(400).json({ error: 'collection invalida' });
        }

        await fa().firestore().collection(collection).doc(empresaId).update({
            sharePointConfig: {
                grupo: sharePointConfig.grupo || '',
                empresaPasta: sharePointConfig.empresaPasta || '',
                autoSyncEnabled: Boolean(sharePointConfig.autoSyncEnabled),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedBy: decoded.email || decoded.uid,
            },
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error('[sharepoint-config]', err);
        return res.status(500).json({ error: err.message });
    }
});

/**
 * GET /status
 * Returns last sync log entry and list of auto-sync-enabled empresas.
 */
router.get('/status', async (req, res) => {
    try {
        const authHeader = req.headers.authorization || '';
        const m = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ error: 'Token ausente' });

        await fa().auth().verifyIdToken(m[1]);

        const db = fa().firestore();

        const lastLogSnap = await db.collection('sharepoint_sync_log')
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();

        const lastSync = lastLogSnap.empty ? null : lastLogSnap.docs[0].data();

        const empresasAutoSync = [];
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).get();
            for (const d of snap.docs) {
                const data = d.data();
                if (data.sharePointConfig?.autoSyncEnabled) {
                    empresasAutoSync.push({
                        id: d.id,
                        nome: data.nome,
                        cnpj: data.cnpj,
                        grupo: data.sharePointConfig.grupo,
                        empresaPasta: data.sharePointConfig.empresaPasta,
                    });
                }
            }
        }

        return res.json({ lastSync, empresasAutoSync });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

export default router;
