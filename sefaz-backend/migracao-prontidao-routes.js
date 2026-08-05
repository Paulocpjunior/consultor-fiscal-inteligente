// ============================================================================
// sefaz-backend/migracao-prontidao-routes.js  (ESM)
//
// GET /api/admin/sped/prontidao-migracao?competencia=AAAA-MM
//
// F0 automático: uma leitura de documentos_fiscais da competência (campos
// mínimos) + cadastro das empresas → prontidão de migração por empresa e
// candidatos a piloto (núcleo puro migracao-prontidao.js). Mesma régua da
// rota de faturamento: server-side pra não esbarrar no teto de list do
// front; farol honesto no payload (lidos/ignorados).
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { montarProntidaoMigracao } from './migracao-prontidao.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

router.get('/prontidao-migracao', requireAuth, async (req, res) => {
    try {
        const competencia = String(req.query.competencia || '').trim();
        if (!/^\d{4}-\d{2}$/.test(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });
        }
        const db = getDb();

        const empresas = [];
        for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
            const snap = await db.collection(col).get();
            snap.forEach((doc) => {
                const d = doc.data() || {};
                if (d._deleted || d._merged_into) return;
                const df = d.dadosFiscais || {};
                empresas.push({
                    id: doc.id,
                    nome: d.razaoSocial || d.nome || d.fantasia || '—',
                    cnpj: d.cnpj,
                    regime,
                    uf: df.uf || d.uf || '',
                    // Sem IE a empresa NÃO é contribuinte de ICMS e não
                    // entrega EFD ICMS/IPI — logo não é alvo da migração do
                    // SPED Fiscal (Paulo, 05/08). É o que separa a carteira.
                    inscricaoEstadual: df.inscricaoEstadual || d.inscricaoEstadual || '',
                    industriaCadastro: df.indAtividade === 'industrial' || df.naturezaAtividade === 'industria',
                });
            });
        }

        const snaps = await fetchAllDocs(
            db.collection('documentos_fiscais')
                .where('competencia', '==', competencia)
                // `tipoDoc` classifica CT-e/NFS-e (cobertura documental) e
                // `itens` é o que dá o CFOP 6107/6108 do E310 — sem ele o
                // detector NÃO reporta zero, reporta "não apurado".
                // O documento vem em DUAS formas: captura SEFAZ grava
                // ACHATADO (cnpjEmit/ufEmit), importação de XML grava OBJETO
                // (emitente.*). Pedir só o objeto na projeção fazia o núcleo
                // ver "a empresa nunca é a emitente" e zerar emissão própria,
                // ST em saída, IPI, E310 e compra interestadual (05/08).
                .select('empresaId', 'direcao', 'tpNF', 'status', 'modelo', 'tipoDoc',
                    'totais.vST', 'totais.vBCST', 'totais.vIPI',
                    'emitente.cnpjCpf', 'emitente.uf', 'cnpjEmit', 'ufEmit',
                    'chave', 'codMunEmit', 'itens'),
            { label: `prontidao-migracao ${competencia}`, maxDocs: 80000 },
        );
        const docs = snaps.map((s) => ({ ...s.data() }));

        const resultado = montarProntidaoMigracao(docs, empresas);
        return res.json({
            ok: true,
            competencia,
            lidos: snaps.length,
            ...resultado,
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[sped/prontidao-migracao]', e);
        return res.status(500).json({ ok: false, error: `Falha ao montar a prontidão: ${e.message}` });
    }
});

export default router;
