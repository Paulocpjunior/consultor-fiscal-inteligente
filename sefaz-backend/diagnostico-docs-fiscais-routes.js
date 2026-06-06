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

// POST /merge-duplicatas
// Body: { dryRun?: boolean, empresaId?: string }
// Pra cada chave que aparece em 2+ docs, escolhe um "vencedor" (mais recente
// por ultimaSincronizacao; tie-break por docId mais longo = mais informacao) e
// marca os perdedores com _merged_into: <docIdVencedor> + _merged_at + _merged_by.
// NAO deleta — preserva auditoria. So admin. dryRun=true (default) so simula.
router.post('/merge-duplicatas', requireAuth, express.json(), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });
        const dryRun = req.body?.dryRun !== false; // default true — exige opt-in pra escrever
        const { empresaId } = req.body || {};

        const db = fa().firestore();
        let query = db.collection('documentos_fiscais');
        if (empresaId) query = query.where('empresaId', '==', empresaId);
        const docs = await fetchAllDocs(query, { label: 'diagnostico/merge-duplicatas' });

        // Agrupa por chave (so docs com chave valida e que nao sao perdedores ja marcados)
        const porChave = new Map();
        for (const d of docs) {
            const x = d.data() || {};
            if (x._merged_into) continue; // ja marcado em pass anterior
            const chave = String(x.chave || x.chaveAcesso || '').replace(/\D/g, '');
            if (chave.length !== 44) continue;
            const arr = porChave.get(chave) || [];
            arr.push({ docId: d.id, ref: d.ref, data: x });
            porChave.set(chave, arr);
        }

        // Decide vencedor + perdedores
        const planoMerge = []; // { chave, vencedor, perdedores: [...] }
        for (const [chave, grupo] of porChave) {
            if (grupo.length < 2) continue;
            // Vencedor: maior ultimaSincronizacao (string ISO) ou docId mais longo
            grupo.sort((a, b) => {
                const sa = String(a.data.ultimaSincronizacao || '');
                const sb = String(b.data.ultimaSincronizacao || '');
                if (sa !== sb) return sb.localeCompare(sa);
                return (b.docId.length - a.docId.length) || b.docId.localeCompare(a.docId);
            });
            const [vencedor, ...perdedores] = grupo;
            planoMerge.push({
                chave,
                vencedor: vencedor.docId,
                perdedores: perdedores.map((p) => p.docId),
                perdedoresRefs: perdedores.map((p) => p.ref),
            });
        }

        let aplicados = 0;
        if (!dryRun) {
            // Aplica em lotes de 450 (margem do limite 500 do Firestore)
            const updates = planoMerge.flatMap((p) =>
                p.perdedoresRefs.map((ref) => ({ ref, vencedor: p.vencedor })),
            );
            for (let i = 0; i < updates.length; i += 450) {
                const slice = updates.slice(i, i + 450);
                const batch = db.batch();
                for (const u of slice) {
                    batch.update(u.ref, {
                        _merged_into: u.vencedor,
                        _merged_at: admin.firestore.FieldValue.serverTimestamp(),
                        _merged_by: req.user.email,
                    });
                }
                try {
                    await batch.commit();
                    aplicados += slice.length;
                } catch (e) {
                    console.warn('[diagnostico/merge] batch falhou:', e.message);
                }
            }
        }

        return res.json({
            dryRun,
            chavesComDuplicata: planoMerge.length,
            totalPerdedores: planoMerge.reduce((acc, p) => acc + p.perdedores.length, 0),
            aplicados,
            // amostra (max 100) pra UI mostrar o plano
            amostra: planoMerge.slice(0, 100).map((p) => ({ chave: p.chave, vencedor: p.vencedor, perdedores: p.perdedores })),
            empresaId: empresaId || null,
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[diagnostico/merge-duplicatas]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

export default router;
