// ============================================================================
// sefaz-backend/caixa-postal-orchestrator.js
// Sincroniza mensagens entre o provider (mock/SERPRO) e o Firestore.
// Suporta multi-canal: eCAC, DET, DEC, DJE, e-MAC, Prefeitura SP.
// ============================================================================

import admin from 'firebase-admin';
import { getCaixaPostalProvider, getProviderMode, CANAIS_DISPONIVEIS } from './caixa-postal-provider.js';
import { fetchAllDocs } from './firestore-paginate.js';

const COLLECTION = 'caixa_postal_mensagens';

// Cache de nomes de empresa por CNPJ — populado no primeiro lookup de cada sync.
// Reset a cada sincronizarTodas pra pegar mudancas.
let _nomeCache = new Map();

function _normCnpj(c) { return String(c || '').replace(/\D/g, ''); }

async function _carregarNomes() {
    if (_nomeCache.size > 0) return;
    const db = fa().firestore();
    const colecoes = ['simples_empresas', 'lucro_empresas'];
    for (const col of colecoes) {
        const snap = await db.collection(col).get();
        snap.forEach(d => {
            const x = d.data();
            if (x.cnpj && x.nome) {
                _nomeCache.set(_normCnpj(x.cnpj), x.nome);
            }
        });
    }
}

function _resetCache() { _nomeCache = new Map(); }


function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Sincroniza a caixa postal de uma empresa: chama TODOS os canais via
 * listarTodasMensagens, persiste novos, preserva o estado de leitura local.
 */
export async function sincronizarEmpresa(empresaId, empresaCnpj) {
    const db = fa().firestore();
    const provider = getCaixaPostalProvider();
    const mode = getProviderMode();

    await _carregarNomes();

    // Em SERPRO: tentava primeiro INNOVAMSG63 (chamada barata pra checar se tem msg nova).
    // Mas o SERPRO retorna AcessoNegado-ICGERENCIADOR-017 (403) consistentemente — esse
    // idServico nao funciona pra contratante/autor=SP Assessoria. Cada tentativa gasta 1
    // chamada SERPRO cobrada + polui logs com business_error que nao eh erro de verdade.
    //
    // Estrategia atual: pula direto pro listarTodasMensagens. Quando o SERPRO corrigir o
    // INNOVAMSG63, setar env SERPRO_CAIXA_POSTAL_USE_INNOVAMSG63=true reativa sem deploy.
    const useInnovamsg63 = process.env.SERPRO_CAIXA_POSTAL_USE_INNOVAMSG63 === 'true';
    if (useInnovamsg63 && mode === 'serpro' && typeof provider.temNovasMensagens === 'function') {
        try {
            const r = await provider.temNovasMensagens(empresaCnpj);
            if (!r.temNovas) {
                return { mode, total: 0, novas: 0, atualizadas: 0, skipped: true, reason: 'INNOVAMSG63=sem novas' };
            }
        } catch (err) {
            console.warn(`[caixa-postal] INNOVAMSG63 falhou pra ${empresaCnpj}: ${err.message}, tentando lista direto`);
        }
    }

    // Chama todos os canais em paralelo via listarTodasMensagens
    let mensagensRemotas;
    let canaisStatus = {};

    if (typeof provider.listarTodasMensagens === 'function') {
        const resultado = await provider.listarTodasMensagens(empresaCnpj);
        mensagensRemotas = resultado.mensagens;
        canaisStatus = resultado.canais || {};
    } else {
        // Fallback: só eCAC (compatibilidade com providers antigos)
        mensagensRemotas = await provider.listarMensagens(empresaCnpj);
    }

    // Lê estado de leitura atual do Firestore pra preservar
    // 23/05: usa CNPJ normalizado pra bater com docs ja limpos
    const snap = await db.collection(COLLECTION)
        .where('empresaCnpj', '==', _normCnpj(empresaCnpj))
        .get();

    const lidasLocais = new Map();
    snap.forEach(doc => {
        const d = doc.data();
        if (d.dataLeitura) lidasLocais.set(d.mensagemId, d.dataLeitura);
    });

    // Coleta operacoes pra chunking (Firestore limita 500 ops/batch). Sem o
    // chunking, primeira sync de empresa com historico grande (>500 mensagens
    // RFB acumuladas) estouraria o batch e perderia escritas silenciosamente.
    const operacoes = [];
    let novas = 0, atualizadas = 0;
    const porCanal = {};

    // 23/05: normaliza empresaCnpj defensivamente.
    // SERPRO as vezes retorna CNPJ formatado; salvar sempre limpo previne
    // 746 mensagens com formatacao suja que vimos hoje.
    const empresaCnpjLimpo = _normCnpj(empresaCnpj);

    for (const msg of mensagensRemotas) {
        const docId = `${empresaCnpjLimpo}_${msg.mensagemId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        const ref = db.collection(COLLECTION).doc(docId);
        const dataLeituraLocal = lidasLocais.get(msg.mensagemId) || msg.dataLeitura || null;

        const empresaNome = _nomeCache.get(empresaCnpjLimpo) || '';

        // Normaliza fonte: mock messages usam o canal real (ecac, det, etc)
        const fonte = msg.fonte || (mode === 'mock' ? 'ecac' : mode);

        const payload = {
            empresaId,
            empresaCnpj: empresaCnpjLimpo,
            empresaNome,
            mensagemId: msg.mensagemId,
            assunto: msg.assunto || '',
            remetente: msg.remetente || '',
            categoria: msg.categoria || 'informativo',
            corpo: msg.corpo || '',
            dataEnvio: msg.dataEnvio,
            dataLeitura: dataLeituraLocal,
            fonte,
            prazoResposta: msg.prazoResposta || null,
            ultimaSincronizacao: new Date().toISOString(),
        };
        operacoes.push({ ref, payload });

        // Contabiliza por canal
        if (!porCanal[fonte]) porCanal[fonte] = { total: 0, novas: 0 };
        porCanal[fonte].total++;

        if (lidasLocais.has(msg.mensagemId)) {
            atualizadas++;
        } else {
            novas++;
            if (porCanal[fonte]) porCanal[fonte].novas++;
        }
    }

    // Commita em lotes de 450 (margem de seguranca sobre o teto 500 do Firestore)
    const CHUNK = 450;
    for (let i = 0; i < operacoes.length; i += CHUNK) {
        const batch = db.batch();
        const slice = operacoes.slice(i, i + CHUNK);
        for (const op of slice) batch.set(op.ref, op.payload, { merge: true });
        await batch.commit();
    }

    return { mode, total: mensagensRemotas.length, novas, atualizadas, porCanal, canaisStatus };
}

/**
 * Sincroniza TODAS as empresas (Simples + Lucro Presumido/Real).
 */
export async function sincronizarTodasEmpresas() {
    _resetCache();
    const db = fa().firestore();
    const empresas = [];

    const simplesSnap = await db.collection('simples_empresas').get();
    simplesSnap.forEach(d => {
        const x = d.data();
        if (x._merged_into) return; // 23/05: ignora perdedores do merge
        empresas.push({ id: d.id, ...x });
    });

    const lucroSnap = await db.collection('lucro_empresas').get();
    lucroSnap.forEach(d => {
        const x = d.data();
        if (x._merged_into) return; // 23/05: ignora perdedores do merge
        empresas.push({ id: d.id, ...x });
    });

    const stats = { totalEmpresas: empresas.length, sucesso: 0, falha: 0, skipped: 0, detalhes: [] };
    for (const emp of empresas) {
        if (!emp.cnpj) continue;
        try {
            const r = await sincronizarEmpresa(emp.id, emp.cnpj);
            stats.sucesso++;
            if (r.skipped) stats.skipped++;
            stats.detalhes.push({ empresa: emp.nome, ...r });
        } catch (err) {
            stats.falha++;
            console.warn(`[caixa-postal] ${emp.nome}: ${err.message}`);
        }
    }
    return stats;
}

/**
 * Lista mensagens do Firestore com filtros.
 */
export async function listarMensagensLocais({ empresaCnpj, naoLidas, categoria, fonte } = {}) {
    const db = fa().firestore();
    let snapDocs;

    try {
        let q = db.collection(COLLECTION);
        if (empresaCnpj) q = q.where('empresaCnpj', '==', empresaCnpj);
        if (categoria) q = q.where('categoria', '==', categoria);
        if (fonte) q = q.where('fonte', '==', fonte);
        snapDocs = await fetchAllDocs(q.orderBy('dataEnvio', 'desc'), { label: 'caixa_postal/composta' });
    } catch (err) {
        console.warn('[caixa-postal] Query composta falhou, fallback simples:', err.message);
        try {
            let q2 = db.collection(COLLECTION);
            if (empresaCnpj) q2 = q2.where('empresaCnpj', '==', empresaCnpj);
            snapDocs = await fetchAllDocs(q2.orderBy('dataEnvio', 'desc'), { label: 'caixa_postal/ordenada' });
        } catch (err2) {
            console.warn('[caixa-postal] Query ordenada falhou, fallback sem ordem:', err2.message);
            let q3 = db.collection(COLLECTION);
            if (empresaCnpj) q3 = q3.where('empresaCnpj', '==', empresaCnpj);
            snapDocs = await fetchAllDocs(q3, { label: 'caixa_postal/sem-ordem' });
        }
    }

    let docs = snapDocs.map(d => ({ id: d.id, ...d.data() }));
    if (fonte) docs = docs.filter(d => d.fonte === fonte);
    if (categoria) docs = docs.filter(d => d.categoria === categoria);
    if (naoLidas) docs = docs.filter(d => !d.dataLeitura);
    docs.sort((a, b) => {
        const da = a.dataEnvio?._seconds || a.dataEnvio || 0;
        const db2 = b.dataEnvio?._seconds || b.dataEnvio || 0;
        return db2 - da;
    });
    return docs;
}

/**
 * Resumo agregado pra dashboard global.
 */
export async function getResumoGlobal(cnpjsPermitidos = null) {
    const db = fa().firestore();
    const FONTES = ['ecac', 'det', 'dec', 'dje', 'emac', 'prefeitura_sp'];

    // 23/05 Patch B: usa aggregation queries (.count()) em vez de baixar todos
    // os docs. 4091 reads -> ~6 reads por chamada. Latencia ~50ms vs ~2s.
    //
    // Caminho rapido: admin (sem filtro de carteira) — usa count().
    if (cnpjsPermitidos === null) {
        const col = db.collection(COLLECTION);
        const CATS = ['intimacao', 'malha', 'exclusao', 'informativo',
                      'det_notificacao', 'det_auto_infracao',
                      'dec_intimacao', 'dec_comunicado',
                      'dje_citacao', 'dje_intimacao',
                      'emac_notificacao',
                      'prefeitura_sp_nfse', 'prefeitura_sp_iss', 'prefeitura_sp_comunicado'];

        // Counts em paralelo: total geral + não-lidas por categoria + não-lidas por fonte
        const safeCount = (q) => q.count().get().catch(() => ({ data: () => ({ count: 0 }) }));
        const [totalAgg, ...restos] = await Promise.all([
            col.count().get(),
            ...CATS.map(c =>
                safeCount(col.where('categoria', '==', c).where('dataLeitura', '==', null))
            ),
            ...FONTES.map(f =>
                safeCount(col.where('fonte', '==', f).where('dataLeitura', '==', null))
            ),
        ]);

        const porCategoria = {};
        CATS.forEach((c, i) => {
            const n = restos[i].data().count;
            if (n > 0) porCategoria[c] = n;
        });

        const naoLidasPorFonte = {};
        FONTES.forEach((f, i) => {
            const n = restos[CATS.length + i].data().count;
            naoLidasPorFonte[f] = n;
        });

        const naoLidasTotal = Object.values(porCategoria).reduce((a, b) => a + b, 0);

        // Empresas com criticas: precisa fetch (~48 docs hoje, bem menor que 4091).
        const criticasCats = ['intimacao', 'malha', 'exclusao',
                              'det_notificacao', 'det_auto_infracao',
                              'dec_intimacao', 'dje_citacao', 'dje_intimacao',
                              'prefeitura_sp_iss'];
        // Firestore 'in' limit = 30, estamos com 9 — ok
        const criticasSnap = await col
            .where('categoria', 'in', criticasCats)
            .where('dataLeitura', '==', null)
            .select('empresaCnpj')
            .get();
        const empresasComCriticas = new Set(
            criticasSnap.docs.map(d => d.data().empresaCnpj)
        );

        return {
            totalMensagens: totalAgg.data().count,
            naoLidasTotal,
            naoLidasPorCategoria: porCategoria,
            naoLidasPorFonte,
            empresasComCriticas: empresasComCriticas.size,
            mode: getProviderMode(),
        };
    }

    // Caminho carteira (colaborador): mantem agregacao em memoria.
    // Firestore 'where in' tem limite 30 valores e colaborador pode ter 50+ empresas.
    const snap = await db.collection(COLLECTION)
        .select('empresaCnpj', 'categoria', 'dataLeitura', 'fonte')
        .get();
    let docs = snap.docs.map(d => d.data());

    const permitidos = new Set(cnpjsPermitidos.map(_normCnpj));
    docs = docs.filter(d => permitidos.has(_normCnpj(d.empresaCnpj)));

    const naoLidas = docs.filter(d => !d.dataLeitura);
    const porCategoria = {};
    const naoLidasPorFonte = {};
    FONTES.forEach(f => { naoLidasPorFonte[f] = 0; });

    for (const d of naoLidas) {
        porCategoria[d.categoria] = (porCategoria[d.categoria] || 0) + 1;
        if (d.fonte && naoLidasPorFonte[d.fonte] !== undefined) {
            naoLidasPorFonte[d.fonte]++;
        }
    }

    const criticasCats = new Set([
        'intimacao', 'malha', 'exclusao',
        'det_notificacao', 'det_auto_infracao',
        'dec_intimacao', 'dje_citacao', 'dje_intimacao',
        'prefeitura_sp_iss',
    ]);
    const empresasComCriticas = new Set();
    for (const d of naoLidas) {
        if (criticasCats.has(d.categoria)) {
            empresasComCriticas.add(d.empresaCnpj);
        }
    }

    return {
        totalMensagens: docs.length,
        naoLidasTotal: naoLidas.length,
        naoLidasPorCategoria: porCategoria,
        naoLidasPorFonte,
        empresasComCriticas: empresasComCriticas.size,
        mode: getProviderMode(),
    };
}

/**
 * Marca uma mensagem como lida no Firestore (e tenta no provider).
 */
export async function marcarComoLida(docId) {
    const db = fa().firestore();
    await db.collection(COLLECTION).doc(docId).update({
        dataLeitura: new Date().toISOString(),
    });

    const provider = getCaixaPostalProvider();
    try {
        // Pega o mensagemId remoto pra sinalizar pro provider
        const docSnap = await db.collection(COLLECTION).doc(docId).get();
        if (docSnap.exists) {
            await provider.marcarComoLida(docSnap.data().mensagemId);
        }
    } catch (err) {
        console.warn(`[caixa-postal] marcarComoLida no provider falhou: ${err.message}`);
    }
    return { ok: true };
}
