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
    consultarUma,
    consultarTodasElegiveis,
} from './nfse-sp-orchestrator.js';
import { interpretarRespostaWs, enxugarParaDiagnostico } from './nfse-sp-ws-leitura.js';
import { parseCsvNfseSp, detectarSeparador } from './nfse-sp-csv-parser.js';
import { importarCsvNfseSp } from './nfse-sp-csv-importer.js';
import { sincronizarNfseSpViaPortal } from './nfse-sp-portal-orchestrator.js';
import { loadSessaoManual, saveSessaoManual } from './nfse-sp-portal-client.js';
import { requireAuth as authUser, requireAdmin } from './require-admin.js';
import { secretsMatch } from './cron-secret.js';
import { saudeNfseSp, empresaComFalhaNaCaptura } from './nfse-sp-saude.js';
import { montarPainelIssCarteira, acumularIssPorEmpresa } from './iss-carteira.js';
import { getEmpresaIdsDaCarteira } from './carteira-auth.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { consultarNfseEmitidas, baixarWsdl, sondar1102 } from './nfse-sp-client.js';
import { interpretarSonda } from './nfse-sp-sonda-leitura.js';
import { extrairContratoWsdl, conferirContrato, parametrosDoEnvelope } from './nfse-sp-wsdl.js';

/** SP capital — única praça coberta pelo ISS do CFI (Paulo, 05/08). */
const COD_MUN_SP_CAPITAL = '3550308';

// A SOAPAction que o cliente usa na consulta de emitidas — repetida aqui só
// para o diagnóstico poder confrontá-la com a declarada no WSDL.
const SOAP_ACTION_EMITIDAS_DIAG = 'http://www.prefeitura.sp.gov.br/nfe/ws/consultaNFeEmitidas';

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

router.post('/nfsesp-consultar-uma', requireAdmin, json(), async (req, res) => {
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
        // Cadastro unico dadosFiscais.ccmSp (fallback top-level legado), so digitos
        const ccmSp = (d.dadosFiscais?.ccmSp || d.ccmSp || '').toString().replace(/\D/g, '');
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

router.post('/nfsesp-cron', json(), async (req, res) => {
    const headerSecret = req.header('X-Sefaz-Cron-Secret')
        || req.header('x-cron-secret')
        || '';
    if (!secretsMatch(headerSecret, CRON_SECRET)) {
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
router.post('/nfsesp-importar-csv', requireAdmin, uploadCsv.single('csv'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ erro: 'Arquivo CSV obrigatório no campo "csv"' });

        // O portal exporta o MESMO layout de 73 colunas em DOIS formatos: CSV
        // com ";" e TXT com TAB. A guarda antiga barrava todo .txt chamando de
        // "largura fixa" — e o TXT com TAB é uma tabela limpa, que o parser
        // agora lê. Só o largura-fixa (sem separador nenhum) continua fora.
        const primeiraLinha = req.file.buffer.toString('latin1').split(/\r?\n/)[0] || '';
        if (!detectarSeparador(primeiraLinha) && primeiraLinha.length > 60) {
            return res.status(400).json({
                erro: 'Este arquivo não tem separador de colunas — é o TXT de LARGURA FIXA do portal '
                    + '("Layout do Arquivo NFS-e"), que o CFI ainda não lê. O que fazer agora: na tela '
                    + 'de exportação do portal, peça o resultado da consulta em CSV ou em TXT separado '
                    + 'por tabulação; os dois o CFI importa.',
            });
        }

        // Parse direto do buffer (parser decodifica ISO-8859-1 internamente)
        let parsed;
        try {
            parsed = parseCsvNfseSp(req.file.buffer);
        } catch (e) {
            return res.status(400).json({ erro: `CSV inválido: ${e.message}` });
        }

        if (!parsed.notas?.length) {
            // ZERO NUNCA É SUCESSO. Arquivo COM conteúdo e sem nenhuma linha de
            // detalhe lida é falha de leitura, não "arquivo vazio" — e dizer
            // ok:true aqui era o que fazia a equipe achar que tinha importado.
            if (parsed.linhasComConteudo > 0) {
                return res.status(400).json({
                    erro: `Li o arquivo (separador "${parsed.separador === '\t' ? 'TAB' : parsed.separador}", `
                        + `${parsed.linhasComConteudo} linha(s) com conteúdo) mas NENHUMA linha de nota foi reconhecida. `
                        + 'As linhas de nota do portal começam com "2" na primeira coluna. '
                        + 'O que fazer agora: confira se o arquivo é o export da consulta de NFS-e (e não outro relatório) '
                        + 'e mande-o ao Paulo se o formato mudou.',
                });
            }
            return res.json({ ok: true, aviso: 'Arquivo sem nenhuma linha de nota.', resumo: { totalNotas: 0 } });
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
    if (!secretsMatch(headerSecret, CRON_SECRET)) {
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

// ─── Sessão manual do portal SP (admin cola cookies do DevTools) ──────────
// Estratégia pragmática enquanto o login mTLS automático não está
// resolvido: admin loga no portal SP via browser, copia 3 cookies do
// DevTools (PMSP_NFeID, PMSP_NFE_CPFCNPJ, ASP.NET_SessionId), cola aqui.
// Cron noturno usa esses cookies pra baixar CSV de todas as empresas.

router.get('/nfsesp-portal-session', requireAdmin, async (_req, res) => {
    try {
        const s = await loadSessaoManual();
        return res.json({
            ok: true,
            valida: true,
            cookiesNomes: Object.keys(s.cookies),
            atualizadoEm: s.atualizadoEm?.toDate?.()?.toISOString?.() || null,
            expiraEm: s.expiraEm?.toDate?.()?.toISOString?.() || null,
        });
    } catch (e) {
        return res.json({ ok: false, valida: false, motivo: e.message });
    }
});

router.post('/nfsesp-portal-session', requireAdmin, json(), async (req, res) => {
    try {
        const { cookieString } = req.body || {};
        if (!cookieString) return res.status(400).json({ erro: 'cookieString obrigatório' });
        const r = await saveSessaoManual(cookieString, req.user.email);
        return res.json(r);
    } catch (e) {
        return res.status(500).json({ erro: e.message });
    }
});

// ─── CORREÇÃO em massa de direção das NFSe SP capturadas ─────────────────
// Bug fix retroativo: notas baixadas em "Recebidas" mas onde a S&P é
// prestadora foram marcadas erroneamente como direcao='entrada'.
// Itera todas as NFSe do fonte=csv-portal-sp e infere direção pelo CNPJ
// prestador/tomador da nota vs CNPJ da empresa do contexto.
router.post('/nfsesp-corrigir-direcoes', authUser, json(), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ erro: 'Apenas administradores' });
        }
        res.json({ ok: true, motivo: 'Correção iniciada em background' });

        setImmediate(async () => {
            const db = fa().firestore();
            const t0 = Date.now();
            let total = 0, corrigidas = 0, erros = 0;
            try {
                const snap = await db.collection('documentos_fiscais')
                    .where('tipoDoc', '==', 'NFSe')
                    .where('fonte', '==', 'csv-portal-sp')
                    .get();

                // Lista CNPJs do escritório + clientes (pra inferir direção)
                const empresasMap = new Map();
                for (const col of ['simples_empresas', 'lucro_empresas']) {
                    const s = await db.collection(col).get();
                    s.forEach(d => {
                        const cnpj = (d.data().cnpj || '').replace(/\D/g, '');
                        if (cnpj.length === 14) empresasMap.set(cnpj, true);
                    });
                }
                console.log(`[corrigir-direcoes] ${snap.size} NFSe, ${empresasMap.size} empresas cadastradas`);

                for (const doc of snap.docs) {
                    total++;
                    const d = doc.data();
                    const cnpjP = (d.prestadorCnpj || d.cnpjEmit || '').replace(/\D/g, '');
                    const cnpjT = (d.tomadorCnpj || d.cnpjDest || '').replace(/\D/g, '');

                    // Estratégia: a empresa CADASTRADA no nosso sistema é a
                    // empresa "do contexto" — direção é em relação a ela.
                    let novaDirecao = null;
                    if (empresasMap.has(cnpjP) && !empresasMap.has(cnpjT)) {
                        // Empresa cadastrada é prestadora → emitida (saída)
                        novaDirecao = 'saida';
                    } else if (empresasMap.has(cnpjT) && !empresasMap.has(cnpjP)) {
                        // Empresa cadastrada é tomadora → recebida (entrada)
                        novaDirecao = 'entrada';
                    } else if (empresasMap.has(cnpjP) && empresasMap.has(cnpjT)) {
                        // Ambas cadastradas — fica como já estava (relação entre clientes do escritório)
                        continue;
                    }
                    // Se nenhuma das duas é nossa empresa, mantém

                    if (novaDirecao && novaDirecao !== d.direcao) {
                        try {
                            const novoEmpresaCnpj = novaDirecao === 'saida' ? cnpjP : cnpjT;
                            const novoEmpresaNome = novaDirecao === 'saida' ? d.prestadorNome : d.tomadorNome;
                            await doc.ref.update({
                                direcao: novaDirecao,
                                empresaCnpj: novoEmpresaCnpj,
                                empresaNome: novoEmpresaNome,
                                direcaoCorrigidaEm: admin.firestore.FieldValue.serverTimestamp(),
                            });
                            corrigidas++;
                        } catch (e) {
                            erros++;
                        }
                    }
                }
                console.log(`[corrigir-direcoes] FIM total=${total} corrigidas=${corrigidas} erros=${erros} (${Date.now() - t0}ms)`);
                await db.collection('nfsesp_correcoes_log').add({
                    executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                    executadoPor: req.user.email,
                    total, corrigidas, erros,
                    duracaoMs: Date.now() - t0,
                });
            } catch (e) {
                console.error('[corrigir-direcoes] erro fatal:', e);
            }
        });
    } catch (e) {
        return res.status(500).json({ erro: e.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/admin/sefaz/iss-carteira?competencia=AAAA-MM
//
// Painel do ISS próprio da CARTEIRA de SP capital. A aba 🏛️ ISS SP responde uma
// empresa por vez — serve pra fechar o cliente que está na mão, não pra saber
// QUEM FALTA. A onda 1 da migração são 157 empresas de serviço puro.
//
// Uma leitura por fonte, agrupada em memória (padrão do painel da Rotina):
// nada de consultar por empresa.
// ────────────────────────────────────────────────────────────────────────────
router.get('/iss-carteira', authUser, async (req, res) => {
    try {
        const competencia = String(req.query.competencia || '').trim();
        if (!/^\d{4}-\d{2}$/.test(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência (AAAA-MM).' });
        }
        const db = fa().firestore();
        const idsCarteira = await getEmpresaIdsDaCarteira(req.user);

        // Só SP capital: fora da praça a guia é de outra prefeitura, com outro
        // portal e outro vencimento (Paulo, 05/08 — "somente São Paulo capital").
        const empresas = [];
        const porCnpj = new Map();
        for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
            const snap = await db.collection(col).get();
            snap.forEach((doc) => {
                const d = doc.data() || {};
                if (d._deleted || d._merged_into) return;
                if (idsCarteira && !idsCarteira.includes(doc.id)) return;
                const df = d.dadosFiscais || {};
                if (String(df.codMunIBGE || d.codMunIBGE || '').trim() !== COD_MUN_SP_CAPITAL) return;
                const cnpj = String(d.cnpj || '').replace(/\D/g, '');
                const linha = {
                    empresaId: doc.id,
                    nome: d.razaoSocial || d.nome || '—',
                    cnpj,
                    // O REGIME decide se o ISS próprio vira guia do município ou
                    // se já vai dentro do DAS (LC 123 art. 13).
                    regime,
                    // CCM canônico em dadosFiscais, fallback top-level legado (#311).
                    ccm: String(df.ccmSp || d.ccmSp || '').replace(/\D/g, ''),
                    issFixoSup: (d.issPadraoConfig?.tipo || df.issConfig?.tipo) === 'sup_fixo',
                };
                empresas.push(linha);
                if (cnpj.length === 14) porCnpj.set(cnpj, linha);
            });
        }

        // Uma varredura de documentos da competência. A NFS-e do portal vem
        // ACHATADA (valorIss/issDevido/issRetido) e a do XML vem em objeto
        // (valores.iss) — a projeção precisa das DUAS formas, senão metade da
        // base soma zero (armadilha que já mordeu no DIFAL, na 🚦 e aqui).
        const snaps = await fetchAllDocs(
            db.collection('documentos_fiscais')
                .where('competencia', '==', competencia)
                .select('empresaId', 'empresaCnpj', 'tipoDoc', 'tipo', 'direcao', 'status',
                    'valorIss', 'issDevido', 'issRetido', 'valorIssRetido',
                    'valores.iss', 'valores.issRetido', 'valores.valorIssRetido', 'valores.valorIss',
                    'totais.vISS',
                    // POR QUE o ISS está zerado (iss-zerado-causa.js). Tudo já
                    // é gravado pelo importer — nenhuma captura nova.
                    'aliquotaServicos', 'valorServicos', 'valorDeducoes', 'valorTotal',
                    'municipioPrestacaoIbge', 'prestadorOptanteSimples', 'codigoServico'),
            { label: `iss-carteira ${competencia}`, maxDocs: 80000 },
        );

        // A conta do ISS vive no núcleo puro (`acumularIssPorEmpresa`): a Rotina
        // do mês lê a MESMA coisa, e painel com conta própria erra sozinho.
        const porId = new Map(empresas.map((e) => [e.empresaId, e]));
        const resolver = (d) => {
            if (d.empresaId && porId.has(d.empresaId)) return d.empresaId;
            const alvo = porCnpj.get(String(d.empresaCnpj || '').replace(/\D/g, ''));
            return alvo ? alvo.empresaId : null;
        };
        const apuracoes = acumularIssPorEmpresa(snaps.map((s) => ({ id: s.id, ...s.data() })), resolver);

        // Saúde da captura decide se um ZERO pode ser lido como "sem movimento".
        let saude = null;
        let logs = [];
        try {
            const ls = await db.collection('nfsesp_portal_cron_logs')
                .orderBy('executadoEm', 'desc').limit(10).get();
            logs = ls.docs.map((x) => ({ id: x.id, ...x.data() }));
            saude = saudeNfseSp(logs, Date.now());
        } catch (e) {
            console.warn('[iss-carteira] saúde da captura indisponível:', e.message);
        }
        // Sem saúde legível, NENHUM zero é confiável — silêncio não é sucesso.
        const zeroConfiavelPara = (cnpj) => !!saude?.zeroConfiavel && !empresaComFalhaNaCaptura(logs, cnpj);

        const painel = montarPainelIssCarteira({ empresas, apuracoes, zeroConfiavelPara });
        return res.json({
            ok: true,
            competencia,
            // Falhar em LER a saúde deixa TODO zero não-confiável — e a tela
            // precisa dizer isso, senão o painel mostra centenas de "captura
            // incerta" sem causa nenhuma (foi o buraco do #506, no caminho do
            // null). Silêncio aqui vira interpretação de quem lê.
            saudeCaptura: saude || {
                farol: 'quebrado',
                motivo: 'Não consegui ler a saúde da captura de NFS-e SP.',
                acao: 'Sem ela, NENHUM "zero nota" pode ser lido como "sem movimento" — confira a aba Captura.',
                zeroConfiavel: false,
            },
            ...painel,
        });
    } catch (e) {
        console.error('[iss-carteira]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/admin/sefaz/nfsesp-saude?cnpj=
//
// Saúde do trilho de captura da NFS-e SP, pra ser mostrada ONDE A PESSOA
// TRABALHA. Paulo, 05/08: "imagina o cliente esperando a guia p pagamento e o
// colaborador não consegue capturar as nfs e só descobre tentando".
//
// Com `cnpj`, responde também se AQUELA empresa falhou na última varredura —
// "algumas falharam" não é acionável; "a sua falhou, por isso" é.
// ────────────────────────────────────────────────────────────────────────────
router.get('/nfsesp-saude', authUser, async (req, res) => {
    try {
        const db = admin.apps.length
            ? admin.firestore()
            : (admin.initializeApp({ credential: admin.credential.applicationDefault() }), admin.firestore());
        const snap = await db.collection('nfsesp_portal_cron_logs')
            .orderBy('executadoEm', 'desc').limit(10).get();
        const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const saude = saudeNfseSp(logs, Date.now());
        const cnpj = String(req.query.cnpj || '');
        return res.json({
            ok: true,
            ...saude,
            empresaFalhou: cnpj ? empresaComFalhaNaCaptura(logs, cnpj) : null,
        });
    } catch (e) {
        console.error('[nfsesp-saude]', e);
        // Falha ao LER a saúde não pode virar "está tudo bem": sem resposta, a
        // tela precisa tratar como não-confiável.
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/admin/sefaz/nfsesp-ws-diagnostico
//
// UMA chamada ao Web Service da Prefeitura, só pra ver O QUE ELE RESPONDE.
//
// Por que existe (Paulo, 06/08 — "como reproduzir o erro WS p você"): o
// trilho do WS foi dado como aposentado em 22/07 com "erro 1102 pra tudo", e
// desde então ninguém sabia se era autorização do escritório, CCM, certificado
// ou endpoint. Aqui ele clica uma vez e me manda a resposta crua.
//
// O QUE O 1º TESTE REVELOU (06/08, CLINICA MANTOAN): HTTP 200 + erro 1102
// "Mensagem XML de Pedido do serviço sem conteúdo". O WS NÃO está aposentado —
// ele atende, aceita o certificado e recusa o NOSSO pedido. O defeito é do
// lado do CFI. Por isso a rota passou a devolver também o envelope ENVIADO:
// sem ver o que sai daqui, a investigação é adivinhação.
//
// NÃO EMITE NADA: é consulta de notas emitidas, o método mais inofensivo do
// WS. Admin-only porque usa o certificado.
// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────
// POST /api/admin/sefaz/nfsesp-ws-sonda
//
// Separa as duas causas que sobraram do 1102, comparando CÓDIGOS entre
// variantes controladas. Com o contrato do WSDL conferido, o envelope está
// descartado — resta saber se o conteúdo NÃO CHEGA (transporte) ou CHEGA e é
// RECUSADO (formato do Pedido). Essas duas pedem ações opostas.
//
// SÓ CONSULTA: nenhuma variante emite, cancela ou altera nada. São 5 chamadas
// sequenciais, uma por clique — não é laço nem lote.
// ────────────────────────────────────────────────────────────────────────────
router.post('/nfsesp-ws-sonda', requireAdmin, async (req, res) => {
    const inicio = Date.now();
    const { cnpj, ccm, anoMes } = req.body || {};
    const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
    const ccmLimpo = String(ccm || '').replace(/\D/g, '');
    const m = /^(\d{4})-(\d{2})$/.exec(String(anoMes || ''));
    if (!/^\d{14}$/.test(cnpjLimpo) || !ccmLimpo || !m) {
        return res.status(400).json({ ok: false, error: 'Informe CNPJ (14 dígitos), CCM e competência (AAAA-MM).' });
    }
    const periodo = { ano: Number(m[1]), mes: Number(m[2]) };
    try {
        const resultados = await sondar1102({
            cnpjRemetente: cnpjLimpo,
            inscricaoMunicipalPrestador: ccmLimpo,
            dtInicio: periodo,
            dtFim: periodo,
        });
        return res.json({
            ok: true,
            resultados,
            leitura: interpretarSonda(resultados),
            duracaoMs: Date.now() - inicio,
        });
    } catch (e) {
        return res.json({ ok: false, erro: String(e?.message || e).slice(0, 600), duracaoMs: Date.now() - inicio });
    }
});

router.post('/nfsesp-ws-diagnostico', requireAdmin, async (req, res) => {
    const inicio = Date.now();
    const { cnpj, ccm, anoMes } = req.body || {};
    const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
    const ccmLimpo = String(ccm || '').replace(/\D/g, '');
    if (!/^\d{14}$/.test(cnpjLimpo)) {
        return res.status(400).json({ ok: false, error: 'Informe o CNPJ da empresa (14 dígitos).' });
    }
    if (!ccmLimpo) {
        return res.status(400).json({ ok: false, error: 'Informe o CCM da empresa (Dados Fiscais → Inscrição Municipal SP).' });
    }
    const m = /^(\d{4})-(\d{2})$/.exec(String(anoMes || ''));
    if (!m) return res.status(400).json({ ok: false, error: 'Informe a competência (AAAA-MM).' });
    const periodo = { ano: Number(m[1]), mes: Number(m[2]) };

    try {
        const r = await consultarNfseEmitidas({
            cnpjRemetente: cnpjLimpo,
            inscricaoMunicipalPrestador: ccmLimpo,
            dtInicio: periodo,
            dtFim: periodo,
        });
        // Resposta CRUA — é isso que diz se o 1102 é autorização, CCM ou
        // certificado. A `leitura` vem AO LADO do dado cru, nunca no lugar
        // dele: ela é a conclusão de quem é o problema, e o cru é a prova.
        const bruto = {
            ok: true,
            httpStatus: r.statusCode ?? null,
            sucesso: !!r.sucesso,
            erros: r.erros || [],
            alertas: r.alertas || [],
            totalNFes: r.totalNFes ?? 0,
        };
        // Confere o que ENVIAMOS contra o contrato publicado pela própria
        // Prefeitura. É o que fecha o 1102 sem chutar layout de fisco — e o
        // ambiente de desenvolvimento não alcança o host, mas o Cloud Run sim.
        // Falha aqui NUNCA derruba o diagnóstico: o teste do WS é o principal.
        let contrato = null;
        try {
            const wsdl = await baixarWsdl();
            if (wsdl.statusCode === 200 && wsdl.body) {
                const c = extrairContratoWsdl(wsdl.body, 'ConsultaNFeEmitidas');
                contrato = conferirContrato({
                    contrato: c,
                    enviados: parametrosDoEnvelope(r._enviado?.soap, 'ConsultaNFeEmitidas'),
                    soapActionEnviada: SOAP_ACTION_EMITIDAS_DIAG,
                });
                // Se o leitor não entendeu a FORMA do WSDL, o que resolve é ver
                // os bytes — não tentar outro palpite sobre leiaute de fisco.
                if (c.trecho) contrato.trechoWsdl = enxugarParaDiagnostico(c.trecho, 1100);
                contrato.tamanhoWsdl = wsdl.body.length;
                contrato.schemasImportados = wsdl.schemasImportados ?? 0;
                contrato.schemasEncontrados = wsdl.schemasEncontrados ?? 0;
                if (c.elementoProcurado) contrato.elementoProcurado = c.elementoProcurado;
            } else if (wsdl.statusCode === 403) {
                // 403 COM certificado é outra coisa: o cert existe e não está
                // autorizado a ler o contrato — não confundir com "sem cert".
                contrato = {
                    ok: false, conclusivo: false,
                    motivo: 'A Prefeitura recusou a leitura do WSDL (HTTP 403) mesmo com o certificado. '
                        + 'O contrato do serviço não pode ser conferido por aqui — a divergência de parâmetro '
                        + 'precisa ser confirmada no manual do WS.',
                };
            } else {
                contrato = { ok: false, conclusivo: false, motivo: `WSDL não veio (HTTP ${wsdl.statusCode}).` };
            }
        } catch (e) {
            contrato = { ok: false, conclusivo: false, motivo: `Não consegui baixar o WSDL: ${String(e?.message || e).slice(0, 200)}` };
        }

        return res.json({
            ...bruto,
            leitura: interpretarRespostaWs(bruto),
            contrato,
            duracaoMs: Date.now() - inicio,
            enviado: { cnpjRemetente: cnpjLimpo, ccm: ccmLimpo, competencia: anoMes },
            // 1102 diz "a mensagem chegou vazia" — sem ver o que saiu daqui a
            // investigação vira adivinhação. Certificado/assinatura omitidos
            // (são enormes e não mudam a leitura).
            envelope: {
                xmlInterno: enxugarParaDiagnostico(r._enviado?.xmlInterno, 900),
                xmlAssinado: enxugarParaDiagnostico(r._enviado?.xmlAssinado, 1400),
                soap: enxugarParaDiagnostico(r._enviado?.soap, 1800),
                respostaCrua: enxugarParaDiagnostico(r._respostaCrua, 1800),
            },
        });
    } catch (e) {
        // Falha de transporte/certificado também é resposta: é o que
        // diferencia "a Prefeitura recusou" de "nem chegamos lá".
        return res.json({
            ok: false,
            falhaAntesDaResposta: true,
            erro: String(e?.message || e).slice(0, 600),
            duracaoMs: Date.now() - inicio,
            enviado: { cnpjRemetente: cnpjLimpo, ccm: ccmLimpo, competencia: anoMes },
        });
    }
});

export default router;
