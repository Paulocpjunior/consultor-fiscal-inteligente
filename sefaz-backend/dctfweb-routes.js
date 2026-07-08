// ============================================================================
// sefaz-backend/dctfweb-routes.js
// Router Express. Montado em /api/admin/dctfweb pelo server.js.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { getCnpjsDaCarteira, getEmpresaIdsDaCarteira, podeAcessarCnpj } from './carteira-auth.js';
import {
    sincronizarEmpresa, sincronizarTodasLucro,
    listarDeclaracoes, transmitirDeclaracao, gerarDarf, gerarDarfsSeparados,
    consultarDeclaracaoCompleta, consultarRecibo,
    encerrarApuracaoMit, consultarStatusEncerramentoMit,
    consultarApuracaoMit, consultarApuracoesAno,
    preencherEncerrarMit,
    consultarRetencaoDctfwebNormalizada,
    getResumoGlobal,
} from './dctfweb-orchestrator.js';
import { getDctfwebMode } from './dctfweb-provider.js';
import { normalizarApuracaoMit } from './dctfweb-mit-normalizer.js';
import { requireAuth } from './require-admin.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { ultimasCompetenciasComAnoMes as ultimasCompetenciasComAnoMesHelper } from './competencias-helper.js';

const CRON_SECRET = process.env.SEFAZ_CRON_SECRET || '';
const router = express.Router();

function limparCnpj(value) {
    return String(value || '').replace(/\D/g, '');
}

function nomeEmpresaLucro(data) {
    return data.razaoSocial || data.nome || data.nomeFantasia || '';
}

async function listarEmpresasDctfwebDisponiveis(user) {
    if (admin.apps.length === 0) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    const db = admin.firestore();
    const [cnpjsCarteira, idsCarteira] = await Promise.all([
        getCnpjsDaCarteira(user),
        getEmpresaIdsDaCarteira(user),
    ]);
    const cnpjsSet = cnpjsCarteira ? new Set(cnpjsCarteira) : null;
    const idsSet = idsCarteira ? new Set(idsCarteira) : null;
    const docs = await fetchAllDocs(db.collection('lucro_empresas'), { label: 'dctfweb/empresas' });

    return docs
        .map((doc) => {
            const data = doc.data() || {};
            return {
                id: doc.id,
                nome: nomeEmpresaLucro(data),
                cnpj: limparCnpj(data.cnpj),
                fonte: 'lucro',
                regime: data.regimePadrao || 'Presumido',
                _merged_into: data._merged_into,
            };
        })
        .filter((emp) => !emp._merged_into && emp.cnpj.length === 14)
        .filter((emp) => {
            if (!cnpjsSet && !idsSet) return true;
            return !!(idsSet?.has(emp.id) || cnpjsSet?.has(emp.cnpj));
        })
        .map(({ _merged_into, ...emp }) => emp)
        .sort((a, b) => (a.nome || a.cnpj).localeCompare(b.nome || b.cnpj));
}

async function cnpjsPermitidosParaListagem(user) {
    const cnpjs = await getCnpjsDaCarteira(user);
    return cnpjs ? new Set(cnpjs) : null;
}

router.get('/status', (_req, res) => res.json({ mode: getDctfwebMode(), ok: true }));

router.get('/resumo', requireAuth, async (_req, res) => {
    try { res.json(await getResumoGlobal()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/empresas', requireAuth, async (req, res) => {
    try {
        res.json(await listarEmpresasDctfwebDisponiveis(req.user));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/declaracoes', requireAuth, async (req, res) => {
    try {
        const empresaCnpj = limparCnpj(req.query.empresaCnpj);
        if (empresaCnpj) {
            const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
            if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        }
        const cnpjsPermitidos = empresaCnpj ? null : await cnpjsPermitidosParaListagem(req.user);
        if (cnpjsPermitidos && cnpjsPermitidos.size === 0) return res.json([]);

        const declaracoes = await listarDeclaracoes({
            empresaCnpj: empresaCnpj || undefined,
            situacao: req.query.situacao,
            anoPA: req.query.anoPA ? Number(req.query.anoPA) : undefined,
            mesPA: req.query.mesPA ? Number(req.query.mesPA) : undefined,
        });
        res.json(cnpjsPermitidos
            ? declaracoes.filter((decl) => cnpjsPermitidos.has(limparCnpj(decl.empresaCnpj)))
            : declaracoes);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sincronizar', requireAuth, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj, anoPA, mesPA, categoria } = req.body || {};
        if (!empresaId || !empresaCnpj) return res.status(400).json({ error: 'empresaId+empresaCnpj' });
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await sincronizarEmpresa(empresaId, empresaCnpj, { anoPA, mesPA, categoria }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/transmitir', requireAuth, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj, anoPA, mesPA, categoria } = req.body || {};
        if (!empresaId || !empresaCnpj || !anoPA || !mesPA) return res.status(400).json({ error: 'empresaId+empresaCnpj+anoPA+mesPA' });
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await transmitirDeclaracao({ empresaId, empresaCnpj, anoPA, mesPA, categoria }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/gerar-darf', requireAuth, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj, anoPA, mesPA, categoria, emAndamento } = req.body || {};
        if (!empresaCnpj || !anoPA || !mesPA) return res.status(400).json({ error: 'empresaCnpj+anoPA+mesPA' });
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await gerarDarf({ empresaId, empresaCnpj, anoPA, mesPA, categoria, emAndamento: !!emAndamento }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Guias separadas por vencimento: 1 DARF avulso (SICALC) por débito da
// declaração transmitida — PIS/COFINS no dia 25 antecipado, IRPJ/CSLL
// trimestrais no último dia útil do mês seguinte ao trimestre.
router.post('/gerar-darfs-separados', requireAuth, express.json(), async (req, res) => {
    try {
        const { empresaCnpj, anoPA, mesPA, categoria } = req.body || {};
        if (!empresaCnpj || !anoPA || !mesPA) return res.status(400).json({ error: 'empresaCnpj+anoPA+mesPA' });
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await gerarDarfsSeparados({ empresaCnpj, anoPA, mesPA, categoria }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/declaracao-completa', requireAuth, async (req, res) => {
    try {
        const { empresaCnpj, anoPA, mesPA, categoria } = req.query;
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await consultarDeclaracaoCompleta({ empresaCnpj, anoPA: Number(anoPA), mesPA: Number(mesPA), categoria }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/recibo', requireAuth, async (req, res) => {
    try {
        const { empresaCnpj, anoPA, mesPA, categoria } = req.query;
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await consultarRecibo({ empresaCnpj, anoPA: Number(anoPA), mesPA: Number(mesPA), categoria }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/mit/encerrar', requireAuth, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj, anoPA, mesPA, dadosApuracaoMit } = req.body || {};
        if (!empresaCnpj || !anoPA || !mesPA) return res.status(400).json({ error: 'empresaCnpj+anoPA+mesPA' });
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await encerrarApuracaoMit({ empresaId, empresaCnpj, anoPA, mesPA, dadosApuracaoMit }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Preenche os débitos do MIT com a apuração do APP e (opcionalmente) encerra.
// Duas fases: transmitir=false devolve a PROPOSTA (família/código/valor,
// período-modelo) pra tela de conferência; transmitir=true monta de novo no
// servidor e transmite o ENCAPURACAO314, com log de auditoria. Os códigos de
// débito vêm da última apuração anterior da própria empresa no MIT — nunca
// são chutados de tabela.
router.post('/mit/preencher-encerrar', requireAuth, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj, anoPA, mesPA, tributosApp, transmitir } = req.body || {};
        if (!empresaCnpj || !anoPA || !mesPA) return res.status(400).json({ error: 'empresaCnpj+anoPA+mesPA' });
        if (!tributosApp || typeof tributosApp !== 'object') {
            return res.status(400).json({ error: 'tributosApp {IRPJ,CSLL,PIS,COFINS} é obrigatório' });
        }
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        const r = await preencherEncerrarMit({
            empresaId, empresaCnpj,
            anoPA: Number(anoPA), mesPA: Number(mesPA),
            tributosApp,
            transmitir: transmitir === true,
            usuario: { uid: req.user.uid, email: req.user.email },
        });
        res.json(r);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/mit/status', requireAuth, async (req, res) => {
    try {
        const { empresaCnpj, protocolo, anoPA, mesPA } = req.query;
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await consultarStatusEncerramentoMit({
            empresaCnpj, protocolo,
            anoPA: anoPA ? Number(anoPA) : undefined,
            mesPA: mesPA ? Number(mesPA) : undefined,
        }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/mit/apuracao', requireAuth, async (req, res) => {
    try {
        const { empresaCnpj, anoPA, mesPA } = req.query;
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await consultarApuracaoMit({ empresaCnpj, anoPA: Number(anoPA), mesPA: Number(mesPA) }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Apuracao MIT NORMALIZADA — base do cruzamento DCTFWeb x apuracao do app.
// Devolve { lido, motivo, tributos:{IRPJ,CSLL,PIS,COFINS}, outros }. Se o
// normalizador NAO conseguir ler o response MIT (shape inesperado), lido=false
// e o front mostra "DCTFWeb MIT nao pode ser lido" — NUNCA zeros falsos.
router.get('/mit/apuracao-normalizada', requireAuth, async (req, res) => {
    try {
        const { empresaCnpj, anoPA, mesPA } = req.query;
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        const consulta = await consultarApuracaoMit({ empresaCnpj, anoPA: Number(anoPA), mesPA: Number(mesPA) });
        const norm = normalizarApuracaoMit(consulta?.apuracaoMit);
        res.json({ competencia: `${anoPA}-${String(mesPA).padStart(2, '0')}`, ...norm });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Retencao consolidada NORMALIZADA — base do cruzamento DCTFWeb x EFD-Reinf.
// Devolve { lido, motivo, retencoes:{INSS,IRRF,CSLL,PIS,COFINS}, camposUsados }.
// lido=false (com motivo) quando o XML da declaracao tem shape inesperado —
// NUNCA zeros falsos. Calibra-se a allowlist via serpro-smoke (CONSXMLDECLARACAO).
router.get('/retencao-normalizada', requireAuth, async (req, res) => {
    try {
        const { empresaCnpj, anoPA, mesPA, categoria } = req.query;
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        const r = await consultarRetencaoDctfwebNormalizada({
            empresaCnpj, anoPA: Number(anoPA), mesPA: Number(mesPA), categoria,
        });
        res.json(r);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/mit/historico', requireAuth, async (req, res) => {
    try {
        const { empresaCnpj, anoPA } = req.query;
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await consultarApuracoesAno({ empresaCnpj, anoPA: Number(anoPA) }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /cobertura?meses=6
// Pra cada empresa Lucro Presumido/Real ativa, lista as competencias dos
// ultimos N meses onde NAO ha DCTFWeb transmitida (situacao=='ATIVA').
// Mesmo conceito do /das/cobertura-pgdas, mas pra Lucro. So admin.
router.get('/cobertura', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });
        const meses = Math.min(Math.max(Number(req.query.meses || 6), 1), 24);
        const competencias = ultimasCompetenciasDctfweb(meses); // [{anoPA,mesPA,label}]

        if (admin.apps.length === 0) {
            admin.initializeApp({ credential: admin.credential.applicationDefault() });
        }
        const db = admin.firestore();

        // 1. Empresas Lucro ativas
        const lucroSnap = await db.collection('lucro_empresas').get();
        const empresas = [];
        lucroSnap.forEach((doc) => {
            const d = doc.data();
            if (d._merged_into) return;
            const cnpj = (d.cnpj || '').replace(/\D/g, '');
            if (cnpj.length !== 14) return;
            empresas.push({ id: doc.id, cnpj, nome: d.razaoSocial || d.nome || '' });
        });

        // 2. DCTFWeb dos ultimos meses (loteia por anoPA — geralmente sao 1-2 anos)
        const anos = Array.from(new Set(competencias.map((c) => c.anoPA)));
        const declMap = new Map(); // empresaId|YYYY-MM -> { situacao, valor }
        const anosFalhos = [];
        for (const ano of anos) {
            try {
                // Pagina com fetchAllDocs (default 500/batch) — evita estourar reads
                const docs = await fetchAllDocs(
                    db.collection('dctfweb_declaracoes').where('anoPA', '==', ano),
                    { label: 'dctfweb/cobertura' },
                );
                for (const d of docs) {
                    const x = d.data();
                    if (!x.empresaId || x.mesPA == null) continue;
                    // So conta GERAL_MENSAL (categoria principal — a obrigacao mensal mesmo)
                    if (x.categoria && x.categoria !== 'GERAL_MENSAL') continue;
                    const label = `${x.anoPA}-${String(x.mesPA).padStart(2, '0')}`;
                    const k = `${x.empresaId}|${label}`;
                    // Prioriza ATIVA sobre EM_ANDAMENTO se houver mais de um doc
                    const prev = declMap.get(k);
                    if (!prev || (x.situacao === 'ATIVA' && prev.situacao !== 'ATIVA')) {
                        declMap.set(k, { situacao: x.situacao || 'EM_ANDAMENTO', valor: x.valorTotal || 0 });
                    }
                }
            } catch (e) {
                anosFalhos.push(ano);
                console.warn('[dctfweb/cobertura] ano', ano, 'falhou:', e.message);
            }
        }

        // 3. Matriz empresa x competencia
        const resultado = [];
        let totalGaps = 0;
        let totalEmAndamento = 0;
        for (const emp of empresas) {
            const mesesArr = competencias.map((c) => {
                const k = `${emp.id}|${c.label}`;
                const decl = declMap.get(k);
                if (!decl) return { competencia: c.label, transmitido: false };
                return {
                    competencia: c.label, transmitido: true,
                    situacao: decl.situacao, valor: decl.valor,
                };
            });
            const gaps = mesesArr.filter((m) => !m.transmitido).length;
            const emAndamento = mesesArr.filter((m) => m.transmitido && m.situacao === 'EM_ANDAMENTO').length;
            totalGaps += gaps;
            totalEmAndamento += emAndamento;
            resultado.push({ id: emp.id, cnpj: emp.cnpj, nome: emp.nome, gaps, emAndamento, meses: mesesArr });
        }
        resultado.sort((a, b) => (b.gaps - a.gaps) || (b.emAndamento - a.emAndamento) || (a.nome || '').localeCompare(b.nome || ''));

        return res.json({
            mesesAnalisados: competencias.length,
            competencias: competencias.map((c) => c.label),
            totalEmpresas: empresas.length,
            empresasComGap: resultado.filter((e) => e.gaps > 0).length,
            totalGaps,
            totalEmAndamento,
            // honesto: se algum ano falhou ler, marca degraded pra UI nao mostrar
            // falso "nao transmitido" sem aviso
            degraded: anosFalhos.length > 0,
            anosFalhos,
            empresas: resultado,
        });
    } catch (e) {
        console.error('[dctfweb/cobertura]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

function ultimasCompetenciasDctfweb(n) {
    return ultimasCompetenciasComAnoMesHelper(n);
}

router.post('/cron', async (req, res) => {
    const headerSecret = req.header('X-Cron-Secret') || '';
    if (!CRON_SECRET || headerSecret !== CRON_SECRET) return res.status(403).json({ erro: 'cron secret invalido' });
    const t0 = Date.now();
    try {
        const stats = await sincronizarTodasLucro();
        const duracaoMs = Date.now() - t0;
        try {
            if (admin.apps.length === 0) admin.initializeApp({ credential: admin.credential.applicationDefault() });
            await admin.firestore().collection('dctfweb_cron_logs').add({
                executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                duracaoMs, ...stats,
            });
        } catch (logErr) { console.warn('[dctfweb-cron] log falhou:', logErr.message); }
        return res.json({ ok: true, duracaoMs, ...stats });
    } catch (err) {
        return res.status(500).json({ ok: false, erro: err.message });
    }
});

export default router;
