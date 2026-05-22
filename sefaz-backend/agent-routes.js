// ============================================================================
// sefaz-backend/agent-routes.js
// ----------------------------------------------------------------------------
// Rotas usadas pelo agente local cfi-a3 (captura SEFAZ via A3).
//
// Endpoints:
//   GET  /empresas-a3        — lista empresas A3 da carteira do colaborador
//   GET  /state/:cnpj        — último NSU sincronizado (mesmo padrão de sync-routes)
//   POST /upload-batch       — recebe lote de XMLs capturados pelo agente
//
// Autenticação: Bearer com a API key gerada em /api/admin/agent-keys.
// O middleware valida o hash da key e popula req.user com o ownerUid.
// ============================================================================
import express from 'express';
import admin from 'firebase-admin';
import zlib from 'node:zlib';
import { validarAgentKey } from './agent-keys-storage.js';
import { importarXmlSefaz, registrarErroSefaz } from './xml-importer.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

// ── Middleware: autentica via API key do agente ──────────────────────────
async function requireAgentKey(req, res, next) {
    try {
        const auth = req.headers.authorization || '';
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ error: 'API key ausente' });
        const validated = await validarAgentKey(m[1].trim());
        if (!validated) return res.status(401).json({ error: 'API key inválida ou revogada' });

        // Busca dados do user pra preencher email/role
        const userSnap = await fa().firestore().collection('users').doc(validated.ownerUid).get();
        if (!userSnap.exists) return res.status(403).json({ error: 'Owner da key não existe mais' });
        const userData = userSnap.data();

        req.user = {
            uid: validated.ownerUid,
            email: userData.email || validated.ownerEmail,
            role: userData.role || 'colaborador',
            agentKeyId: validated.keyId,
            agentKeyLabel: validated.label,
        };
        next();
    } catch (e) {
        console.error('[requireAgentKey] erro:', e.message);
        return res.status(401).json({ error: 'Falha autenticando agente' });
    }
}

// ── GET /empresas-a3 ──────────────────────────────────────────────────────
// Retorna empresas marcadas tipoCert='A3' que esse colaborador tem na carteira.
// Admin vê todas; colaborador comum vê só as atribuídas a ele.
router.get('/empresas-a3', requireAgentKey, async (req, res) => {
    try {
        const db = fa().firestore();

        // Determina o conjunto permitido de CNPJs
        let cnpjsPermitidos = null; // null = todos (admin)
        if (req.user.role !== 'admin') {
            try {
                const carteiraSnap = await db.collection('carteiras')
                    .where('colaboradorUid', '==', req.user.uid).get();
                cnpjsPermitidos = new Set(
                    carteiraSnap.docs
                        .map((d) => String(d.data().empresaCnpj || '').replace(/\D/g, ''))
                        .filter(Boolean),
                );
            } catch (e) {
                console.warn('[agent/empresas-a3] erro carteira:', e.message);
                cnpjsPermitidos = new Set();
            }
        }

        // Lê empresas_certificados com tipoCert='A3'
        const certSnap = await db.collection('empresas_certificados')
            .where('tipoCert', '==', 'A3').get();

        const empresas = [];
        for (const certDoc of certSnap.docs) {
            const empresaId = certDoc.id;
            const cert = certDoc.data();

            // Carrega a empresa em simples_empresas ou lucro_empresas
            let empresaData = null;
            let colName = null;
            for (const col of ['simples_empresas', 'lucro_empresas']) {
                const s = await db.collection(col).doc(empresaId).get();
                if (s.exists) { empresaData = s.data(); colName = col; break; }
            }
            if (!empresaData) continue;

            const cnpjNum = String(empresaData.cnpj || cert.cnpj || '').replace(/\D/g, '');
            if (cnpjsPermitidos !== null && !cnpjsPermitidos.has(cnpjNum)) continue;

            // Lê último estado de captura pra mostrar "última captura A3"
            let ultimaCapturaA3 = null;
            try {
                const stateSnap = await db.collection('sefaz_state').doc(cnpjNum).get();
                if (stateSnap.exists) {
                    const s = stateSnap.data();
                    if (s.ultimaSyncFonte === 'agent-a3') {
                        ultimaCapturaA3 = s.ultimaSync?.toMillis ? s.ultimaSync.toMillis() : null;
                    }
                }
            } catch {}

            empresas.push({
                id: empresaId,
                cnpj: cnpjNum,
                razaoSocial: empresaData.razaoSocial || empresaData.nome || cert.titular,
                uf: empresaData.dadosFiscais?.uf || null,
                regime: colName === 'simples_empresas' ? 'simples' : 'lucro',
                ultimaCapturaA3,
            });
        }

        return res.json({ ok: true, empresas });
    } catch (e) {
        console.error('[agent/empresas-a3] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ── GET /state/:cnpj ──────────────────────────────────────────────────────
router.get('/state/:cnpj', requireAgentKey, async (req, res) => {
    try {
        const cnpj = String(req.params.cnpj).replace(/\D/g, '');
        if (cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });
        const snap = await fa().firestore().collection('sefaz_state').doc(cnpj).get();
        if (!snap.exists) return res.json({ cnpj, ultNSU: '0' });
        const d = snap.data();
        return res.json({ cnpj, ultNSU: d.ultNSU || '0', ultimaSync: d.ultimaSync?.toMillis?.() || null });
    } catch (e) {
        console.error('[agent/state] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ── POST /upload-batch ────────────────────────────────────────────────────
// Body: {
//   empresaId, empresaCnpj, capturadoPor: { fonte, hostname },
//   ultNSU, maxNSU, docs: [{ nsu, schema, xmlGzipBase64 }]
// }
router.post('/upload-batch', requireAgentKey, express.json({ limit: '20mb' }), async (req, res) => {
    try {
        const { empresaId, empresaCnpj, ultNSU, maxNSU, docs } = req.body || {};
        if (!empresaId || !empresaCnpj) return res.status(400).json({ error: 'empresaId e empresaCnpj obrigatórios' });
        if (!Array.isArray(docs)) return res.status(400).json({ error: 'docs deve ser array' });

        const cnpjNum = String(empresaCnpj).replace(/\D/g, '');

        const capturadoPor = {
            uid: req.user.uid,
            email: req.user.email,
            fonte: 'agent-a3',
            agentKeyId: req.user.agentKeyId,
            agentKeyLabel: req.user.agentKeyLabel,
        };

        let novos = 0;
        let duplicados = 0;
        let erros = 0;
        for (const d of docs) {
            try {
                // SEFAZ entrega docZip = gzip(xml) em base64. Descomprime aqui.
                let xml;
                try {
                    const gzBuf = Buffer.from(d.xmlGzipBase64 || '', 'base64');
                    xml = zlib.gunzipSync(gzBuf).toString('utf-8');
                } catch (e) {
                    throw new Error(`falha descomprimindo docZip nsu=${d.nsu}: ${e.message}`);
                }

                const result = await importarXmlSefaz({
                    empresaId,
                    empresaCnpj: cnpjNum,
                    xml,
                    schema: d.schema,
                    nsu: d.nsu,
                    capturadoPor,
                });
                if (result?.status === 'duplicado') duplicados++;
                else if (result?.status === 'erro') erros++;
                else novos++;
            } catch (e) {
                erros++;
                try {
                    await registrarErroSefaz({
                        empresaId,
                        empresaCnpj: cnpjNum,
                        motivo: e.message,
                        contexto: { nsu: d.nsu, schema: d.schema, fonte: 'agent-a3' },
                        capturadoPor,
                    });
                } catch {}
            }
        }

        // Atualiza sefaz_state
        if (ultNSU) {
            const ref = fa().firestore().collection('sefaz_state').doc(cnpjNum);
            await ref.set({
                cnpj: cnpjNum,
                ultNSU,
                maxNSU: maxNSU || null,
                ultimaSync: admin.firestore.FieldValue.serverTimestamp(),
                ultimaSyncFonte: 'agent-a3',
                ultimaSyncPor: capturadoPor,
            }, { merge: true });
        }

        return res.json({ ok: true, novos, duplicados, erros });
    } catch (e) {
        console.error('[agent/upload-batch] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

export default router;
