// ============================================================================
// sefaz-backend/relatorios-routes.js  (ESM)
// ----------------------------------------------------------------------------
// GET /api/admin/relatorios/faturamento?competencia=AAAA-MM
//
// Fonte do relatório "Faturamento por cliente/carteira" (menu Relatórios,
// Paulo 01/08). Agregação SERVER-SIDE: uma leitura de documentos_fiscais da
// competência (campos mínimos) agrupada em memória por empresa + o vínculo da
// carteira. No front isso esbarraria no teto de list (5000) e viraria número
// silenciosamente incompleto.
//
// Colaborador vê a própria carteira; admin vê tudo (mesma régua do painel da
// Rotina). Farol honesto: se a leitura truncar, o payload DIZ.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { getEmpresaIdsDaCarteira } from './carteira-auth.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { direcaoEfetivaDoc } from './xml-metadata-helper.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const CANCELADOS = new Set(['cancelado', 'cancelada', 'denegado', 'inutilizado']);

router.get('/faturamento', requireAuth, async (req, res) => {
    try {
        const competencia = String(req.query.competencia || '').trim();
        if (!/^\d{4}-\d{2}$/.test(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });
        }
        const db = getDb();
        const idsCarteira = await getEmpresaIdsDaCarteira(req.user); // null = admin

        // ── Empresas (nome/regime) + vínculo principal da carteira ──────────
        const empresas = new Map();
        for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
            const snap = await db.collection(col).get();
            snap.forEach((doc) => {
                const d = doc.data() || {};
                if (d._deleted || d._merged_into) return;
                if (idsCarteira && !idsCarteira.includes(doc.id)) return;
                empresas.set(doc.id, {
                    empresaId: doc.id,
                    nome: d.razaoSocial || d.nome || d.fantasia || '—',
                    cnpj: soDigitos(d.cnpj),
                    regime,
                    colaborador: null,
                    entradasQtd: 0, entradasValor: 0, saidasQtd: 0, saidasValor: 0,
                });
            });
        }

        const cartSnap = await db.collection('carteiras').get();
        cartSnap.forEach((doc) => {
            const v = doc.data() || {};
            const emp = empresas.get(v.empresaId);
            if (!emp) return;
            // Principal vence; backup só preenche se não houver principal.
            if ((v.papel || 'principal') === 'principal' || !emp.colaborador) {
                emp.colaborador = v.colaboradorNome || emp.colaborador;
            }
        });

        // ── Documentos da competência (campos mínimos, direção efetiva) ─────
        const snaps = await fetchAllDocs(
            db.collection('documentos_fiscais')
                .where('competencia', '==', competencia)
                .select('empresaId', 'direcao', 'tpNF', 'status', 'valorTotal'),
            { label: `relatorio-faturamento ${competencia}`, maxDocs: 80000 },
        );
        let ignoradosSemEmpresa = 0;
        for (const s of snaps) {
            const d = s.data() || {};
            const emp = empresas.get(d.empresaId);
            if (!emp) { ignoradosSemEmpresa++; continue; }
            if (CANCELADOS.has(d.status)) continue;
            const direcao = direcaoEfetivaDoc(d);
            const valor = Number(d.valorTotal) || 0;
            if (direcao === 'saida') { emp.saidasQtd++; emp.saidasValor = r2(emp.saidasValor + valor); }
            else if (direcao === 'entrada') { emp.entradasQtd++; emp.entradasValor = r2(emp.entradasValor + valor); }
        }

        // Só empresas com movimento OU com carteira — a lista completa de 393
        // zeradas não é relatório, é ruído.
        const linhas = Array.from(empresas.values())
            .filter((e) => e.entradasQtd + e.saidasQtd > 0)
            .sort((a, b) => (b.saidasValor - a.saidasValor) || (b.entradasValor - a.entradasValor));

        const totais = linhas.reduce((t, e) => ({
            empresas: t.empresas + 1,
            entradasQtd: t.entradasQtd + e.entradasQtd,
            entradasValor: r2(t.entradasValor + e.entradasValor),
            saidasQtd: t.saidasQtd + e.saidasQtd,
            saidasValor: r2(t.saidasValor + e.saidasValor),
        }), { empresas: 0, entradasQtd: 0, entradasValor: 0, saidasQtd: 0, saidasValor: 0 });

        return res.json({
            ok: true,
            competencia,
            escopo: idsCarteira ? 'carteira' : 'todas',
            linhas,
            totais,
            semMovimento: empresas.size - linhas.length,
            ignoradosSemEmpresa,
            lidos: snaps.length,
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[relatorios/faturamento]', e);
        return res.status(500).json({ ok: false, error: `Falha ao montar o faturamento: ${e.message}` });
    }
});

export default router;
