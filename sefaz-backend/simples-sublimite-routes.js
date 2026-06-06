// ============================================================================
// sefaz-backend/simples-sublimite-routes.js  (ESM)
//
// Alerta de sublimite/teto do Simples: pra cada empresa Simples, calcula
// RBT12 a partir do faturamentoManual e classifica contra:
//   teto Simples         R$ 4.800.000 (ultrapassou = EXCLUSAO automatica)
//   sublimite ICMS/ISS   R$ 3.600.000 (ultrapassou = sai do Simples Estadual)
//
// So admin. Filtro pela carteira do colaborador. Reusa simples-sublimite-helper
// (puro, testado). Montado em: /api/admin/simples-sublimite
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { getCnpjsDaCarteira } from './carteira-auth.js';
import {
    calcularRbt12, classificarRbt12,
    LIMITE_TETO_SIMPLES, LIMITE_SUBLIMITE_ICMS_ISS,
} from './simples-sublimite-helper.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

router.get('/', requireAuth, async (req, res) => {
    try {
        const db = fa().firestore();
        const cnpjsCarteira = await getCnpjsDaCarteira(req.user);
        const filtroCarteira = cnpjsCarteira ? new Set(cnpjsCarteira) : null;
        const mesReferencia = String(req.query.mesReferencia || '').trim() || undefined;

        const snap = await db.collection('simples_empresas').get();
        const empresas = [];
        snap.forEach((doc) => {
            const d = doc.data();
            if (d._merged_into) return;
            const cnpj = (d.cnpj || '').replace(/\D/g, '');
            if (cnpj.length !== 14) return;
            if (filtroCarteira && !filtroCarteira.has(cnpj)) return;

            const { rbt12, mesesConsiderados, mesesSemDado } = calcularRbt12(
                d.faturamentoManual || {}, mesReferencia,
            );
            const classif = classificarRbt12(rbt12);

            empresas.push({
                id: doc.id,
                cnpj,
                nome: d.razaoSocial || d.nome || '',
                rbt12,
                mesesComDado: mesesConsiderados.length,
                mesesSemDado: mesesSemDado.length,
                teto: classif.teto,
                sublimite: classif.sublimite,
                // pior faixa entre teto e sublimite — pra ordenacao
                piorFaixa: piorFaixa(classif.teto.faixa, classif.sublimite.faixa),
            });
        });

        // Ordena: ultrapassou > critico > alerta > ok, depois RBT12 desc
        const rank = { ultrapassou: 0, critico: 1, alerta: 2, ok: 3 };
        empresas.sort((a, b) => {
            const r = rank[a.piorFaixa] - rank[b.piorFaixa];
            if (r !== 0) return r;
            return b.rbt12 - a.rbt12;
        });

        const resumo = {
            totalEmpresas: empresas.length,
            ultrapassouTeto: empresas.filter((e) => e.teto.faixa === 'ultrapassou').length,
            ultrapassouSublimite: empresas.filter((e) => e.sublimite.faixa === 'ultrapassou').length,
            criticosTeto: empresas.filter((e) => e.teto.faixa === 'critico').length,
            criticosSublimite: empresas.filter((e) => e.sublimite.faixa === 'critico').length,
            alertasTeto: empresas.filter((e) => e.teto.faixa === 'alerta').length,
            alertasSublimite: empresas.filter((e) => e.sublimite.faixa === 'alerta').length,
        };

        return res.json({
            mesReferencia: mesReferencia || null,
            limites: { teto: LIMITE_TETO_SIMPLES, sublimite: LIMITE_SUBLIMITE_ICMS_ISS },
            resumo,
            empresas,
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[simples-sublimite]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

function piorFaixa(a, b) {
    const rank = { ultrapassou: 0, critico: 1, alerta: 2, ok: 3 };
    return rank[a] <= rank[b] ? a : b;
}

export default router;
