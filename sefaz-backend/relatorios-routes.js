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
import { direcaoEfetivaDoc, docCancelado } from './xml-metadata-helper.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

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
                // eventos/cStat no select: o cancelamento pode estar só no
                // evento (status torto) — docCancelado decide na leitura.
                .select('empresaId', 'direcao', 'tpNF', 'status', 'valorTotal', 'eventos', 'cStat'),
            { label: `relatorio-faturamento ${competencia}`, maxDocs: 80000 },
        );
        let ignoradosSemEmpresa = 0;
        for (const s of snaps) {
            const d = s.data() || {};
            const emp = empresas.get(d.empresaId);
            if (!emp) { ignoradosSemEmpresa++; continue; }
            if (docCancelado(d)) continue;
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

// ────────────────────────────────────────────────────────────────────────────
// GET /api/admin/relatorios/faturamento-mensal?empresaId=&de=AAAA-MM&ate=AAAA-MM
//
// Fonte da Declaração de Faturamento (documento assinado, Paulo 05/08). Mesma
// RÉGUA do relatório de faturamento acima — saídas autorizadas da competência,
// cancelados fora, direção efetiva pelo tpNF — só que por MÊS de uma empresa.
// Não inventa conta própria: se os dois números divergirem um dia, é bug de um
// só lugar.
//
// Farol honesto: `docs` por mês vai no payload, porque mês com ZERO documentos
// não é o mesmo que mês sem faturamento — e isso vai num papel assinado.
// ────────────────────────────────────────────────────────────────────────────
router.get('/faturamento-mensal', requireAuth, async (req, res) => {
    try {
        const empresaId = String(req.query.empresaId || '').trim();
        const de = String(req.query.de || '').trim();
        const ate = String(req.query.ate || '').trim();
        if (!empresaId) return res.status(400).json({ ok: false, error: 'Informe a empresa.' });
        if (!/^\d{4}-\d{2}$/.test(de) || !/^\d{4}-\d{2}$/.test(ate)) {
            return res.status(400).json({ ok: false, error: 'Informe o período no formato AAAA-MM.' });
        }

        const idsCarteira = await getEmpresaIdsDaCarteira(req.user); // null = admin
        if (idsCarteira && !idsCarteira.includes(empresaId)) {
            return res.status(403).json({ ok: false, error: 'Empresa fora da sua carteira.' });
        }

        const meses = [];
        const [aA, aM] = de.split('-').map(Number);
        const [bA, bM] = ate.split('-').map(Number);
        const ini = aA * 12 + (aM - 1);
        const fim = bA * 12 + (bM - 1);
        if (fim < ini) return res.status(400).json({ ok: false, error: 'O mês inicial é posterior ao final.' });
        if (fim - ini >= 60) return res.status(400).json({ ok: false, error: 'Período máximo de 60 meses.' });
        for (let i = ini; i <= fim; i++) {
            meses.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
        }

        const db = getDb();
        const porMes = {};
        for (const competencia of meses) {
            const snaps = await fetchAllDocs(
                db.collection('documentos_fiscais')
                    .where('empresaId', '==', empresaId)
                    .where('competencia', '==', competencia)
                    .select('direcao', 'tpNF', 'status', 'valorTotal', 'tipo', 'tipoDoc', 'eventos', 'cStat'),
                { label: `declaracao-faturamento ${empresaId} ${competencia}`, maxDocs: 20000 },
            );
            let valor = 0;
            let docs = 0;
            for (const s of snaps) {
                const d = s.data() || {};
                if (docCancelado(d)) continue;
                if (direcaoEfetivaDoc(d) !== 'saida') continue;
                valor = r2(valor + (Number(d.valorTotal) || 0));
                docs++;
            }
            porMes[competencia] = { valor, docs, lidos: snaps.length };
        }

        return res.json({ ok: true, empresaId, de, ate, meses, porMes, geradoEm: new Date().toISOString() });
    } catch (e) {
        console.error('[relatorios/faturamento-mensal]', e);
        return res.status(500).json({ ok: false, error: `Falha ao apurar o faturamento mensal: ${e.message}` });
    }
});

export default router;
