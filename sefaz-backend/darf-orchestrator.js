// ============================================================================
// sefaz-backend/darf-orchestrator.js
// Orquestra emissao + persistencia de DARFs no Firestore.
// ============================================================================

import admin from 'firebase-admin';
import { getDarfProvider, getDarfMode } from './darf-provider.js';
import { assertEmissaoLiberada } from './emissao-guard.js';
import { fetchAllDocs, commitUpdatesInChunks } from './firestore-paginate.js';
import { calcularMultaDarf } from './multa-calculator.js';
import { normalizarCompetencia } from './competencia.js';
import { limparCnpj } from './documento-dv.js';

const COLLECTION = 'darfs_emitidos';

/**
 * 🚨 O `docId` LEVAVA O CNPJ CRU (03/09): com máscara, a pontuação virava `_`
 * e o mesmo DARF ganhava outro id. Sai sempre sem máscara; CNPJ sem 14
 * posições não identifica empresa e é RECUSADO nomeado.
 */
function cnpjParaId(cnpj) {
    const limpo = limparCnpj(cnpj);
    if (limpo.length !== 14) {
        const err = new Error(`CNPJ inválido ("${String(cnpj ?? '')}") — ele identifica o DARF emitido e o contribuinte no SICALC.`);
        err.httpStatus = 400;
        throw err;
    }
    return limpo;
}

/**
 * 🚨 A COMPETÊNCIA ENTRAVA CRUA NO DARF (03/09). Chegando `07/2026`, o
 * provider fazia `replace(/\D/g,'').slice(0,6)` = `072026` — período de
 * apuração ano **0720**, mês **26**, no código de barras e no número do
 * documento — e `darf_guias` gravava o texto como veio, então a listagem por
 * competência nunca o achava. A porta normaliza pelo dono (como o DAS) e
 * RECUSA o ilegível dizendo as DUAS consequências.
 */
function competenciaNormalizadaOuErro(bruta) {
    const n = normalizarCompetencia(bruta);
    if (n) return n;
    const err = new Error(
        `Competência inválida: "${String(bruta ?? '')}". Use AAAA-MM (ex.: 2026-07). `
        + 'Ela vai ao SICALC como período de apuração e identifica o DARF emitido — forma '
        + 'diferente declara outro período e ainda deixa emitir a MESMA guia duas vezes.',
    );
    err.httpStatus = 400;
    throw err;
}

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Emite uma DARF e persiste no Firestore.
 *
 * @param {object} req
 *   empresaId, empresaCnpj, empresaNome,
 *   regime ('Presumido'|'Real'),
 *   tributo ('IRPJ'|'CSLL'|'PIS'|'COFINS'|'IRRF'),
 *   competencia ('YYYY-MM'),
 *   valor (decimal, principal),
 *   periodicidade? ('mensal'|'trimestral'),
 *   codigoReceita? (override),
 *   vencimento? (override),
 *   dataPagamento? (se atrasado),
 *   descricao?, observacao?
 */
export async function emitirDarf(req) {
    assertEmissaoLiberada('DARF');
    const {
        empresaId, empresaCnpj, empresaNome,
        regime, tributo, valor,
    } = req;
    if (!empresaId || !empresaCnpj || !regime || !tributo || !req.competencia || !valor) {
        throw new Error('Campos obrigatorios: empresaId, empresaCnpj, regime, tributo, competencia, valor');
    }
    const competencia = competenciaNormalizadaOuErro(req.competencia);
    const cnpjId = cnpjParaId(empresaCnpj);

    const provider = getDarfProvider();
    const mode = getDarfMode();
    // O provider recebe a competência JÁ normalizada — é dela que saem o
    // período de apuração (AAAAMM) e o número do documento.
    const darf = await provider.gerarDarf({ ...req, competencia });

    const db = fa().firestore();
    const docId = `${cnpjId}_${competencia}_${tributo}_${Date.now()}`
        .replace(/[^a-zA-Z0-9_-]/g, '_');

    const payload = {
        empresaId,
        empresaCnpj,
        empresaNome: empresaNome || '',
        regime,
        tributo,
        competencia,
        periodicidade: req.periodicidade || (tributo === 'IRPJ' || tributo === 'CSLL' ? 'trimestral' : 'mensal'),
        descricao: req.descricao || '',
        observacao: req.observacao || '',
        ...darf,
        emitidoEm: new Date().toISOString(),
        modeUsado: mode,
        statusPagamento: 'pendente',
        dataPagamento: null,
    };
    await db.collection(COLLECTION).doc(docId).set(payload, { merge: true });
    return { id: docId, ...payload };
}

// Filtra docs pela carteira do colaborador. cnpjsPermitidos === null => admin
// (sem restrição). Set vazio => sem carteira (nada). Compara só dígitos.
function filtrarPorCarteira(docs, cnpjsPermitidos) {
    if (!(cnpjsPermitidos instanceof Set)) return docs; // null/undefined = admin
    return docs.filter((d) => cnpjsPermitidos.has(String(d.empresaCnpj || '').replace(/\D/g, '')));
}

/**
 * Lista DARFs com filtros opcionais, ESCOPADO por carteira.
 * @param {Set<string>|null} cnpjsPermitidos  null = admin; Set = só esses CNPJs.
 */
export async function listarDarfs({ empresaId, competencia, tributo, status, regime } = {}, cnpjsPermitidos = null) {
    const db = fa().firestore();
    let q = db.collection(COLLECTION);
    if (empresaId)   q = q.where('empresaId',       '==', empresaId);
    if (competencia) q = q.where('competencia',     '==', competencia);
    if (tributo)     q = q.where('tributo',         '==', tributo);
    if (regime)      q = q.where('regime',          '==', regime);
    if (status)      q = q.where('statusPagamento', '==', status);

    const snap = await q.limit(500).get();
    const docs = filtrarPorCarteira(snap.docs.map(d => ({ id: d.id, ...d.data() })), cnpjsPermitidos);
    docs.sort((a, b) => (b.emitidoEm || '').localeCompare(a.emitidoEm || ''));
    return docs;
}

/**
 * Resumo agregado pra dashboard, ESCOPADO por carteira.
 * @param {Set<string>|null} cnpjsPermitidos  null = admin; Set = só esses CNPJs.
 */
export async function getResumoDarf(cnpjsPermitidos = null) {
    const db = fa().firestore();
    const docs = filtrarPorCarteira(
        (await fetchAllDocs(db.collection(COLLECTION), { label: 'darf_emitidos/resumo' })).map(d => d.data()),
        cnpjsPermitidos,
    );

    const hoje = new Date().toISOString().slice(0, 10);
    let pendentes = 0, vencidos = 0, pagos = 0;
    let valorPendente = 0, valorVencido = 0, valorPago = 0;
    let valorMultaEstimada = 0;
    const porTributo = {};

    for (const d of docs) {
        const status = d.statusPagamento || 'pendente';
        const venc = d.vencimento || '';
        if (status === 'pago') {
            pagos++;
            valorPago += d.valor || 0;
        } else if (venc && venc < hoje) {
            vencidos++;
            valorVencido += d.valor || 0;
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
        const t = d.tributo || 'OUTROS';
        if (!porTributo[t]) porTributo[t] = { qtd: 0, valor: 0 };
        porTributo[t].qtd += 1;
        porTributo[t].valor += d.valor || 0;
    }
    return {
        totalDarfs: docs.length,
        pendentes, vencidos, pagos,
        valorPendente, valorVencido,
        valorVencidoAtualizado: +(valorVencido + valorMultaEstimada).toFixed(2),
        valorMultaEstimada: +valorMultaEstimada.toFixed(2),
        valorPago,
        porTributo,
        mode: getDarfMode(),
    };
}

/**
 * Marca DARF como paga, VERIFICANDO a carteira antes.
 * @param {Set<string>|null} cnpjsPermitidos  null = admin; Set = só esses CNPJs.
 */
export async function marcarPago(docId, dataPagamento, cnpjsPermitidos = null) {
    const db = fa().firestore();
    const ref = db.collection(COLLECTION).doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
        const e = new Error('DARF não encontrado'); e.httpStatus = 404; throw e;
    }
    if (cnpjsPermitidos instanceof Set) {
        const cnpj = String(snap.data().empresaCnpj || '').replace(/\D/g, '');
        if (!cnpjsPermitidos.has(cnpj)) {
            const e = new Error('DARF não pertence à sua carteira'); e.httpStatus = 403; throw e;
        }
    }
    await ref.update({
        statusPagamento: 'pago',
        dataPagamento: dataPagamento || new Date().toISOString().slice(0, 10),
    });
    return { ok: true };
}

/**
 * Atualiza vencidos (similar ao cron do DAS).
 */
export async function processarVencimentos() {
    const db = fa().firestore();
    const hoje = new Date().toISOString().slice(0, 10);
    const snapDocs = await fetchAllDocs(db.collection(COLLECTION), { label: 'darf_emitidos/cron' });
    const stats = { total: snapDocs.length, atualizados: 0 };
    const updates = [];

    for (const doc of snapDocs) {
        const d = doc.data();
        if ((d.statusPagamento || 'pendente') !== 'pendente' && (d.statusPagamento !== 'vencido')) continue;
        if (!d.vencimento) continue;
        if (d.vencimento < hoje) {
            // Calcula atualizacao monetaria (Lei 9.430/96 art. 61) e persiste.
            // Atualiza a cada execucao do cron — dias passam, multa cresce ate 20%.
            const calc = d.valor > 0
                ? calcularMultaDarf(d.valor, new Date(d.vencimento), new Date(hoje))
                : null;
            const multaEstimada = calc ? {
                dias: calc.dias,
                multaPct: calc.multaPct,
                multaValor: calc.multaValor,
                jurosPct: calc.jurosPct,
                jurosValor: calc.jurosValor,
                total: calc.total,
                calculadoEm: hoje,
            } : null;

            const updateData = { atualizadoEm: new Date().toISOString() };
            const eraPendente = (d.statusPagamento || 'pendente') === 'pendente';
            if (eraPendente) {
                updateData.statusPagamento = 'vencido';
                stats.atualizados++;
            }
            if (multaEstimada) updateData.multaEstimada = multaEstimada;
            updates.push({ ref: doc.ref, data: updateData });
        }
    }
    await commitUpdatesInChunks(db, updates);
    return stats;
}
