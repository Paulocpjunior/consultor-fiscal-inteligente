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
        if (!res.headersSent) return res.status(500).json({ error: 'Falha interna' });
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

// ── GET /cobertura ────────────────────────────────────────────────────────
// Lista TODAS as empresas (simples + lucro) com status de captura ADN. Pra cada
// empresa: ativo (flag), ultNSU/ultimaSync (do state), totalDocs (nfse + eventos
// nacionais ja capturados). Sumariza % de cobertura no topo. So admin.
router.get('/cobertura', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });
        const db = fa().firestore();
        const colNames = [
            { col: process.env.SIMPLES_COLLECTION || 'simples_empresas', fonte: 'simples' },
            { col: process.env.LUCRO_COLLECTION || 'lucro_empresas', fonte: 'lucro' },
        ];
        const empresas = [];
        for (const { col, fonte } of colNames) {
            try {
                const snap = await db.collection(col).get();
                snap.forEach((doc) => {
                    const d = doc.data();
                    if (d._merged_into) return; // perdedor de merge
                    const cnpj = (d.cnpj || '').replace(/\D/g, '');
                    if (cnpj.length !== 14) return;
                    empresas.push({
                        id: doc.id,
                        cnpj,
                        nome: d.razaoSocial || d.nome || '',
                        fonte,
                        ativo: d.nfseNacionalDfeAtivo === true,
                        alteradoPor: d.nfseNacionalDfeAlteradoPor || null,
                        alteradoEm: d.nfseNacionalDfeAlteradoEm?.toDate?.()?.toISOString?.() || null,
                    });
                });
            } catch (e) {
                console.warn(`[nfse-nac-dfe/cobertura] coleção ${col} indisponível:`, e.message);
            }
        }
        // Dedup por CNPJ (empresa pode estar em ambas as coleções)
        const mapa = new Map();
        for (const e of empresas) if (!mapa.has(e.cnpj)) mapa.set(e.cnpj, e);
        const lista = Array.from(mapa.values());

        // State (ultNSU/ultimaSync) por empresa
        const stateRefs = lista.map((e) => db.collection('nfse_nacional_dfe_state').doc(e.cnpj));
        const stateSnaps = stateRefs.length ? await db.getAll(...stateRefs) : [];
        const stateMap = new Map();
        stateSnaps.forEach((s) => {
            if (s.exists) {
                const sd = s.data();
                stateMap.set(s.id, {
                    ultNSU: sd.ultNSU || null,
                    ultimaSync: sd.ultimaSync?.toDate?.()?.toISOString?.() || sd.ultimaSync || null,
                    maxNSU: sd.maxNSU || null,
                });
            }
        });
        lista.forEach((e) => { e.state = stateMap.get(e.cnpj) || null; });

        const total = lista.length;
        const ativas = lista.filter((e) => e.ativo).length;
        const comCaptura = lista.filter((e) => e.state && e.state.ultimaSync).length;
        return res.json({
            total, ativas, inativas: total - ativas, comCaptura,
            percentualAtivas: total ? Math.round((ativas / total) * 100) : 0,
            percentualCaptura: total ? Math.round((comCaptura / total) * 100) : 0,
            empresas: lista.sort((a, b) => (a.nome || '').localeCompare(b.nome || '')),
        });
    } catch (e) {
        console.error('[nfse-nac-dfe/cobertura]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

// ── POST /toggle-bulk ─────────────────────────────────────────────────────
// Liga/desliga ADN pra uma LISTA de empresas de uma vez. Body:
//   { cnpjs: string[], ativo: boolean }
// Resposta: { atualizados, naoEncontrados, falhas }. So admin.
router.post('/toggle-bulk', requireAuth, express.json(), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });
        const { cnpjs, ativo } = req.body || {};
        if (!Array.isArray(cnpjs) || cnpjs.length === 0) {
            return res.status(400).json({ error: 'cnpjs (array) obrigatorio' });
        }
        if (cnpjs.length > 2000) return res.status(400).json({ error: 'Máximo 2000 CNPJs por chamada.' });
        if (typeof ativo !== 'boolean') return res.status(400).json({ error: 'campo "ativo" boolean obrigatório' });

        const db = fa().firestore();
        const atualizados = [];
        const naoEncontrados = [];
        const falhas = [];

        // Normaliza/valida cada CNPJ; quem nao tiver 14 digitos ja vai pra naoEncontrados.
        const cnpjsValidos = [];
        for (const cnpjRaw of cnpjs) {
            const cnpj = String(cnpjRaw || '').replace(/\D/g, '');
            if (cnpj.length !== 14) naoEncontrados.push(cnpjRaw);
            else cnpjsValidos.push(cnpj);
        }

        // Loteia em chunks de 10 (limite do where('in')) e procura nas 2 colecoes.
        // Mapa cnpj -> { ref, colecao } pra atualizar no batch depois.
        const docPorCnpj = new Map();
        for (let i = 0; i < cnpjsValidos.length; i += 10) {
            const chunk = cnpjsValidos.slice(i, i + 10);
            for (const col of ['simples_empresas', 'lucro_empresas']) {
                try {
                    const snap = await db.collection(col).where('cnpj', 'in', chunk).get();
                    snap.forEach((doc) => {
                        const d = doc.data();
                        const c = String(d.cnpj || '').replace(/\D/g, '');
                        if (c.length === 14 && !docPorCnpj.has(c)) docPorCnpj.set(c, { ref: doc.ref, colecao: col });
                    });
                } catch (e) {
                    // Falha de query nao silencia — registra cada CNPJ do chunk como falha
                    for (const c of chunk) falhas.push({ cnpj: c, erro: e.message });
                }
            }
        }

        // CNPJs validos mas sem doc -> naoEncontrados
        for (const c of cnpjsValidos) {
            if (!docPorCnpj.has(c) && !falhas.some((f) => f.cnpj === c)) naoEncontrados.push(c);
        }

        // Atualiza em batches de 500 (limite Firestore).
        const entries = Array.from(docPorCnpj.entries());
        for (let i = 0; i < entries.length; i += 500) {
            const batch = db.batch();
            const slice = entries.slice(i, i + 500);
            for (const [, { ref }] of slice) {
                batch.update(ref, {
                    nfseNacionalDfeAtivo: ativo,
                    nfseNacionalDfeAlteradoPor: req.user.email,
                    nfseNacionalDfeAlteradoEm: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
            try {
                await batch.commit();
                for (const [c, { colecao }] of slice) atualizados.push({ cnpj: c, colecao });
            } catch (e) {
                for (const [c] of slice) falhas.push({ cnpj: c, erro: e.message });
            }
        }

        return res.json({
            ativo,
            total: cnpjs.length,
            atualizados: atualizados.length,
            naoEncontrados: naoEncontrados.length,
            falhas: falhas.length,
            detalhes: { atualizados, naoEncontrados, falhas },
        });
    } catch (e) {
        console.error('[nfse-nac-dfe/toggle-bulk]', e);
        return res.status(500).json({ error: 'Falha interna' });
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
        // Empresa esta em apenas uma das duas colecoes (simples OU lucro).
        // Erro de query/update vira warn — fluxo continua tentando a outra colecao.
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
            } catch (e) {
                console.warn(`[nfse-nacional-dfe] falha atualizando ${col}/${cnpj}:`, e.message);
            }
        }
        return res.status(404).json({ error: `Empresa CNPJ ${cnpj} não encontrada` });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

export default router;
