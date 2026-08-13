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
    listarTrimestraisVencendoEsteMes, listarDebitosTrimestrais, listarDebitosDeclaracao,
    listarQuotasAgendadas, emitirQuotaAgendada,
    consultarDeclaracaoCompleta, consultarRecibo,
    encerrarApuracaoMit, consultarStatusEncerramentoMit,
    consultarApuracaoMit, consultarApuracoesAno,
    preencherEncerrarMit,
    retificarMit,
    consultarRetencaoDctfwebNormalizada,
    getResumoGlobal,
} from './dctfweb-orchestrator.js';
import { getDctfwebMode } from './dctfweb-provider.js';
import { normalizarApuracaoMit } from './dctfweb-mit-normalizer.js';
import { requireAuth, requireAdmin } from './require-admin.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { ultimasCompetenciasComAnoMes as ultimasCompetenciasComAnoMesHelper } from './competencias-helper.js';
import { secretsMatch } from './cron-secret.js';

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
                _deleted: data._deleted,
            };
        })
        .filter((emp) => !emp._merged_into && !emp._deleted && emp.cnpj.length === 14)
        .filter((emp) => {
            if (!cnpjsSet && !idsSet) return true;
            return !!(idsSet?.has(emp.id) || cnpjsSet?.has(emp.cnpj));
        })
        .map(({ _merged_into, _deleted, ...emp }) => emp)
        .sort((a, b) => (a.nome || a.cnpj).localeCompare(b.nome || b.cnpj));
}

async function cnpjsPermitidosParaListagem(user) {
    const cnpjs = await getCnpjsDaCarteira(user);
    return cnpjs ? new Set(cnpjs) : null;
}

router.get('/status', (_req, res) => res.json({ mode: getDctfwebMode(), ok: true }));

router.get('/resumo', requireAuth, async (req, res) => {
    try { res.json(await getResumoGlobal(await cnpjsPermitidosParaListagem(req.user))); }
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

// TRANSMITIR (e RETIFICAR) a DCTFWeb.
//
// É o único ato que FECHA a competência para os outros departamentos — por isso
// tem dono (T1: fiscal), semáforo (T2) e justificativa gravada quando falta
// insumo (T3). Emitir GUIA não passa por nada disso: o DARF sai com a
// declaração em andamento, e é justamente confundir os dois que gera a
// retificadora.
//
// `retificadora: true` (T5) é a MESMA transmissão: o e-CAC monta uma nova
// declaração em andamento com o insumo que chegou depois, e o fluxo (consulta o
// XML → assina → TRANSDECLARACAO310) a entrega. O que muda é o rito em volta —
// motivo obrigatório e auditoria com os débitos ANTES e DEPOIS.
router.post('/transmitir', requireAuth, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj, anoPA, mesPA, categoria } = req.body || {};
        if (!empresaId || !empresaCnpj || !anoPA || !mesPA) return res.status(400).json({ error: 'empresaId+empresaCnpj+anoPA+mesPA' });
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });

        const {
            podeTransmitirDctfweb, checarJustificativa, checarRetificadora, compararDebitos,
        } = await import('./dctfweb-transmissao-regras.js');

        // T1 — dono da transmissão.
        const dono = podeTransmitirDctfweb(req.user);
        if (!dono.pode) return res.status(403).json({ error: dono.motivo, acao: dono.acao, dono: dono.dono });

        const db = admin.apps.length ? admin.firestore() : (admin.initializeApp({ credential: admin.credential.applicationDefault() }), admin.firestore());
        const cnpj = limparCnpj(empresaCnpj);
        const competencia = `${anoPA}-${String(mesPA).padStart(2, '0')}`;
        const docId = `${cnpj}_${anoPA}${String(mesPA).padStart(2, '0')}_${categoria || 'GERAL_MENSAL'}`.replace(/[^a-zA-Z0-9_-]/g, '_');

        let declaracao = null;
        try {
            const snap = await db.collection('dctfweb_declaracoes').doc(docId).get();
            declaracao = snap.exists ? snap.data() : null;
        } catch { declaracao = null; }

        const ehRetificadora = req.body?.retificadora === true;
        if (ehRetificadora) {
            // T5 — pré-condições.
            const chk = checarRetificadora({ declaracao, motivo: req.body?.motivo });
            if (!chk.ok) return res.status(400).json({ error: chk.erro });
        } else if (declaracao?.transmitidoEm || String(declaracao?.situacao || '').toUpperCase() === 'ATIVA') {
            // Transmitir de novo SEM dizer que é retificadora seria retificar às
            // escondidas. O app obriga a nomear o ato.
            return res.status(409).json({
                error: 'Esta competência já foi transmitida'
                    + (declaracao?.transmitidoPor ? ` por ${declaracao.transmitidoPor}` : '')
                    + (declaracao?.transmitidoEm ? ` em ${declaracao.transmitidoEm}` : '')
                    + '. Transmitir de novo é RETIFICADORA — use o botão de retificar e escreva o motivo.',
                jaTransmitida: true,
            });
        }

        // T2/T3 — semáforo dos insumos + justificativa gravada.
        let semaforo = null;
        try {
            const { vereditoInsumos } = await import('./dctfweb-insumos.js');
            const base = await montarSemaforoInsumos(db, { cnpj, competencia, empresaId });
            semaforo = { ...base, ...vereditoInsumos(base.selos) };
        } catch (e) {
            // Semáforo caído NÃO trava — trancar a entrega porque um serviço
            // piscou seria o dano maior (mesma régua do gate de departamento).
            console.warn('[dctfweb/transmitir] semáforo indisponível, seguindo:', e.message);
        }
        const just = checarJustificativa({
            veredito: semaforo?.veredito,
            confirmou: req.body?.confirmarInsumosPendentes === true,
            justificativa: req.body?.justificativa,
        });
        if (!just.ok) {
            return res.status(409).json({
                error: just.erro,
                bloqueado: true,
                veredito: semaforo?.veredito,
                frase: semaforo?.frase,
                selos: semaforo?.selos,
                pendentes: (semaforo?.selos || []).filter((s) => s.estado === 'pendente').map((s) => s.rotulo),
            });
        }

        // ANTES: o que a declaração cobra hoje. Sem isso a retificadora não tem
        // com o que ser comparada depois.
        let debitosAntes = [];
        try {
            const d = await listarDebitosDeclaracao({ empresaCnpj: cnpj, anoPA, mesPA, categoria });
            if (d?.lido) debitosAntes = d.debitos;
        } catch { /* auditoria não pode derrubar a entrega */ }

        const resultado = await transmitirDeclaracao({
            empresaId, empresaCnpj, anoPA, mesPA, categoria,
            transmitidoPor: req.user?.email || req.user?.uid || null,
        });

        let comparacao = null;
        try {
            const d = await listarDebitosDeclaracao({ empresaCnpj: cnpj, anoPA, mesPA, categoria });
            if (d?.lido) comparacao = compararDebitos(debitosAntes, d.debitos);
        } catch { /* idem */ }

        try {
            await db.collection('dctfweb_transmissoes').add({
                em: admin.firestore.FieldValue.serverTimestamp(),
                por: req.user?.email || req.user?.uid || null,
                departamentos: (req.user?.departamentos || []).join(',') || null,
                empresaCnpj: cnpj, competencia, categoria: categoria || 'GERAL_MENSAL',
                retificadora: ehRetificadora,
                motivo: ehRetificadora ? String(req.body?.motivo || '').trim() : null,
                justificativaInsumos: just.justificativa || null,
                vereditoInsumos: semaforo?.veredito || null,
                pendentes: (semaforo?.selos || []).filter((s) => s.estado === 'pendente').map((s) => s.rotulo),
                numeroRecibo: resultado?.numeroRecibo || null,
                debitosAntes, comparacao,
            });
        } catch (e) { console.warn('[dctfweb/transmitir] auditoria falhou:', e.message); }

        res.json({ ...resultado, retificadora: ehRetificadora, comparacao });
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

// Painel "Trimestrais vencendo este mês": candidatas (declarações ATIVA da
// competência que fecha o trimestre) da carteira. Sem custo SERPRO.
router.get('/trimestrais-mes', requireAuth, async (req, res) => {
    try {
        const cnpjsPermitidos = await cnpjsPermitidosParaListagem(req.user);
        if (cnpjsPermitidos && cnpjsPermitidos.size === 0) {
            return res.json({ aplicavel: true, candidatas: [] });
        }
        res.json(await listarTrimestraisVencendoEsteMes({ cnpjsPermitidos }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Débitos trimestrais de UMA declaração (sob demanda, 1 CONSXMLDECLARACAO38).
router.get('/debitos-trimestrais', requireAuth, async (req, res) => {
    try {
        const { empresaCnpj, anoPA, mesPA, categoria } = req.query;
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await listarDebitosTrimestrais({
            empresaCnpj, anoPA: Number(anoPA), mesPA: Number(mesPA), categoria,
        }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DÉBITOS APURADOS da declaração — a mesma tabela do e-CAC (tributo, código de
// receita e valor), que o detalhe do CFI não mostrava. Consulta pura.
router.get('/debitos', requireAuth, async (req, res) => {
    try {
        const { empresaCnpj, anoPA, mesPA, categoria } = req.query;
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await listarDebitosDeclaracao({
            empresaCnpj, anoPA: Number(anoPA), mesPA: Number(mesPA), categoria,
        }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Guias separadas por vencimento: 1 DARF avulso (SICALC) por débito da
// declaração transmitida — PIS/COFINS no dia 25 antecipado, IRPJ/CSLL
// trimestrais no último dia útil do mês seguinte ao trimestre.
router.post('/gerar-darfs-separados', requireAuth, express.json(), async (req, res) => {
    try {
        const { empresaCnpj, anoPA, mesPA, categoria, quotasTrimestrais, apenasCodigos } = req.body || {};
        if (!empresaCnpj || !anoPA || !mesPA) return res.status(400).json({ error: 'empresaCnpj+anoPA+mesPA' });
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await gerarDarfsSeparados({
            empresaCnpj, anoPA, mesPA, categoria, quotasTrimestrais,
            apenasCodigos: Array.isArray(apenasCodigos) ? apenasCodigos : null,
        }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── QUOTAS DO TRIMESTRAL QUE AINDA NÃO PODEM SER GERADAS ───────────────────
//
// Paulo, 13/08: *"as cotas devem ser enviadas todos os meses pois sofrem
// atualização da SELIC"*. A quota 2/3 não é gerada junto com a 1: o acréscimo
// dela depende da SELIC acumulada até o mês anterior ao pagamento, que ainda
// não existe — a guia sairia A MENOR. Ela fica agendada e volta aqui, no mês
// dela, para ser gerada com o número certo.
//
// ATRASADA ENTRA na lista (mesRef <= mês pedido): quota que ninguém emitiu não
// pode sumir quando o mês vira — é justamente ela que está gerando multa.
router.get('/quotas-agendadas', requireAuth, async (req, res) => {
    try {
        const cnpjs = await cnpjsPermitidosParaListagem(req.user);
        if (cnpjs && cnpjs.size === 0) return res.json({ mesRef: null, quotas: [], total: 0, atrasadas: 0 });
        res.json(await listarQuotasAgendadas({
            mesRef: req.query.mesRef,
            cnpjsPermitidos: cnpjs ? [...cnpjs] : null,
        }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Gera a guia de UMA quota agendada. Uma a uma, por ação explícita — a regra
// da casa desde 28/07: imposto não sai em lote, e a SEFAZ/RFB não desfaz
// emissão.
router.post('/quotas-agendadas/emitir', requireAuth, express.json(), async (req, res) => {
    try {
        const id = String(req.body?.id || '');
        if (!id) return res.status(400).json({ error: 'Informe o id da quota agendada.' });
        // O id carrega o CNPJ (idQuotaAgendada) — a checagem de carteira é
        // feita sobre ele, não sobre o que o cliente mandar no corpo.
        const cnpj = id.split('_')[0];
        const carteira = await podeAcessarCnpj(req.user, cnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        res.json(await emitirQuotaAgendada({ id }));
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

/**
 * TRAVA ANTI-RETRABALHO (Paulo, 10/08): encerrar/entregar o MIT com um insumo
 * de OUTRO departamento ainda pendente fecha a DCTFWeb incompleta — e retificar
 * é o retrabalho que a casa única quer matar. A régua é o semáforo (mesmo
 * dado do painel). Só o estado 'incompleto' (PENDENTE de verdade) trava;
 * 'incerto' (consulta caída) NÃO trava — trancar o encerramento porque um
 * serviço piscou seria o dano maior. Prosseguir exige confirmação EXPLÍCITA,
 * que fica AUDITADA com nome e departamento de quem seguiu.
 *
 * Devolve null quando pode seguir; devolve o objeto de resposta 409 quando
 * barra (o handler faz o res.status(409).json).
 */
async function checarTravaInsumos(req, { empresaCnpj, empresaId, anoPA, mesPA }) {
    const competencia = `${anoPA}-${String(mesPA).padStart(2, '0')}`;
    const db = admin.apps.length ? admin.firestore() : (admin.initializeApp({ credential: admin.credential.applicationDefault() }), admin.firestore());
    let semaforo;
    try {
        // A trava reavalia o veredito IGNORANDO o próprio MIT (fiscal) — é o
        // insumo que está sendo entregue neste ato. Trava pelos OUTROS: DP e
        // Contábil.
        const { vereditoInsumos } = await import('./dctfweb-insumos.js');
        const base = await montarSemaforoInsumos(db, { cnpj: limparCnpj(empresaCnpj), competencia, empresaId: empresaId || null });
        semaforo = { ...base, ...vereditoInsumos(base.selos, { ignorarDepartamentos: ['fiscal'] }) };
    } catch (e) {
        // O semáforo caiu inteiro — NÃO trava (indeterminado libera, como no
        // gate de departamento). Loga e segue.
        console.warn('[dctfweb/trava-insumos] semáforo indisponível, seguindo:', e.message);
        return null;
    }
    if (semaforo.veredito !== 'incompleto') return null;
    const confirmou = req.body?.confirmarInsumosPendentes === true;
    if (!confirmou) {
        return {
            bloqueado: true,
            veredito: semaforo.veredito,
            frase: semaforo.frase,
            selos: semaforo.selos,
            acao: 'Confira os insumos pendentes com o departamento responsável. Para encerrar mesmo assim, confirme explicitamente — fica registrado quem seguiu.',
        };
    }
    // Confirmou seguir mesmo com pendência: auditar QUEM e o QUÊ.
    try {
        await db.collection('dctfweb_encerramento_forcado').add({
            em: admin.firestore.FieldValue.serverTimestamp(),
            por: req.user?.email || req.user?.uid || null,
            departamento: (req.user?.departamentos || []).join(',') || null,
            empresaCnpj: limparCnpj(empresaCnpj), competencia,
            veredito: semaforo.veredito,
            pendentes: semaforo.selos.filter((s) => s.estado === 'pendente').map((s) => s.rotulo),
        });
    } catch (e) { console.warn('[dctfweb/trava-insumos] auditoria falhou:', e.message); }
    return null;
}

router.post('/mit/encerrar', requireAuth, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj, anoPA, mesPA, dadosApuracaoMit } = req.body || {};
        if (!empresaCnpj || !anoPA || !mesPA) return res.status(400).json({ error: 'empresaCnpj+anoPA+mesPA' });
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        const trava = await checarTravaInsumos(req, { empresaCnpj, empresaId, anoPA: Number(anoPA), mesPA: Number(mesPA) });
        if (trava) return res.status(409).json(trava);
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
        const { empresaId, empresaCnpj, anoPA, mesPA, tributosApp, transmitir, familiasSelecionadas } = req.body || {};
        if (!empresaCnpj || !anoPA || !mesPA) return res.status(400).json({ error: 'empresaCnpj+anoPA+mesPA' });
        if (!tributosApp || typeof tributosApp !== 'object') {
            return res.status(400).json({ error: 'tributosApp {IRPJ,CSLL,PIS,COFINS,IPI} é obrigatório' });
        }
        const carteira = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });
        // A trava só vale pra ENTREGA de verdade (transmitir=true) — a proposta
        // (transmitir=false) é só conferência e não deve travar.
        if (transmitir === true) {
            const trava = await checarTravaInsumos(req, { empresaCnpj, empresaId, anoPA: Number(anoPA), mesPA: Number(mesPA) });
            if (trava) return res.status(409).json(trava);
        }
        const r = await preencherEncerrarMit({
            empresaId, empresaCnpj,
            anoPA: Number(anoPA), mesPA: Number(mesPA),
            tributosApp,
            familiasSelecionadas: Array.isArray(familiasSelecionadas) ? familiasSelecionadas : null,
            transmitir: transmitir === true,
            usuario: { uid: req.user.uid, email: req.user.email },
        });
        res.json(r);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// RETIFICAÇÃO da apuração MIT já ENCERRADA com os valores do app (reencerra
// via ENCAPURACAO314; a DCTFWeb retificadora é gerada automaticamente pela
// Receita). REQUISITO INEGOCIÁVEL: SOMENTE ADMIN (requireAdmin valida o role
// no Firestore; o orquestrador revalida). Duas fases iguais ao preenchimento:
// transmitir=false → proposta antes→depois (preview obrigatório);
// transmitir=true → remonta tudo no servidor e transmite, com auditoria em
// dctfweb_mit_retificacoes.
router.post('/mit/retificar', requireAdmin, express.json(), async (req, res) => {
    try {
        const { empresaId, empresaCnpj, anoPA, mesPA, tributosApp, transmitir } = req.body || {};
        if (!empresaCnpj || !anoPA || !mesPA) return res.status(400).json({ error: 'empresaCnpj+anoPA+mesPA' });
        if (!tributosApp || typeof tributosApp !== 'object') {
            return res.status(400).json({ error: 'tributosApp {IRPJ,CSLL,PIS,COFINS,IPI} é obrigatório' });
        }
        const r = await retificarMit({
            empresaId, empresaCnpj,
            anoPA: Number(anoPA), mesPA: Number(mesPA),
            tributosApp,
            transmitir: transmitir === true,
            usuario: { uid: req.user.uid, email: req.user.email, role: req.user.role },
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
            if (d._merged_into || d._deleted) return;
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
    if (!secretsMatch(headerSecret, CRON_SECRET)) return res.status(403).json({ erro: 'cron secret invalido' });
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

// ────────────────────────────────────────────────────────────────────────────
// GET /api/admin/dctfweb/insumos?cnpj=&competencia=YYYY-MM[&empresaId=]
//
// SEMÁFORO DE INSUMOS POR DEPARTAMENTO (Paulo, 10/08): a DCTFWeb consolida
// eSocial (DP/Folha, via Folhamatic), Reinf (Contábil) e MIT (Fiscal) — e quem
// transmite precisa VER o que já entrou. Prova por dado real, nunca checkbox:
// eSocial e MIT pelo SERPRO; Reinf pela auditoria do gateway + as retenções
// que o CFI apura nas NFS-e tomadas. Núcleo puro: dctfweb-insumos.js.
// ────────────────────────────────────────────────────────────────────────────
/**
 * Monta o semáforo de insumos (eSocial/Reinf/MIT) de uma empresa×competência.
 * Compartilhado entre a rota /insumos e a TRAVA de encerramento do MIT — os
 * dois têm que ler o MESMO estado, senão o painel diz uma coisa e a trava
 * outra (lição do card 4: painel com conta própria diverge).
 */
async function montarSemaforoInsumos(db, { cnpj, competencia, empresaId }) {
    const [anoPA, mesPA] = competencia.split('-').map(Number);
    const [esocialR, mitR, lotesR, docsR] = await Promise.allSettled([
            (async () => {
                const { consultarESocial } = await import('./nfp-compliance-provider.js');
                return consultarESocial(cnpj, competencia);
            })(),
            consultarApuracaoMit({ empresaCnpj: cnpj, anoPA, mesPA }),
            (async () => {
                const snap = await db.collection('reinf_gateway_lotes')
                    .where('declarante', '==', cnpj).limit(200).get();
                return snap.docs.map((d) => {
                    const x = d.data();
                    return { ...x, em: x.em?.toDate?.()?.toISOString?.() || null };
                });
            })(),
            (async () => {
                const consultas = [db.collection('documentos_fiscais')
                    .where('empresaCnpj', '==', cnpj).where('competencia', '==', competencia)];
                if (empresaId) {
                    consultas.push(db.collection('documentos_fiscais')
                        .where('empresaId', '==', empresaId).where('competencia', '==', competencia));
                }
                const porId = new Map();
                for (const q of consultas) {
                    const docs = await fetchAllDocs(q, { label: `dctfweb-insumos ${cnpj}`, maxDocs: 20000 });
                    for (const s of docs) {
                        const d = s.data() || {};
                        if (d._deleted || d._merged_into) continue;
                        porId.set(s.id, d);
                    }
                }
                return [...porId.values()];
            })(),
        ]);

        const { seloEsocial, seloMit, seloReinf, vereditoInsumos, contarRetencoesTomadas } = await import('./dctfweb-insumos.js');

        const esocial = esocialR.status === 'fulfilled' ? esocialR.value : { ok: false, erro: esocialR.reason?.message };
        let mit;
        if (mitR.status === 'fulfilled') {
            const alvo = mitR.value;
            const situacao = Number(
                alvo?.apuracaoResumo?.situacao ?? alvo?.apuracaoResumo?.situacaoApuracao
                ?? alvo?.apuracaoMit?.situacaoApuracao ?? alvo?.apuracaoMit?.situacao ?? NaN,
            );
            mit = alvo?.apuracaoMit
                ? { ok: true, situacao, descricao: alvo?.apuracaoResumo?.descricaoSituacao || null }
                : { ok: true, situacao: 0, descricao: 'apuração não iniciada' };
        } else {
            mit = { ok: false, erro: mitR.reason?.message };
        }
        // Lote do gateway só conta pra ESTA competência quando o registro diz a
        // competência (gravada no envio desde 10/08). Lote antigo sem o campo
        // não é prova — melhor um 'pendente' conferível que um 'recebido' falso.
        const lotes = lotesR.status === 'fulfilled'
            ? lotesR.value.filter((l) => Array.isArray(l.competencias) && l.competencias.includes(competencia) && l.httpStatus === 201)
            : [];
        const retencoesApuradas = docsR.status === 'fulfilled'
            ? contarRetencoesTomadas(docsR.value, competencia)
            : null;

        const selos = [
            seloEsocial(esocial),
            seloReinf({ lotesGateway: lotes, retencoesApuradas }),
            seloMit(mit),
        ];
        // T4 — "esta competência precisa de retificadora?". A resposta sai do
        // MESMO semáforo, senão o painel diria uma coisa e o alerta outra.
        const { avaliarRetificadora } = await import('./dctfweb-retificadora.js');
        let declaracao = null;
        try {
            const docId = `${cnpj}_${competencia.replace('-', '')}_GERAL_MENSAL`.replace(/[^a-zA-Z0-9_-]/g, '_');
            const snap = await db.collection('dctfweb_declaracoes').doc(docId).get();
            declaracao = snap.exists ? snap.data() : null;
        } catch { declaracao = null; }

        return {
            cnpj, competencia, selos, ...vereditoInsumos(selos),
            retificadora: avaliarRetificadora({ declaracao, selos }),
        };
}

router.get('/insumos', requireAuth, async (req, res) => {
    try {
        const cnpj = limparCnpj(req.query.cnpj);
        const competencia = String(req.query.competencia || '').trim();
        const empresaId = String(req.query.empresaId || '').trim() || null;
        if (cnpj.length !== 14) return res.status(400).json({ ok: false, error: 'cnpj (14 dígitos) é obrigatório' });
        if (!/^\d{4}-\d{2}$/.test(competencia)) return res.status(400).json({ ok: false, error: 'competencia (YYYY-MM) é obrigatória' });
        const acesso = await podeAcessarCnpj(req.user, cnpj);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });
        const db = admin.apps.length ? admin.firestore() : (admin.initializeApp({ credential: admin.credential.applicationDefault() }), admin.firestore());
        const resultado = await montarSemaforoInsumos(db, { cnpj, competencia, empresaId });
        return res.json({ ok: true, ...resultado });
    } catch (e) {
        console.error('[dctfweb/insumos]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
