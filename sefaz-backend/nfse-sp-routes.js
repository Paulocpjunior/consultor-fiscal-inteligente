// ============================================================================
// sefaz-backend/nfse-sp-routes.js  (ESM)
//
// Endpoints REST pra captura de NFS-e da prefeitura de São Paulo capital.
// Mesmo padrão self-contained do manifesto-routes.js.
// ============================================================================

import { Router, json } from 'express';
import admin from 'firebase-admin';
import {
    listarEmpresasElegiveis,
    consultarUma,
    consultarTodasElegiveis,
} from './nfse-sp-orchestrator.js';
import { consultarNfseRecebidas, consultarNfseEmitidas } from './nfse-sp-client.js';
import { parseNfseSpXml } from './nfse-sp-importer.js';
import { requireAuth as authUser } from './require-admin.js';

const CRON_SECRET = process.env.SEFAZ_CRON_SECRET;
const router = Router();

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

router.get('/nfsesp-elegiveis', authUser, async (_req, res) => {
    try {
        const db = fa().firestore();
        const lista = await listarEmpresasElegiveis(db);
        res.json({ total: lista.length, empresas: lista });
    } catch (e) {
        console.error('[nfse-sp-routes] elegiveis:', e);
        res.status(500).json({ erro: e.message });
    }
});

router.post('/nfsesp-consultar-uma', authUser, json(), async (req, res) => {
    try {
        const { empresaId, colecao, periodo } = req.body || {};
        if (!empresaId) return res.status(400).json({ erro: 'empresaId é obrigatório' });
        if (!colecao || !['simples_empresas', 'lucro_empresas'].includes(colecao)) {
            return res.status(400).json({ erro: "colecao deve ser simples_empresas ou lucro_empresas" });
        }

        const db = fa().firestore();
        const snap = await db.collection(colecao).doc(empresaId).get();
        if (!snap.exists) return res.status(404).json({ erro: 'empresa não encontrada' });

        const d = snap.data();
        const ccmSp = (d.ccmSp || '').toString().trim();
        const autorizado = d.nfseSpAutorizadoEm;
        if (!ccmSp || !autorizado) {
            return res.status(400).json({ erro: 'empresa não elegível: precisa ccmSp e nfseSpAutorizadoEm preenchidos' });
        }

        const empresa = {
            colecao,
            id: empresaId,
            cnpj: (d.cnpj || '').replace(/\D/g, ''),
            nome: d.razaoSocial || d.nome || empresaId,
            ccmSp,
            nfseSpAutorizadoEm: autorizado,
        };
        const r = await consultarUma(db, empresa, { periodo, importadoPor: req.user?.email || 'admin' });
        res.json(r);
    } catch (e) {
        console.error('[nfse-sp-routes] consultar-uma:', e);
        res.status(500).json({ erro: e.message });
    }
});

router.post('/nfsesp-consultar-todas', authUser, json(), async (req, res) => {
    try {
        const db = fa().firestore();
        const dryRun = req.body?.dryRun === true;
        const r = await consultarTodasElegiveis(db, {
            tipo: 'manual',
            dryRun,
            importadoPor: req.user?.email || 'admin',
        });
        res.json(r);
    } catch (e) {
        console.error('[nfse-sp-routes] consultar-todas:', e);
        res.status(500).json({ erro: e.message });
    }
});

/**
 * Endpoint de consulta direta — retorna os dados parseados das NFS-e
 * para exibicao no frontend (sem importar automaticamente no Firestore).
 * Suporta recebidas (servicos tomados) e emitidas (servicos prestados).
 */
router.post('/nfsesp-consultar', authUser, json(), async (req, res) => {
    try {
        const { cnpj, inscricaoMunicipal, tipo, mes, ano } = req.body || {};

        if (!cnpj || !/^\d{14}$/.test((cnpj || '').replace(/\D/g, ''))) {
            return res.status(400).json({ erro: 'CNPJ inválido (14 dígitos numéricos)' });
        }
        if (!inscricaoMunicipal) {
            return res.status(400).json({ erro: 'Inscrição Municipal (CCM) é obrigatória' });
        }
        const mesNum = Number(mes);
        const anoNum = Number(ano);
        if (!mesNum || mesNum < 1 || mesNum > 12) {
            return res.status(400).json({ erro: 'Mês inválido (1-12)' });
        }
        if (!anoNum || anoNum < 2000 || anoNum > 2100) {
            return res.status(400).json({ erro: 'Ano inválido' });
        }

        const cnpjRemetente = process.env.NFSE_SP_REMETENTE_CNPJ || '';
        const cnpjLimpo = cnpj.replace(/\D/g, '');
        const periodo = { ano: anoNum, mes: mesNum };

        let resultado;
        if (tipo === 'emitidas') {
            resultado = await consultarNfseEmitidas({
                cnpjRemetente,
                inscricaoMunicipalPrestador: inscricaoMunicipal,
                dtInicio: periodo,
                dtFim: periodo,
            });
        } else {
            resultado = await consultarNfseRecebidas({
                cnpjRemetente,
                inscricaoMunicipalTomador: inscricaoMunicipal,
                dtInicio: periodo,
                dtFim: periodo,
            });
        }

        if (!resultado.sucesso) {
            return res.json({
                sucesso: false,
                erros: resultado.erros,
                alertas: resultado.alertas,
                nfes: [],
                totalNFes: 0,
            });
        }

        // Parsear cada NFe XML em dados estruturados
        const nfesParsed = [];
        for (const nfeXml of resultado.nfes) {
            try {
                const parsed = parseNfseSpXml(nfeXml);
                nfesParsed.push(parsed);
            } catch (parseErr) {
                console.warn('[nfse-sp-routes] erro parseando NFe individual:', parseErr.message);
            }
        }

        res.json({
            sucesso: true,
            erros: resultado.erros || [],
            alertas: resultado.alertas || [],
            totalNFes: nfesParsed.length,
            nfes: nfesParsed,
        });
    } catch (e) {
        console.error('[nfse-sp-routes] consultar:', e);
        res.status(500).json({ erro: e.message });
    }
});

router.post('/nfsesp-cron', json(), async (req, res) => {
    const headerSecret = req.header('X-Sefaz-Cron-Secret')
        || req.header('x-cron-secret')
        || '';
    if (!CRON_SECRET || headerSecret !== CRON_SECRET) {
        return res.status(403).json({ erro: 'cron secret inválido' });
    }
    try {
        const db = fa().firestore();
        // PRODUÇÃO REAL: dryRun=false por default. Cloud Scheduler chama com
        // body vazio {} e queremos persistir as NFs. Pra testar sem gravar,
        // mandar body {"dryRun": true} explícito.
        const dryRun = req.body?.dryRun === true;
        const t0 = Date.now();
        const r = await consultarTodasElegiveis(db, {
            tipo: 'cron',
            dryRun,
            importadoPor: 'cron-scheduler',
        });

        try {
            await fa().firestore().collection('nfsesp_cron_logs').add({
                executadoEm: fa().firestore.FieldValue.serverTimestamp(),
                iniciadoEm: new Date(t0).toISOString(),
                dryRun,
                totalEmpresas: r.totalEmpresas,
                sucessos: r.sucessos,
                falhas: r.falhas,
                totalNFes: r.totalNFes,
                criadas: r.criadas,
                atualizadas: r.atualizadas,
                durationMs: r.durationMs,
            });
        } catch (logErr) {
            console.warn('[nfse-sp-routes] log do cron falhou:', logErr.message);
        }

        res.json(r);
    } catch (e) {
        console.error('[nfse-sp-routes] cron:', e);
        res.status(500).json({ erro: e.message });
    }
});

// Disparo manual pelo admin (Bearer, sem precisar do cron-secret).
router.post('/nfsesp-cron-now', authUser, json(), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ erro: 'Apenas administradores' });
        }
        res.json({ ok: true, motivo: 'Captura NFSe SP iniciada em background' });
        setImmediate(async () => {
            const db = fa().firestore();
            const t0 = Date.now();
            try {
                const r = await consultarTodasElegiveis(db, {
                    tipo: 'cron',
                    dryRun: false,
                    importadoPor: req.user.email,
                });
                await fa().firestore().collection('nfsesp_cron_logs').add({
                    executadoEm: fa().firestore.FieldValue.serverTimestamp(),
                    iniciadoEm: new Date(t0).toISOString(),
                    dryRun: false,
                    totalEmpresas: r.totalEmpresas,
                    sucessos: r.sucessos, falhas: r.falhas,
                    totalNFes: r.totalNFes, criadas: r.criadas, atualizadas: r.atualizadas,
                    durationMs: r.durationMs,
                    fonte: 'admin-manual',
                });
                console.log(`[nfsesp-cron-now] ok — admin=${req.user.email} ${r.sucessos}/${r.totalEmpresas}`);
            } catch (e) {
                console.error('[nfsesp-cron-now] erro:', e);
            }
        });
    } catch (e) {
        console.error('[nfse-sp-routes] cron-now:', e);
        return res.status(500).json({ erro: e.message });
    }
});

export default router;
