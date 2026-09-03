// ============================================================================
// sefaz-backend/das-routes.js
// Express router pra DAS Simples Nacional.
// Montado em /api/admin/das pelo server.js raiz.
// ============================================================================

import express from 'express';
import { requireAuth, requireEmissao, requireAdmin } from './require-admin.js';
import admin from 'firebase-admin';
import { ultimasCompetencias as ultimasCompetenciasHelper } from './competencias-helper.js';
import {
    emitirDasRegular, emitirDasAvulso, declararPgdasSemMovimento,
    listarDas, getResumoDas, getDasPdf, marcarPago,
    processarCronDas, sondarFormaSemMovimento } from './das-orchestrator.js';
import { getDasMode, getDasProvider } from './das-provider.js';
import { errorPayload } from './das-error-payload.js';
import { podeAcessarEmpresaId, podeAcessarCnpj } from './carteira-auth.js';
import { secretsMatch } from './cron-secret.js';
import {
    validarIdAtividadeSup, lerCodigoAtividadeSup, gravarCodigoAtividadeSup,
} from './pgdas-atividade-config.js';
export { errorPayload } from './das-error-payload.js';

const CRON_SECRET = process.env.SEFAZ_CRON_SECRET || '';

const router = express.Router();

// requireEmissao/requireAuth vem do middleware compartilhado (verifyIdToken).
// Emissao: admin OU colaborador com permissao 'Central de Emissões' liberada.

router.get('/status', requireAuth, (_req, res) => {
    res.json({ mode: getDasMode(), ok: true });
});

// Resumo consolidado (todas as empresas) — so admin. Colaborador ve por
// empresa via /listar?empresaId=... (checado contra a carteira).
router.get('/resumo', requireAuth, async (req, res) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Resumo consolidado disponivel apenas para admin.' });
    }
    try { res.json(await getResumoDas()); }
    catch (err) {
        console.error('[das/resumo] falhou:', err.stack || err);
        res.status(500).json({ error: `resumo: ${err.message}` });
    }
});

router.get('/listar', requireAuth, async (req, res) => {
    const { empresaId } = req.query;
    // Com empresaId: exige que pertenca a carteira do colaborador (admin passa).
    // Sem empresaId (listagem global): so admin.
    if (empresaId) {
        const c = await podeAcessarEmpresaId(req.user, empresaId);
        if (!c.ok) return res.status(c.status).json({ error: c.error });
    } else if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Informe o empresaId da sua carteira para listar.' });
    }
    try {
        res.json(await listarDas({
            empresaId,
            competencia: req.query.competencia,
            status: req.query.status,
        }));
    } catch (err) {
        console.error('[das/listar] falhou:', err.stack || err);
        res.status(500).json({ error: `listar: ${err.message}` });
    }
});

// PDF de UM DAS sob demanda — a listagem não carrega mais o base64 (memória).
router.get('/pdf', requireAuth, async (req, res) => {
    try {
        const doc = await getDasPdf(req.query.id);
        if (!doc) return res.status(404).json({ error: 'DAS não encontrado.' });
        if (doc.empresaId) {
            const c = await podeAcessarEmpresaId(req.user, doc.empresaId);
            if (!c.ok) return res.status(c.status).json({ error: c.error });
        } else if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Sem acesso a este DAS.' });
        }
        res.json({ pdfBase64: doc.pdfBase64, pdfUrl: doc.pdfUrl });
    } catch (err) {
        console.error('[das/pdf] falhou:', err.stack || err);
        res.status(500).json({ error: `pdf: ${err.message}` });
    }
});

// Atividades de uma declaração PGDAS-D JÁ transmitida (consulta, não declara).
// Descobre o número oficial de uma atividade que o app ainda não mapeia lendo o
// que a própria empresa declarou — caso S&P/ISS fixo do escritório contábil.
router.get('/atividades-declaradas', requireAuth, async (req, res) => {
    const cnpj = String(req.query.cnpj || '').replace(/\D/g, '');
    const competencia = String(req.query.competencia || '');
    if (cnpj.length !== 14 || !/^\d{4}-?\d{2}$/.test(competencia)) {
        return res.status(400).json({ error: 'Informe cnpj (14 dígitos) e competencia (AAAA-MM).' });
    }
    const c = await podeAcessarCnpj(req.user, cnpj);
    if (!c.ok) return res.status(c.status).json({ error: c.error });
    try {
        const provider = getDasProvider();
        if (typeof provider.consultarAtividadesDeclaradas !== 'function') {
            return res.status(400).json({ error: 'Consulta disponível apenas no modo serpro.' });
        }
        res.json(await provider.consultarAtividadesDeclaradas({ empresaCnpj: cnpj, competencia }));
    } catch (err) {
        console.error('[das/atividades-declaradas] falhou:', err.stack || err);
        const semDeclaracao = /n[aã]o.*encontrad|404|sem.*declarac/i.test(err.message || '');
        res.status(semDeclaracao ? 404 : 500).json({
            error: semDeclaracao
                ? `Não há declaração transmitida para ${competencia} nesta empresa — tente outra competência.`
                : `atividades-declaradas: ${err.message}`,
        });
    }
});

// Código da atividade "ISS fixo (SUP)". Enquanto não existir, o DAS dessas
// receitas fica bloqueado — e destravar NÃO pode depender de deploy.
router.get('/atividade-iss-fixo', requireAuth, async (_req, res) => {
    try {
        if (admin.apps.length === 0) {
            admin.initializeApp({ credential: admin.credential.applicationDefault() });
        }
        const cfg = await lerCodigoAtividadeSup(admin.firestore());
        res.json({ cadastrado: !!cfg, ...(cfg || { idAtividade: null }) });
    } catch (err) {
        res.status(500).json({ error: `atividade-iss-fixo: ${err.message}` });
    }
});

router.put('/atividade-iss-fixo', requireAuth, express.json(), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({
                error: 'Só administrador cadastra código de atividade — o número vale pra todas as '
                    + 'empresas e vai na declaração ao SERPRO.',
            });
        }
        const { id, origem, cnpjOrigem, competenciaOrigem, idsDeclarados } = req.body || {};
        const v = validarIdAtividadeSup(id, { origem, idsDeclarados });
        if (!v.ok) return res.status(400).json({ error: v.erro });

        if (admin.apps.length === 0) {
            admin.initializeApp({ credential: admin.credential.applicationDefault() });
        }
        const doc = await gravarCodigoAtividadeSup(admin.firestore(), {
            id: v.id,
            origem,
            cnpjOrigem: String(cnpjOrigem || '').replace(/\D/g, '') || null,
            competenciaOrigem: competenciaOrigem || null,
            usuario: req.user?.email || req.user?.uid || null,
        });
        res.json({ ok: true, ...doc });
    } catch (err) {
        res.status(500).json({ error: `atividade-iss-fixo: ${err.message}` });
    }
});

router.post('/emitir-regular', requireEmissao, express.json(), async (req, res) => {
    try { res.json(await emitirDasRegular(req.body)); }
    catch (err) { res.status(err.httpStatus || 400).json(errorPayload(err)); }
});

// PGDAS-D de mês SEM MOVIMENTO: transmite a declaração e NÃO gera guia.
// A declaração vence todo mês (MAED de R$ 50,00 se não entregar); a guia só
// existe se houver o que pagar. Antes disto, mês sem faturamento não tinha
// caminho no app e ia pro e-CAC à mão.
router.post('/declarar-sem-movimento', requireEmissao, express.json(), async (req, res) => {
    try {
        res.json(await declararPgdasSemMovimento({
            ...req.body,
            confirmadoPor: req.user?.email || req.user?.uid || null,
        }));
    } catch (err) { res.status(err.httpStatus || 400).json(errorPayload(err)); }
});

// SONDA da forma do "sem movimento" — pergunta ao SERPRO qual estrutura ele
// aceita usando o modo VALIDAÇÃO do TRANSDECLARACAO11 (indicadorTransmissao
// false). NADA é transmitido em nenhum desfecho, e o núcleo recusa rodar se
// alguém mexer nisso.
//
// requireAdmin (e não requireEmissao): a sonda gasta chamada paga do SERPRO e
// serve pra DESTRAVAR um bloqueio, não pra operar o mês.
router.post('/sondar-sem-movimento', requireAdmin, express.json(), async (req, res) => {
    try {
        res.json(await sondarFormaSemMovimento({
            ...req.body,
            rodadoPor: req.user?.email || req.user?.uid || null,
        }));
    } catch (err) { res.status(err.httpStatus || 400).json(errorPayload(err)); }
});

router.post('/emitir-avulso', requireEmissao, express.json(), async (req, res) => {
    try { res.json(await emitirDasAvulso(req.body)); }
    catch (err) { res.status(err.httpStatus || 400).json(errorPayload(err)); }
});

router.post('/marcar-pago', requireEmissao, express.json(), async (req, res) => {
    try {
        const { docId, dataPagamento } = req.body;
        if (!docId) return res.status(400).json({ error: 'docId obrigatorio' });
        res.json(await marcarPago(docId, dataPagamento));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /cobertura-pgdas?meses=6
// Pra cada empresa Simples ativa, lista as competencias dos ultimos N meses
// onde NAO ha das_emitidos. Esse e o gap classico: contador esquece de
// transmitir o PGDAS-D de uma empresa e a Receita autua automaticamente.
// Default: ultimos 6 meses. Maximo: 24. So admin.
router.get('/cobertura-pgdas', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });
        const meses = Math.min(Math.max(Number(req.query.meses || 6), 1), 24);
        const competencias = ultimasCompetencias(meses);

        if (admin.apps.length === 0) {
            admin.initializeApp({ credential: admin.credential.applicationDefault() });
        }
        const db = admin.firestore();

        // 1. Empresas Simples ativas (ignora _merged_into)
        const simplesSnap = await db.collection('simples_empresas').get();
        const empresas = [];
        simplesSnap.forEach((doc) => {
            const d = doc.data();
            if (d._merged_into || d._deleted) return;
            const cnpj = (d.cnpj || '').replace(/\D/g, '');
            if (cnpj.length !== 14) return;
            empresas.push({ id: doc.id, cnpj, nome: d.razaoSocial || d.nome || '' });
        });

        // 2. DAS emitidos das competencias relevantes (chunks de 10 — limite do 'in')
        const dasMap = new Map(); // empresaId|competencia -> { valor, statusPagamento }
        const chunksFalhos = []; // competencias cujo chunk falhou — UI mostra "leitura parcial"
        for (let i = 0; i < competencias.length; i += 10) {
            const chunk = competencias.slice(i, i + 10);
            try {
                const snap = await db.collection('das_emitidos')
                    .where('competencia', 'in', chunk).get();
                snap.forEach((d) => {
                    const x = d.data();
                    const k = `${x.empresaId}|${x.competencia}`;
                    if (!dasMap.has(k)) {
                        dasMap.set(k, { valor: x.valor || 0, statusPagamento: x.statusPagamento || 'pendente' });
                    }
                });
            } catch (e) {
                chunksFalhos.push(...chunk);
                console.warn('[das/cobertura-pgdas] chunk', chunk, 'falhou:', e.message);
            }
        }

        // 3. Monta a matriz empresa x competencia
        const resultado = [];
        let totalGaps = 0;
        let totalVencidos = 0;
        for (const emp of empresas) {
            const mesesArr = competencias.map((comp) => {
                const k = `${emp.id}|${comp}`;
                const das = dasMap.get(k);
                return das
                    ? { competencia: comp, transmitido: true, valor: das.valor, statusPagamento: das.statusPagamento }
                    : { competencia: comp, transmitido: false };
            });
            const gaps = mesesArr.filter((m) => !m.transmitido).length;
            const vencidos = mesesArr.filter((m) => m.transmitido && m.statusPagamento === 'vencido').length;
            totalGaps += gaps;
            totalVencidos += vencidos;
            resultado.push({ id: emp.id, cnpj: emp.cnpj, nome: emp.nome, gaps, vencidos, meses: mesesArr });
        }

        // ordena: mais gaps primeiro, depois mais vencidos
        resultado.sort((a, b) => (b.gaps - a.gaps) || (b.vencidos - a.vencidos) || (a.nome || '').localeCompare(b.nome || ''));

        return res.json({
            mesesAnalisados: competencias.length,
            competencias,
            totalEmpresas: empresas.length,
            empresasComGap: resultado.filter((e) => e.gaps > 0).length,
            totalGaps,
            totalVencidos,
            // honesto: se algum chunk de mes falhou, marca degraded e lista
            // as competencias que ficaram sem leitura — UI evita "falso vermelho"
            degraded: chunksFalhos.length > 0,
            competenciasIncompletas: Array.from(new Set(chunksFalhos)),
            empresas: resultado,
        });
    } catch (e) {
        console.error('[das/cobertura-pgdas]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

// Reexport pra preservar compatibilidade interna.
// Logica: ultimas N competencias YYYY-MM (decrescente). Mes atual NAO entra —
// PGDAS dele ainda nao venceu (vence dia 20 do seguinte).
function ultimasCompetencias(n) {
    return ultimasCompetenciasHelper(n);
}

// ── Cron noturno (Cloud Scheduler) ─────────────────────────────────────
// Disparado pelo job 'das-cron-noturno' as 03:30 BRT.
router.post('/cron', async (req, res) => {
    const headerSecret = req.header('X-Cron-Secret') || '';
    if (!secretsMatch(headerSecret, CRON_SECRET)) {
        return res.status(403).json({ erro: 'cron secret invalido' });
    }
    const t0 = Date.now();
    try {
        const stats = await processarCronDas();
        const duracaoMs = Date.now() - t0;

        try {
            if (admin.apps.length === 0) {
                admin.initializeApp({ credential: admin.credential.applicationDefault() });
            }
            await admin.firestore().collection('das_cron_logs').add({
                executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                iniciadoEm: new Date(t0).toISOString(),
                duracaoMs,
                ...stats,
            });
        } catch (logErr) {
            console.warn('[das-cron] log falhou:', logErr.message);
        }

        console.log(`[das-cron] OK em ${duracaoMs}ms - totalDas=${stats.totalDas} vencidos=${stats.vencidos} aVencer=${stats.aVencer} atualizados=${stats.atualizadosParaVencido}`);
        return res.json({ ok: true, duracaoMs, ...stats });
    } catch (err) {
        console.error('[das-cron] erro:', err.message);
        return res.status(500).json({ ok: false, erro: err.message });
    }
});

export default router;
