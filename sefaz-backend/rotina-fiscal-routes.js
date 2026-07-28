// ============================================================================
// sefaz-backend/rotina-fiscal-routes.js  (ESM)
// ----------------------------------------------------------------------------
// GET /api/admin/rotina-fiscal/painel?competencia=AAAA-MM
//
// O TRILHO do mês, por cliente: captura → validação → apuração → obrigações →
// guias. Junta as quatro fontes reais numa leitura só (nada por empresa, senão
// seriam ~400 idas ao Firestore) e devolve, pra cada empresa, em que etapa ela
// está parada e QUAL é o próximo passo.
//
// Colaborador vê a própria carteira; admin vê tudo. A regra de quem está em
// cada etapa vive em rotina-fiscal.js (puro, testado) — aqui é só I/O.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { getEmpresaIdsDaCarteira } from './carteira-auth.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { montarRotinaFiscal, resumirFunil, acharApuracaoDaCompetencia } from './rotina-fiscal.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

/** 'AAAA-MM' → 'MM/AAAA' (formato que as tarefas usam desde o cron mensal). */
const competenciaTarefa = (c) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(c || ''));
    return m ? `${m[2]}/${m[1]}` : null;
};

const competenciaAtual = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Empresas monitoradas (Simples + Lucro) COM os campos de apuração.
 * Pula lápide (_deleted) e fundidas (_merged_into) — regra permanente.
 */
async function carregarEmpresas(db) {
    const out = [];
    for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
        const snap = await db.collection(col).get();
        snap.forEach((doc) => {
            const d = doc.data() || {};
            if (d._deleted || d._merged_into) return;
            const cnpj = soDigitos(d.cnpj);
            if (cnpj.length !== 14) return;
            out.push({
                id: doc.id,
                cnpj,
                nome: d.razaoSocial || d.nome || d.fantasia || '—',
                regime,
                capturaAtiva: d.capturarSefaz !== false,
                // usados só pra achar a prova da apuração da competência
                fichaFinanceira: d.fichaFinanceira || null,
                faturamentoManual: d.faturamentoManual || null,
                faturamentoMensalDetalhado: d.faturamentoMensalDetalhado || null,
            });
        });
    }
    return out;
}

/** Agrupa uma lista por empresaId, com fallback pelo CNPJ (docs sem dono). */
function agrupar(itens, porCnpjToId) {
    const mapa = new Map();
    for (const it of itens) {
        let id = it.empresaId || null;
        if (!id) {
            const cnpj = soDigitos(it.empresaCnpj || it.cnpjDest || it.cnpjEmit);
            id = porCnpjToId.get(cnpj) || null;
        }
        if (!id) continue;
        const lista = mapa.get(id) || [];
        lista.push(it);
        mapa.set(id, lista);
    }
    return mapa;
}

router.get('/painel', requireAuth, async (req, res) => {
    try {
        const competencia = /^\d{4}-\d{2}$/.test(String(req.query.competencia || ''))
            ? String(req.query.competencia)
            : competenciaAtual();
        const db = getDb();

        const idsCarteira = await getEmpresaIdsDaCarteira(req.user); // null = admin
        let empresas = await carregarEmpresas(db);
        if (idsCarteira) {
            const permitidos = new Set(idsCarteira);
            empresas = empresas.filter((e) => permitidos.has(e.id));
        }
        // Recorte opcional (o painel também abre pra uma empresa só).
        const filtroIds = String(req.query.empresaIds || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (filtroIds.length) {
            const alvo = new Set(filtroIds);
            empresas = empresas.filter((e) => alvo.has(e.id));
        }

        const porCnpjToId = new Map(empresas.map((e) => [e.cnpj, e.id]));

        // ── documentos da competência (uma leitura, campos mínimos) ──────────
        const docsSnaps = await fetchAllDocs(
            db.collection('documentos_fiscais')
                .where('competencia', '==', competencia)
                .select('empresaId', 'empresaCnpj', 'cnpjDest', 'cnpjEmit', 'direcao', 'status',
                    'valorTotal', 'temItens', 'schema', 'tipoDoc', 'chave'),
            { label: `rotina-fiscal ${competencia}`, maxDocs: 60000 },
        );
        const documentos = docsSnaps.map((s) => s.data() || {});

        // ── tarefas da competência (formato MM/AAAA) ────────────────────────
        const compTarefa = competenciaTarefa(competencia);
        const tarefasSnaps = await fetchAllDocs(
            db.collection('tarefas').where('competencia', '==', compTarefa),
            { label: `rotina-tarefas ${compTarefa}`, maxDocs: 20000 },
        );
        const tarefas = tarefasSnaps.map((s) => s.data() || {});

        // ── envios do rito (#293) — sem índice por competência, filtra aqui ──
        const enviosSnap = await db.collection('impostos_enviados').limit(3000).get();
        const envios = enviosSnap.docs
            .map((d) => d.data() || {})
            .filter((e) => e.competencia === competencia);

        const docsPorEmpresa = agrupar(documentos, porCnpjToId);
        const tarefasPorEmpresa = agrupar(tarefas, porCnpjToId);
        const enviosPorEmpresa = agrupar(envios, porCnpjToId);

        const rotinas = empresas.map((e) => montarRotinaFiscal({
            empresa: { id: e.id, nome: e.nome, cnpj: e.cnpj, regime: e.regime },
            competencia,
            documentos: docsPorEmpresa.get(e.id) || [],
            apuracao: acharApuracaoDaCompetencia(e, competencia),
            tarefas: tarefasPorEmpresa.get(e.id) || [],
            envios: enviosPorEmpresa.get(e.id) || [],
            capturaAtiva: e.capturaAtiva,
        }));

        // Ordem de trabalho: quem está mais atrás aparece primeiro — é a fila
        // do dia, não uma lista alfabética.
        rotinas.sort((a, b) => {
            const oa = a.proximoPasso?.ordem ?? 99;
            const ob = b.proximoPasso?.ordem ?? 99;
            if (oa !== ob) return oa - ob;
            return String(a.empresa?.nome || '').localeCompare(String(b.empresa?.nome || ''), 'pt-BR');
        });

        return res.json({
            ok: true,
            competencia,
            escopo: idsCarteira ? 'carteira' : 'todas',
            funil: resumirFunil(rotinas),
            rotinas,
            lidos: { documentos: documentos.length, tarefas: tarefas.length, envios: envios.length },
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[rotina-fiscal/painel]', e);
        return res.status(500).json({ ok: false, error: `Falha ao montar a rotina: ${e.message}` });
    }
});

export default router;
