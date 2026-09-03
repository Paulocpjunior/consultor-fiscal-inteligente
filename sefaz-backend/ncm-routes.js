// ============================================================================
// sefaz-backend/ncm-routes.js  (ESM)
//
//   GET    /api/admin/ncm?busca=&uf=          lista o cadastro (filtro simples)
//   GET    /api/admin/ncm/:ncm?uf=&data=      resolve o parâmetro de UM NCM
//   PUT    /api/admin/ncm                     cria/atualiza (só admin)
//   DELETE /api/admin/ncm/:id                 remove (só admin)
//   POST   /api/admin/ncm/importar            lote (só admin)
//
// A regra de negócio inteira mora em ncm-parametros.js (puro). Aqui é I/O.
// ============================================================================

import { Router } from 'express';
import express from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { fetchAllDocs } from './firestore-paginate.js';
import {
    COLECAO_NCM, validarParametroNcm, resolverParametrosNcm, docIdParametro, normalizarNcm,
} from './ncm-parametros.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soAdmin = (req, res) => {
    if (req.user?.role !== 'admin') {
        res.status(403).json({
            ok: false,
            error: 'Só administrador altera o cadastro de NCM — o parâmetro vale para todas as empresas '
                + 'e entra no cálculo de imposto.',
        });
        return false;
    }
    return true;
};

async function carregarCatalogo(db) {
    const snaps = await fetchAllDocs(db.collection(COLECAO_NCM), {
        label: 'ncm_parametros', maxDocs: 40000,
    });
    return snaps.map((s) => ({ id: s.id, ...s.data() }));
}

router.get('/', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const todos = await carregarCatalogo(db);
        const busca = String(req.query.busca || '').trim().toLowerCase();
        const uf = String(req.query.uf || '').trim().toUpperCase();

        let linhas = todos;
        if (uf) linhas = linhas.filter((l) => !l.uf || String(l.uf).toUpperCase() === uf);
        if (busca) {
            const digitos = busca.replace(/\D/g, '');
            linhas = linhas.filter((l) =>
                (digitos && String(l.ncm || '').startsWith(digitos))
                || String(l.descricao || '').toLowerCase().includes(busca)
                || String(l.cest || '').replace(/\D/g, '').startsWith(digitos));
        }
        linhas.sort((a, b) => String(a.ncm).localeCompare(String(b.ncm)));

        return res.json({ ok: true, total: todos.length, linhas: linhas.slice(0, 500), truncado: linhas.length > 500 });
    } catch (e) {
        console.error('[ncm/listar]', e);
        return res.status(500).json({ ok: false, error: `Falha ao ler o cadastro de NCM: ${e.message}` });
    }
});

router.get('/:ncm', requireAuth, async (req, res) => {
    try {
        const ncm = String(req.params.ncm || '').replace(/\D/g, '');
        if (!ncm) return res.status(400).json({ ok: false, error: 'Informe o NCM.' });
        const db = getDb();
        const catalogo = await carregarCatalogo(db);
        const r = resolverParametrosNcm(ncm, catalogo, {
            uf: String(req.query.uf || ''),
            dataRef: String(req.query.data || ''),
        });
        return res.json({ ok: true, ncm, ...r });
    } catch (e) {
        console.error('[ncm/resolver]', e);
        return res.status(500).json({ ok: false, error: `Falha na consulta: ${e.message}` });
    }
});

router.put('/', requireAuth, async (req, res) => {
    if (!soAdmin(req, res)) return;
    try {
        const v = validarParametroNcm(req.body || {});
        if (!v.ok) return res.status(400).json({ ok: false, error: v.erros.join(' ') });

        const p = req.body || {};
        const doc = {
            ncm: v.ncm,
            uf: v.uf || null,
            descricao: String(p.descricao || '').trim() || null,
            cest: String(p.cest || '').replace(/\D/g, '') || null,
            aliqInterna: p.aliqInterna === '' || p.aliqInterna == null ? null : Number(p.aliqInterna),
            ivaSt: p.ivaSt === '' || p.ivaSt == null ? null : Number(p.ivaSt),
            ivaJaAjustado: !!p.ivaJaAjustado,
            portariaIvaSt: String(p.portariaIvaSt || '').trim() || null,
            temSt: p.temSt == null ? null : !!p.temSt,
            reducaoBase: p.reducaoBase === '' || p.reducaoBase == null ? null : Number(p.reducaoBase),
            vigenciaInicio: String(p.vigenciaInicio || '').slice(0, 10) || null,
            vigenciaFim: String(p.vigenciaFim || '').slice(0, 10) || null,
            atualizadoPor: req.user?.email || req.user?.uid || null,
            atualizadoEm: new Date().toISOString(),
        };

        const db = getDb();
        const id = docIdParametro(doc);
        await db.collection(COLECAO_NCM).doc(id).set(doc, { merge: false });
        return res.json({ ok: true, id, ...doc });
    } catch (e) {
        console.error('[ncm/salvar]', e);
        return res.status(500).json({ ok: false, error: `Falha ao gravar: ${e.message}` });
    }
});

router.delete('/:id', requireAuth, async (req, res) => {
    if (!soAdmin(req, res)) return;
    try {
        await getDb().collection(COLECAO_NCM).doc(String(req.params.id)).delete();
        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ ok: false, error: `Falha ao remover: ${e.message}` });
    }
});

/**
 * Importação em lote. Cada linha passa pela MESMA validação da tela — lote
 * não é atalho para entrar com dado que a tela recusaria.
 */
router.post('/importar', requireAuth, async (req, res) => {
    if (!soAdmin(req, res)) return;
    try {
        const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas : [];
        if (linhas.length === 0) return res.status(400).json({ ok: false, error: 'Nenhuma linha para importar.' });
        if (linhas.length > 5000) return res.status(400).json({ ok: false, error: 'Máximo de 5.000 linhas por importação.' });

        const db = getDb();
        const aceitas = [];
        const recusadas = [];

        for (const [i, l] of linhas.entries()) {
            const v = validarParametroNcm(l);
            if (!v.ok) { recusadas.push({ linha: i + 1, ncm: l?.ncm, motivo: v.erros.join(' ') }); continue; }
            aceitas.push({
                ...l,
                ncm: v.ncm,
                uf: v.uf || null,
                atualizadoPor: req.user?.email || req.user?.uid || null,
                atualizadoEm: new Date().toISOString(),
            });
        }

        let gravadas = 0;
        for (let i = 0; i < aceitas.length; i += 400) {
            const batch = db.batch();
            for (const doc of aceitas.slice(i, i + 400)) {
                batch.set(db.collection(COLECAO_NCM).doc(docIdParametro(doc)), doc, { merge: false });
            }
            await batch.commit();
            gravadas += Math.min(400, aceitas.length - i);
        }

        return res.json({
            ok: true,
            gravadas,
            recusadas,
            // Farol honesto: importação parcial não pode parecer completa.
            mensagem: recusadas.length > 0
                ? `${gravadas} linha(s) gravada(s) e ${recusadas.length} RECUSADA(S) — veja o motivo de cada uma abaixo.`
                : `${gravadas} linha(s) gravada(s).`,
        });
    } catch (e) {
        console.error('[ncm/importar]', e);
        return res.status(500).json({ ok: false, error: `Falha na importação: ${e.message}` });
    }
});

export default router;
