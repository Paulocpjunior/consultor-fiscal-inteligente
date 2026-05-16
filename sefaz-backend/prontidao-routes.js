// ============================================================================
// sefaz-backend/prontidao-routes.js
// Modulo Prontidao SERPRO — visao consolidada de certificado + procuracao
// por empresa. Serve DCTFWeb, Caixa Postal, DAS — tudo que exige cert/procuracao.
//
// Fatia 1: status de CERTIFICADO (real, lido de empresas_certificados).
//          status de PROCURACAO comeca 'nao_testado' — Fatia 2 popula via
//          resultado real das chamadas SERPRO.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { listCertsEmpresas } from './cert-storage.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

async function requireAdmin(req, res, next) {
    try {
        const auth = req.headers.authorization || '';
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ error: 'Token ausente' });
        const decoded = await fa().auth().verifyIdToken(m[1]);
        const userDoc = await fa().firestore().collection('users').doc(decoded.uid).get();
        const role = userDoc.exists ? userDoc.data().role : null;
        if (role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a admin' });
        req.user = { uid: decoded.uid, role };
        next();
    } catch (e) {
        console.error('[prontidao requireAdmin] erro:', e.message);
        return res.status(401).json({ error: 'Token invalido ou expirado' });
    }
}

// Classifica a validade do certificado a partir do notAfter (ISO string)
function classificarCert(notAfter) {
    if (!notAfter) return { status: 'ausente', diasRestantes: null };
    const fim = new Date(notAfter).getTime();
    if (isNaN(fim)) return { status: 'ausente', diasRestantes: null };
    const dias = Math.floor((fim - Date.now()) / 86400000);
    if (dias < 0)  return { status: 'vencido', diasRestantes: dias };
    if (dias <= 30) return { status: 'vencendo', diasRestantes: dias };
    return { status: 'valido', diasRestantes: dias };
}

// GET /api/admin/prontidao
// Retorna, por empresa que tem certificado, o status do cert.
// (Fatia 1 — procuracao entra na Fatia 2.)
router.get('/', requireAdmin, async (_req, res) => {
    try {
        const certs = await listCertsEmpresas();

        // Cruza com simples_empresas + lucro_empresas pra obter o nome.
        // empresaId do cert == id do doc de empresa (confirmado).
        const db = fa().firestore();
        const [simSnap, lucSnap] = await Promise.all([
            db.collection('simples_empresas').get(),
            db.collection('lucro_empresas').get(),
        ]);
        const nomesPorId = {};
        simSnap.forEach(d => { nomesPorId[d.id] = d.data().nome || null; });
        lucSnap.forEach(d => { nomesPorId[d.id] = d.data().nome || null; });

        const empresas = certs.map(c => {
            const cls = classificarCert(c.notAfter);
            return {
                empresaId: c.empresaId,
                nome: nomesPorId[c.empresaId] || null,
                cnpj: c.cnpj || null,
                cert: {
                    status: cls.status,            // valido | vencendo | vencido | ausente
                    diasRestantes: cls.diasRestantes,
                    notAfter: c.notAfter || null,
                    uploadedBy: c.uploadedBy || null,
                    uploadedAt: c.uploadedAt || null,
                },
                procuracao: {
                    status: 'nao_testado',         // Fatia 2: ok | sem_procuracao | erro
                },
            };
        });
        return res.json({
            ok: true,
            totalComCert: empresas.length,
            empresas,
        });
    } catch (e) {
        console.error('[prontidao] erro:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

export default router;
