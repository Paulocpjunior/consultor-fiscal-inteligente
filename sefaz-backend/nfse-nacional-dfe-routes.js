// ============================================================================
// sefaz-backend/nfse-nacional-dfe-routes.js
// ----------------------------------------------------------------------------
// Endpoints para captura NFSe Nacional via ADN.
//
// Montado em: /api/admin/nfse-nacional-dfe
//
//   POST /sync-one        — captura 1 empresa (manual, colaborador autenticado)
//   POST /sync-cron       — cron: percorre todas as empresas elegíveis
//   GET  /state/:cnpj     — última posição (NSU) de uma empresa
//   GET  /window          — status da janela operacional (reusa SEFAZ)
//   GET  /resumo          — estatísticas pro dashboard
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { sincronizarEmpresaNfseNacionalDfe, limparLocksOrfaos } from './nfse-nacional-dfe-orchestrator.js';
import { statusJanelaOperacional } from './janela-operacional.js';
import { requireAuth, requireAdmin } from './require-admin.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

function requireCronAuth(req, res, next) {
    const secret = process.env.SEFAZ_CRON_SECRET;
    if (!secret) {
        console.error('[requireCronAuth] SEFAZ_CRON_SECRET not configured');
        return res.status(500).json({ error: 'Cron secret not configured' });
    }
    const headerSecret = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'];
    if (headerSecret === secret) {
        return next();
    }
    return res.status(403).json({ error: 'Cron auth failed' });
}

// ── POST /sync-one ────────────────────────────────────────────────────────
router.post('/sync-one', requireAdmin, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj } = req.body || {};
        if (!empresaId || !empresaCnpj) {
            return res.status(400).json({ error: 'empresaId e empresaCnpj obrigatórios' });
        }
        const janela = statusJanelaOperacional();
        if (!janela.dentro) {
            return res.status(403).json({
                error: 'Fora da janela operacional',
                motivo: janela.motivo,
                agoraBRT: janela.agoraBRT,
            });
        }

        console.log(`[nfse-nac-dfe/sync-one] empresa=${empresaId} cnpj=${empresaCnpj} user=${req.user.email}`);
        const result = await sincronizarEmpresaNfseNacionalDfe({
            empresaId, empresaCnpj,
            capturadoPor: { uid: req.user.uid, email: req.user.email, fonte: 'manual' },
        });
        if (!result.ok && result.locked) return res.status(409).json(result);
        if (!result.ok) return res.status(500).json(result);
        return res.json(result);
    } catch (e) {
        console.error('[nfse-nac-dfe/sync-one]', e);
        return res.status(500).json({ error: e.message });
    }
});

// ── POST /sync-cron-now ──────────────────────────────────────────────────
// Disparo manual pelo admin (Bearer, sem precisar do cron-secret).
router.post('/sync-cron-now', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores' });
        }
        res.json({ ok: true, motivo: 'Captura NFSe Nacional iniciada em background' });
        setImmediate(async () => {
            const inicio = Date.now();
            let sucessos = 0, falhas = 0, totalNovos = 0, total = 0;
            try {
                const empresas = await listarEmpresasParaCron();
                total = empresas.length;
                for (const emp of empresas) {
                    try {
                        const r = await sincronizarEmpresaNfseNacionalDfe({
                            empresaId: emp.id,
                            empresaCnpj: emp.cnpj,
                            capturadoPor: { uid: req.user.uid, email: req.user.email, fonte: 'cron-now-admin' },
                        });
                        if (r.ok) { sucessos++; totalNovos += r.novos || 0; }
                        else falhas++;
                    } catch (e) {
                        falhas++;
                        console.error(`[nfse-nac-dfe/sync-cron-now] exceção em ${emp.cnpj}:`, e.message);
                    }
                }
                await fa().firestore().collection('nfse_nacional_dfe_cron_logs').add({
                    executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                    duracaoMs: Date.now() - inicio,
                    fonte: 'admin-manual',
                    totalEmpresas: total, sucessos, falhas, totalNovos,
                });
                console.log(`[nfse-nac-dfe/sync-cron-now] ok — ${sucessos}/${total} sucessos, ${totalNovos} novos`);
            } catch (e) {
                console.error('[nfse-nac-dfe/sync-cron-now] erro fatal:', e);
            }
        });
    } catch (e) {
        console.error('[nfse-nac-dfe/sync-cron-now]', e);
        return res.status(500).json({ error: e.message });
    }
});

// ── POST /sync-cron ───────────────────────────────────────────────────────
router.post('/sync-cron', requireCronAuth, async (req, res) => {
    res.json({ ok: true, motivo: 'Cron iniciado em background' });

    setImmediate(async () => {
        const inicio = Date.now();
        const fonte = req.cron?.source || 'unknown';
        console.log('[nfse-nac-dfe/sync-cron] início — fonte:', fonte);
        let sucessos = 0, falhas = 0, totalNovos = 0, totalEmpresas = 0;
        let erroFatal = null;
        try {
            // Cleanup de locks orfaos antes do batch — cobre caso raro de
            // processo morto antes do catch (OOM kill, etc) na sync anterior.
            try {
                const limpeza = await limparLocksOrfaos();
                if (limpeza.removidos > 0) {
                    console.log(`[nfse-nac-dfe/sync-cron] cleanup: ${limpeza.removidos}/${limpeza.total} locks orfaos removidos`);
                }
            } catch (e) {
                console.warn('[nfse-nac-dfe/sync-cron] cleanup falhou (continua):', e.message);
            }
            const empresas = await listarEmpresasParaCron();
            totalEmpresas = empresas.length;
            console.log(`[nfse-nac-dfe/sync-cron] ${empresas.length} empresas elegíveis`);
            for (const emp of empresas) {
                try {
                    const r = await sincronizarEmpresaNfseNacionalDfe({
                        empresaId: emp.id,
                        empresaCnpj: emp.cnpj,
                        capturadoPor: { fonte: 'cron', source: fonte },
                    });
                    if (r.ok) { sucessos++; totalNovos += r.novos || 0; }
                    else falhas++;
                } catch (e) {
                    falhas++;
                    console.error(`[nfse-nac-dfe/sync-cron] exceção em ${emp.cnpj}:`, e.message);
                }
            }
            const dur = Date.now() - inicio;
            console.log(`[nfse-nac-dfe/sync-cron] fim — ${sucessos}/${empresas.length} sucessos, ${totalNovos} novos, ${dur}ms`);
        } catch (e) {
            erroFatal = e.message;
            console.error('[nfse-nac-dfe/sync-cron] erro fatal:', e);
        }
        try {
            await fa().firestore().collection('nfse_nacional_dfe_cron_logs').add({
                executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                duracaoMs: Date.now() - inicio,
                fonte,
                totalEmpresas, sucessos, falhas, totalNovos,
                erroFatal,
            });
        } catch (logErr) {
            console.warn('[nfse-nac-dfe/sync-cron] log falhou:', logErr.message);
        }
    });
});

// Lista empresas elegíveis pra captura NFSe Nacional.
// MVP v1: todas as empresas com nfseNacionalDfeAtivo=true. Default = false.
// (Diferente do SEFAZ que é ativo por default — aqui o admin precisa
// habilitar pra evitar chamadas a ADN sem procuração registrada.)
async function listarEmpresasParaCron() {
    const db = fa().firestore();
    const empresas = [];
    const colNames = [
        process.env.SIMPLES_COLLECTION || 'simples_empresas',
        process.env.LUCRO_COLLECTION || 'lucro_empresas',
    ];
    for (const colName of colNames) {
        try {
            const snap = await db.collection(colName).get();
            snap.forEach((doc) => {
                const d = doc.data();
                if (d.nfseNacionalDfeAtivo !== true) return;
                const cnpj = (d.cnpj || '').replace(/\D/g, '');
                if (cnpj.length !== 14) return;
                empresas.push({ id: doc.id, cnpj, nome: d.razaoSocial || d.nome || '', fonte: colName });
            });
        } catch (e) {
            console.warn(`[nfse-nac-dfe/sync-cron] coleção ${colName} indisponível:`, e.message);
        }
    }
    const map = new Map();
    empresas.forEach((e) => { if (!map.has(e.cnpj)) map.set(e.cnpj, e); });
    return Array.from(map.values());
}

// ── GET /state/:cnpj ──────────────────────────────────────────────────────
router.get('/state/:cnpj', requireAuth, async (req, res) => {
    try {
        const cnpj = String(req.params.cnpj).replace(/\D/g, '');
        if (cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });

        const db = fa().firestore();
        const [stateSnap, lockSnap] = await Promise.all([
            db.collection('nfse_nacional_dfe_state').doc(cnpj).get(),
            db.collection('nfse_nacional_dfe_locks').doc(cnpj).get(),
        ]);
        const state = stateSnap.exists ? stateSnap.data() : null;
        const lock = lockSnap.exists ? lockSnap.data() : null;
        const now = Date.now();
        const lockAtivo = lock?.expiresAt && (lock.expiresAt.toMillis ? lock.expiresAt.toMillis() : lock.expiresAt) > now;
        return res.json({ cnpj, state, lock: lock ? { ...lock, ativo: lockAtivo } : null });
    } catch (e) {
        console.error('[nfse-nac-dfe/state]', e);
        return res.status(500).json({ error: e.message });
    }
});

// ── GET /window ───────────────────────────────────────────────────────────
router.get('/window', requireAuth, (_req, res) => res.json(statusJanelaOperacional()));

// ── GET /resumo ───────────────────────────────────────────────────────────
router.get('/resumo', requireAuth, async (_req, res) => {
    try {
        const db = fa().firestore();
        const snap = await db.collection('documentos_fiscais')
            .where('tipo', 'in', ['nfseNacional', 'eventoNfseNacional'])
            .limit(500).get();
        let nfse = 0, eventos = 0, valorTotal = 0;
        snap.docs.forEach((d) => {
            const x = d.data();
            if (x.tipo === 'nfseNacional') { nfse++; valorTotal += x.valorServico || 0; }
            else eventos++;
        });
        return res.json({
            total: nfse + eventos,
            nfse, eventos,
            valorTotal: +valorTotal.toFixed(2),
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ── POST /toggle/:cnpj ────────────────────────────────────────────────────
// Liga/desliga captura NFSe Nacional pra uma empresa. Só admin.
router.post('/toggle/:cnpj', requireAuth, express.json(), async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
        const cnpj = String(req.params.cnpj).replace(/\D/g, '');
        if (cnpj.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });
        const { ativo } = req.body || {};
        if (typeof ativo !== 'boolean') return res.status(400).json({ error: 'campo "ativo" boolean obrigatório' });

        const db = fa().firestore();
        // Atualiza nas duas coleções (a empresa só está numa delas, então uma vai falhar silently)
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            try {
                const snap = await db.collection(col).where('cnpj', '==', cnpj).limit(1).get();
                if (!snap.empty) {
                    await snap.docs[0].ref.update({
                        nfseNacionalDfeAtivo: ativo,
                        nfseNacionalDfeAlteradoPor: req.user.email,
                        nfseNacionalDfeAlteradoEm: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    return res.json({ ok: true, cnpj, ativo, coleção: col });
                }
            } catch {}
        }
        return res.status(404).json({ error: `Empresa CNPJ ${cnpj} não encontrada` });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

export default router;
