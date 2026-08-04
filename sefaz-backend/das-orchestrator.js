// ============================================================================
// sefaz-backend/das-orchestrator.js
// Orquestra emissao + persistencia de DAS no Firestore.
// ============================================================================

import admin from 'firebase-admin';
import { getDasProvider, getDasMode } from './das-provider.js';
import { assertEmissaoLiberada } from './emissao-guard.js';
import { fetchAllDocs, commitUpdatesInChunks } from './firestore-paginate.js';
import { calcularMultaDarf } from './multa-calculator.js';
import { assertValorMinimoDas } from './das-valor-utils.js';
import { criarErroDuplicidadeDas, encontrarConflitoDasAvulso } from './das-duplicidade-utils.js';
import { lerCodigoAtividadeSup } from './pgdas-atividade-config.js';

const COLLECTION = 'das_emitidos';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Emite DAS regular (com PGDAS-D transmitido antes).
 *
 * @param {object} req { empresaId, empresaCnpj, empresaNome, competencia, valor, opts? }
 * @returns {object} doc DAS persistido
 */
export async function emitirDasRegular(req) {
    assertEmissaoLiberada('DAS');
    const { empresaId, empresaCnpj, empresaNome, competencia, dadosPgdas } = req;
    if (!empresaId || !empresaCnpj || !competencia || req.valor == null || req.valor === '') {
        throw new Error('Campos obrigatorios: empresaId, empresaCnpj, competencia, valor');
    }
    const valor = assertValorMinimoDas(req.valor);

    // Defesa em profundidade: a tela já recusa, mas um cliente desatualizado
    // (ou outro caminho) não pode transmitir declaração cuja natureza o app
    // ainda não sabe montar. Os motivos vêm no meta `_bloqueios` do payload.
    const bloqueios = Array.isArray(dadosPgdas?._bloqueios) ? dadosPgdas._bloqueios : [];
    if (bloqueios.length > 0) {
        const err = new Error(bloqueios.join(' '));
        err.httpStatus = 400;
        throw err;
    }

    // O cliente pode estar desatualizado (ou ter cache velho): quem decide se o
    // código do ISS fixo existe é o BANCO, não a lista que veio do navegador.
    if (dadosPgdas?._temSup) {
        const cfg = await lerCodigoAtividadeSup(fa().firestore());
        if (!cfg) {
            const err = new Error(
                'Receita marcada como ISS fixo (SUP) e o código oficial dessa atividade ainda não '
                + 'está cadastrado. Transmitir agora declararia "ISS retido pelo tomador" — valor '
                + 'certo, natureza errada. O que fazer: um administrador cadastra o código na tela '
                + 'do Simples (botão "🔎 Atividades declaradas"); enquanto isso, entregue esta '
                + 'competência direto no e-CAC.',
            );
            err.httpStatus = 400;
            throw err;
        }
    }

    const provider = getDasProvider();
    const mode = getDasMode();

    // 1. Transmite PGDAS-D (com payload detalhado se vier do frontend)
    const pgdas = await provider.transmitirPgdasD({ empresaCnpj, competencia, valor, dadosPgdas });

    // 2. Gera o DAS
    const das = await provider.gerarDas({ empresaCnpj, competencia, valor, tipo: 'regular' });

    // 3. Persiste no Firestore
    const db = fa().firestore();
    const docId = `${empresaCnpj}_${competencia}_regular`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const payload = {
        empresaId,
        empresaCnpj,
        empresaNome: empresaNome || '',
        competencia,
        tipo: 'regular',
        valor,
        ...das,
        pgdasRecibo: pgdas.recibo,
        pgdasNumeroDeclaracao: pgdas.numeroDeclaracao || '',
        pgdasTipoDeclaracao: pgdas.tipoDeclaracao || 1,
        pgdasTransmitidoEm: pgdas.transmitidoEm,
        emitidoEm: new Date().toISOString(),
        modeUsado: mode,
        statusPagamento: 'pendente',  // pago | pendente | vencido
        dataPagamento: null,
    };
    await db.collection(COLLECTION).doc(docId).set(payload, { merge: true });
    return { id: docId, ...payload };
}

/**
 * Emite DAS avulso (sem PGDAS-D — caso de complementar, atrasado, etc).
 */
export async function emitirDasAvulso(req) {
    assertEmissaoLiberada('DAS');
    const { empresaId, empresaCnpj, empresaNome, competencia, descricao } = req;
    if (!empresaId || !empresaCnpj || !competencia || req.valor == null || req.valor === '') {
        throw new Error('Campos obrigatorios: empresaId, empresaCnpj, competencia, valor');
    }
    const valor = assertValorMinimoDas(req.valor);

    const db = fa().firestore();
    const existentesSnap = await db.collection(COLLECTION)
        .where('empresaId', '==', empresaId)
        .limit(1000)
        .get();
    const existentes = existentesSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => d.competencia === competencia);
    const conflito = encontrarConflitoDasAvulso(existentes, { competencia, valor });
    if (conflito) throw criarErroDuplicidadeDas(conflito);

    const provider = getDasProvider();
    const mode = getDasMode();
    const das = await provider.gerarDas({ empresaCnpj, competencia, valor, tipo: 'avulso' });

    const docId = `${empresaCnpj}_${competencia}_avulso_${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const payload = {
        empresaId,
        empresaCnpj,
        empresaNome: empresaNome || '',
        competencia,
        tipo: 'avulso',
        descricao: descricao || '',
        valor,
        ...das,
        emitidoEm: new Date().toISOString(),
        modeUsado: mode,
        statusPagamento: 'pendente',
        dataPagamento: null,
    };
    await db.collection(COLLECTION).doc(docId).set(payload, { merge: true });
    return { id: docId, ...payload };
}

/**
 * Lista DAS emitidos com filtros opcionais.
 */
// Campos LEVES da listagem — o doc guarda o PDF inteiro em base64 (spread
// `...das` do emitir), e ler 500 docs completos derrubava a instância por
// memória (Central de DAS 500 sem JSON, 03/08 — estourou quando o cron
// mensal emitiu a leva de agosto). O PDF sai por getDasPdf, um doc por vez.
const CAMPOS_LISTAGEM = [
    'empresaId', 'empresaCnpj', 'empresaNome', 'competencia', 'tipo',
    'valor', 'vencimento', 'statusPagamento', 'dataPagamento', 'emitidoEm',
    'modeUsado', 'numeroDocumento', 'codigoBarras', 'descricao', 'pdfUrl',
    'ultimoEnvioCliente', 'pgdasRecibo',
];

export async function listarDas({ empresaId, competencia, status } = {}) {
    const db = fa().firestore();
    let q = db.collection(COLLECTION).select(...CAMPOS_LISTAGEM);
    if (empresaId) q = q.where('empresaId', '==', empresaId);
    if (competencia) q = q.where('competencia', '==', competencia);
    if (status) q = q.where('statusPagamento', '==', status);

    const snap = await q.limit(500).get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => (b.emitidoEm || '').localeCompare(a.emitidoEm || ''));
    return docs;
}

/** PDF/base64 de UM DAS — buscado sob demanda (baixar/imprimir/enviar). */
export async function getDasPdf(id) {
    const db = fa().firestore();
    const snap = await db.collection(COLLECTION).doc(String(id)).get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    return { id: snap.id, empresaId: d.empresaId || null, pdfBase64: d.pdfBase64 || null, pdfUrl: d.pdfUrl || null };
}

/**
 * Resumo agregado pra dashboard "Central de DAS".
 */
export async function getResumoDas() {
    const db = fa().firestore();
    // select: a conta só usa 3 campos — ler os docs inteiros (com pdfBase64)
    // tinha o mesmo risco de memória da listagem (03/08).
    const docs = (await fetchAllDocs(
        db.collection(COLLECTION).select('statusPagamento', 'vencimento', 'valor'),
        { label: 'das_emitidos/resumo' },
    )).map(d => d.data());

    const hoje = new Date().toISOString().slice(0, 10);
    let pendentes = 0, vencidos = 0, pagos = 0;
    let valorPendente = 0, valorVencido = 0, valorPago = 0;
    let valorMultaEstimada = 0;

    for (const d of docs) {
        const status = d.statusPagamento || 'pendente';
        const venc = d.vencimento || '';
        if (status === 'pago') {
            pagos++;
            valorPago += d.valor || 0;
        } else if (venc && venc < hoje) {
            vencidos++;
            valorVencido += d.valor || 0;
            // Soma multa+juros do snapshot persistido pelo cron (se houver).
            // Pra DAS vencidos sem snapshot, calcula on-the-fly como fallback.
            const me = d.multaEstimada;
            if (me && me.calculadoEm === hoje) {
                valorMultaEstimada += (me.multaValor || 0) + (me.jurosValor || 0);
            } else if (d.valor > 0) {
                const calc = calcularMultaDarf(d.valor, new Date(venc), new Date(hoje));
                if (calc) valorMultaEstimada += (calc.multaValor || 0) + (calc.jurosValor || 0);
            }
        } else {
            pendentes++;
            valorPendente += d.valor || 0;
        }
    }
    return {
        totalDas: docs.length,
        pendentes, vencidos, pagos,
        valorPendente, valorVencido,
        valorVencidoAtualizado: +(valorVencido + valorMultaEstimada).toFixed(2),
        valorMultaEstimada: +valorMultaEstimada.toFixed(2),
        valorPago,
        mode: getDasMode(),
    };
}

/**
 * Processamento noturno: atualiza status, identifica vencimentos proximos.
 *
 * Comportamento:
 * - DAS pendente com vencimento < hoje -> status 'vencido'
 * - DAS pendente com vencimento entre hoje e hoje+5d -> mantido 'pendente'
 *   mas listado em 'aVencerEm5Dias'
 * - DAS pago: ignorado
 *
 * Logs salvos em 'das_cron_logs' (Firestore) pra auditoria.
 */
export async function processarCronDas() {
    const db = fa().firestore();
    const hoje = new Date().toISOString().slice(0, 10);
    const cincoDiasFrente = (() => {
        const d = new Date(); d.setDate(d.getDate() + 5);
        return d.toISOString().slice(0, 10);
    })();

    const snapDocs = await fetchAllDocs(db.collection(COLLECTION), { label: 'das_emitidos/cron' });
    const stats = {
        totalDas: snapDocs.length,
        vencidos: 0,
        aVencer: 0,
        pagos: 0,
        atualizadosParaVencido: 0,
        empresasComVencido: new Set(),
        empresasComProximoVencimento: new Set(),
        valorVencidoTotal: 0,
    };
    const aVencerLista = [];
    const vencidosLista = [];

    const updates = [];

    for (const doc of snapDocs) {
        const d = doc.data();
        const status = d.statusPagamento || 'pendente';
        if (status === 'pago') {
            stats.pagos++;
            continue;
        }
        const venc = d.vencimento || '';
        if (!venc) continue;

        if (venc < hoje) {
            // Esta vencido: atualiza status se ainda nao foi + persiste estimativa
            // de atualizacao monetaria (Lei 9.430/96 art. 61 + LC 123 art. 35).
            // SELIC e estimativa conservadora; valor REAL vem do SERPRO ao re-emitir.
            stats.vencidos++;
            stats.valorVencidoTotal += d.valor || 0;
            stats.empresasComVencido.add(d.empresaCnpj);

            const multaEst = d.valor > 0
                ? calcularMultaDarf(d.valor, new Date(venc), new Date(hoje))
                : null;
            const multaEstimadaDoc = multaEst ? {
                dias: multaEst.dias,
                multaPct: multaEst.multaPct,
                multaValor: multaEst.multaValor,
                jurosPct: multaEst.jurosPct,
                jurosValor: multaEst.jurosValor,
                total: multaEst.total,
                calculadoEm: hoje,
            } : null;

            vencidosLista.push({
                empresaCnpj: d.empresaCnpj,
                empresaNome: d.empresaNome || '',
                competencia: d.competencia,
                valor: d.valor,
                vencimento: venc,
                diasAtraso: Math.floor((new Date(hoje) - new Date(venc)) / 86400000),
                multaEstimada: multaEstimadaDoc,
            });

            // Persiste status 'vencido' (se mudou) + sempre atualiza multaEstimada
            // (mesmo se ja era vencido — dias passam, valores mudam).
            const updateData = { atualizadoEm: new Date().toISOString() };
            if (status !== 'vencido') {
                updateData.statusPagamento = 'vencido';
                stats.atualizadosParaVencido++;
            }
            if (multaEstimadaDoc) {
                updateData.multaEstimada = multaEstimadaDoc;
            }
            updates.push({ ref: doc.ref, data: updateData });
        } else if (venc <= cincoDiasFrente) {
            // Proximo vencimento
            stats.aVencer++;
            stats.empresasComProximoVencimento.add(d.empresaCnpj);
            aVencerLista.push({
                empresaCnpj: d.empresaCnpj,
                empresaNome: d.empresaNome || '',
                competencia: d.competencia,
                valor: d.valor,
                vencimento: venc,
                diasRestantes: Math.floor((new Date(venc) - new Date(hoje)) / 86400000),
            });
        }
    }

    await commitUpdatesInChunks(db, updates);

    return {
        ...stats,
        empresasComVencido: stats.empresasComVencido.size,
        empresasComProximoVencimento: stats.empresasComProximoVencimento.size,
        valorVencidoTotal: +stats.valorVencidoTotal.toFixed(2),
        aVencerLista: aVencerLista.slice(0, 30),  // top 30 pra log nao explodir
        vencidosLista: vencidosLista.slice(0, 30),
    };
}

/**
 * Marca DAS como pago.
 */
export async function marcarPago(docId, dataPagamento) {
    const db = fa().firestore();
    await db.collection(COLLECTION).doc(docId).update({
        statusPagamento: 'pago',
        dataPagamento: dataPagamento || new Date().toISOString().slice(0, 10),
    });
    return { ok: true };
}
