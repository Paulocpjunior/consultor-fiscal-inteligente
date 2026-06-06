// ============================================================================
// sefaz-backend/diagnostico-docs-fiscais-routes.js  (ESM)
//
// Diagnóstico de SAÚDE dos documentos_fiscais: detecta notas com campos
// faltando ou inválidos que quebram o gerador SPED, o cruzamento, ou geram
// "fantasmas" no painel. Cinco categorias:
//
//   sem_chave       chave ausente ou != 44 digitos
//   sem_competencia competencia ausente ou fora do padrao YYYY-MM
//   sem_direcao     direcao ausente
//   sem_valor       valorTotal nulo ou = 0
//   sem_empresa     empresaCnpj/empresaId vazio
//   duplicada       mesma chave em 2+ docs (cross-path inconsistency)
//
// So admin. Roda a varredura sob demanda — pesa Firestore reads, entao
// expoe um filtro empresaId opcional pra restringir.
// Montado em: /api/admin/diagnostico-docs-fiscais
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { fetchAllDocs } from './firestore-paginate.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

const MAX_AMOSTRAS = 50;

router.get('/', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });
        const { empresaId } = req.query;

        const db = fa().firestore();
        let query = db.collection('documentos_fiscais');
        if (empresaId) query = query.where('empresaId', '==', empresaId);

        const docs = await fetchAllDocs(query, { label: 'diagnostico-docs-fiscais' });

        const problemas = {
            sem_chave: { count: 0, amostras: [] },
            sem_competencia: { count: 0, amostras: [] },
            sem_direcao: { count: 0, amostras: [] },
            sem_valor: { count: 0, amostras: [] },
            sem_empresa: { count: 0, amostras: [] },
            duplicada: { count: 0, amostras: [] },
        };

        // Indexa por chave pra detectar duplicatas (chave em 2+ docIds)
        const porChave = new Map(); // chave -> [docId, ...]

        for (const d of docs) {
            const dados = d.data() || {};
            const docId = d.id;
            const chave = String(dados.chave || dados.chaveAcesso || '').replace(/\D/g, '');
            const competencia = String(dados.competencia || '');
            const direcao = String(dados.direcao || '');
            const valor = Number(dados.valorTotal ?? dados.vNF ?? 0);
            const empresaCnpj = String(dados.empresaCnpj || '').replace(/\D/g, '');
            const empresaId2 = String(dados.empresaId || '');
            const empresaNome = String(dados.empresaNome || dados.empresa || '');

            const ref = { docId, chave: chave || null, competencia: competencia || null, direcao: direcao || null, valor, empresaCnpj, empresaNome };

            if (chave.length !== 44) {
                problemas.sem_chave.count++;
                if (problemas.sem_chave.amostras.length < MAX_AMOSTRAS) problemas.sem_chave.amostras.push(ref);
            } else {
                const lista = porChave.get(chave) || [];
                lista.push(docId);
                porChave.set(chave, lista);
            }
            if (!/^\d{4}-\d{2}$/.test(competencia)) {
                problemas.sem_competencia.count++;
                if (problemas.sem_competencia.amostras.length < MAX_AMOSTRAS) problemas.sem_competencia.amostras.push(ref);
            }
            if (direcao !== 'entrada' && direcao !== 'saida') {
                problemas.sem_direcao.count++;
                if (problemas.sem_direcao.amostras.length < MAX_AMOSTRAS) problemas.sem_direcao.amostras.push(ref);
            }
            if (!Number.isFinite(valor) || valor <= 0) {
                problemas.sem_valor.count++;
                if (problemas.sem_valor.amostras.length < MAX_AMOSTRAS) problemas.sem_valor.amostras.push(ref);
            }
            if (empresaCnpj.length !== 14 || !empresaId2) {
                problemas.sem_empresa.count++;
                if (problemas.sem_empresa.amostras.length < MAX_AMOSTRAS) problemas.sem_empresa.amostras.push(ref);
            }
        }

        // 2a passada: detecta chaves duplicadas (cross-path inconsistency)
        for (const [chave, docIds] of porChave) {
            if (docIds.length < 2) continue;
            problemas.duplicada.count += docIds.length;
            if (problemas.duplicada.amostras.length < MAX_AMOSTRAS) {
                problemas.duplicada.amostras.push({ chave, docIds, qtd: docIds.length });
            }
        }

        const totalProblemas = Object.values(problemas).reduce((acc, p) => acc + p.count, 0);

        return res.json({
            empresaIdFiltro: empresaId || null,
            totalDocs: docs.length,
            totalProblemas,
            problemas,
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[diagnostico-docs-fiscais]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

export default router;
