// ============================================================================
// sefaz-backend/nfse-sp-routes.js  (ESM)
//
// Endpoints REST pra captura de NFS-e da prefeitura de São Paulo capital.
// Mesmo padrão self-contained do manifesto-routes.js.
// ============================================================================

import { Router, json } from 'express';
import multer from 'multer';
import admin from 'firebase-admin';
import {
    listarEmpresasElegiveis,
    consultarUma,
    consultarTodasElegiveis,
} from './nfse-sp-orchestrator.js';
import { consultarNfseRecebidas, consultarNfseEmitidas } from './nfse-sp-client.js';
import { parseNfseSpXml } from './nfse-sp-importer.js';
import { parseCsvNfseSp } from './nfse-sp-csv-parser.js';
import { importarCsvNfseSp } from './nfse-sp-csv-importer.js';
import { sincronizarNfseSpViaPortal } from './nfse-sp-portal-orchestrator.js';
import { requireAuth as authUser } from './require-admin.js';

const uploadCsv = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

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

        // Remetente = escritório (SP Assessoria). Pode vir do env ou usar
        // o CNPJ default do escritório (44388152000189).
        const cnpjRemetente = (process.env.NFSE_SP_REMETENTE_CNPJ || process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');
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
                rawSample: resultado.rawSample || null,
                tagsEncontradas: resultado.tagsEncontradas || null,
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

// ─── Importação manual via CSV exportado do portal SP ─────────────────────
// Endpoint pragmático que destrava NFSe SP enquanto WS legacy retorna 1102.
// User exporta CSV no portal nfe.prefeitura.sp.gov.br → Exportação de NFS-e →
// Layout V.006 (CSV). Sobe aqui. Sistema parseia e importa todas as notas.
router.post('/nfsesp-importar-csv', authUser, uploadCsv.single('csv'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ erro: 'Arquivo CSV obrigatório no campo "csv"' });

        // Parse direto do buffer (parser decodifica ISO-8859-1 internamente)
        let parsed;
        try {
            parsed = parseCsvNfseSp(req.file.buffer);
        } catch (e) {
            return res.status(400).json({ erro: `CSV inválido: ${e.message}` });
        }

        if (!parsed.notas?.length) {
            return res.json({
                ok: true,
                aviso: 'CSV não contém notas',
                resumo: { totalNotas: 0 },
            });
        }

        // Contexto da empresa (opcional — se vier no body, usa pra setar direcao)
        const ctx = {
            empresaId: req.body?.empresaId || null,
            empresaCnpj: (req.body?.empresaCnpj || '').replace(/\D/g, '') || null,
            empresaNome: req.body?.empresaNome || null,
            direcao: req.body?.direcao || null, // 'entrada' | 'saida' | (auto)
            importadoPor: req.user?.email || 'admin',
        };

        // Se direcao não veio, tenta inferir pelo nome do arquivo
        // (E_ = Emitidas → saida; R_ = Recebidas → entrada)
        if (!ctx.direcao && req.file.originalname) {
            const nm = req.file.originalname.toUpperCase();
            if (/NFSE_E_|EMITIDAS|EMITIDA/.test(nm)) ctx.direcao = 'saida';
            else if (/NFSE_R_|RECEBIDAS|TOMADAS|RECEBIDA/.test(nm)) ctx.direcao = 'entrada';
        }

        // Se empresaCnpj não veio, usa o do CCM do CSV (procura por CCM no Firestore)
        if (!ctx.empresaCnpj && parsed.ccmExportado) {
            try {
                const db = admin.firestore();
                for (const col of ['simples_empresas', 'lucro_empresas']) {
                    const snap = await db.collection(col).where('ccmSp', '==', parsed.ccmExportado).limit(1).get();
                    if (!snap.empty) {
                        const d = snap.docs[0];
                        ctx.empresaId = d.id;
                        ctx.empresaCnpj = (d.data().cnpj || '').replace(/\D/g, '');
                        ctx.empresaNome = d.data().razaoSocial || d.data().nome;
                        break;
                    }
                }
            } catch (e) {
                console.warn('[nfsesp-importar-csv] falha procurar empresa por CCM:', e.message);
            }
        }

        const resultado = await importarCsvNfseSp(parsed, ctx);

        // Log de auditoria
        try {
            await admin.firestore().collection('nfsesp_csv_imports').add({
                executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                importadoPor: ctx.importadoPor,
                fileName: req.file.originalname,
                fileSize: req.file.size,
                ccmExportado: parsed.ccmExportado,
                empresaId: ctx.empresaId,
                empresaCnpj: ctx.empresaCnpj,
                direcao: ctx.direcao,
                totalNotas: resultado.totalNotas,
                criadas: resultado.criadas,
                atualizadas: resultado.atualizadas,
                erros: resultado.erros,
                valorTotal: resultado.valorTotal,
                periodo: resultado.periodo,
            });
        } catch (logErr) {
            console.warn('[nfsesp-importar-csv] log falhou:', logErr.message);
        }

        res.json({
            ok: true,
            ctx: { empresaId: ctx.empresaId, empresaCnpj: ctx.empresaCnpj, empresaNome: ctx.empresaNome, direcao: ctx.direcao },
            resumo: {
                layout: parsed.layout,
                ccmExportado: parsed.ccmExportado,
                totalNotas: resultado.totalNotas,
                criadas: resultado.criadas,
                atualizadas: resultado.atualizadas,
                erros: resultado.erros,
                valorTotal: resultado.valorTotal,
                periodo: resultado.periodo,
                duracaoMs: resultado.duracaoMs,
                contagemBate: parsed.contagemBate,
                somaBate: parsed.somaBate,
            },
            // Não retorna detalhes individuais por padrão (pode ser grande)
        });
    } catch (e) {
        console.error('[nfsesp-importar-csv] erro:', e);
        res.status(500).json({ erro: e.message });
    }
});

// ─── CAPTURA AUTOMÁTICA VIA PORTAL (CSV) — SUBSTITUI WS LEGACY ────────────
// Cron noturno: login do escritório via mTLS → enumera prestadores
// autorizados → baixa CSV emitidas + recebidas de cada empresa cliente.

router.post('/nfsesp-portal-cron', json(), async (req, res) => {
    const headerSecret = req.header('x-cron-secret')
        || req.header('X-Sefaz-Cron-Secret')
        || '';
    if (!CRON_SECRET || headerSecret !== CRON_SECRET) {
        return res.status(403).json({ erro: 'cron secret inválido' });
    }
    res.json({ ok: true, motivo: 'Captura NFSe SP via portal iniciada em background' });
    setImmediate(async () => {
        const periodo = req.body?.periodo || null;
        try {
            const r = await sincronizarNfseSpViaPortal({
                periodo, capturadoPor: 'cron-scheduler',
            });
            console.log(`[nfsesp-portal-cron] fim: ${r.processadas}/${r.prestadoresAutorizados} ok, ${r.totalNovos} novos, ${r.duracaoMs}ms`);
        } catch (e) {
            console.error('[nfsesp-portal-cron] erro:', e);
        }
    });
});

// Disparo manual (Bearer admin, sem precisar do cron-secret)
router.post('/nfsesp-portal-cron-now', authUser, json(), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ erro: 'Apenas administradores' });
        }
        res.json({ ok: true, motivo: 'Captura NFSe SP via portal iniciada em background' });
        setImmediate(async () => {
            try {
                const r = await sincronizarNfseSpViaPortal({
                    periodo: req.body?.periodo || null,
                    capturadoPor: req.user.email,
                });
                console.log(`[nfsesp-portal-cron-now] fim: ${r.processadas}/${r.prestadoresAutorizados} ok, ${r.totalNovos} novos, ${r.duracaoMs}ms`);
            } catch (e) {
                console.error('[nfsesp-portal-cron-now] erro:', e);
            }
        });
    } catch (e) {
        return res.status(500).json({ erro: e.message });
    }
});

export default router;
