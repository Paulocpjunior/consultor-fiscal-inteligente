// ============================================================================
// sefaz-backend/caixa-postal-orchestrator.js
// Sincroniza mensagens entre o provider (mock/SERPRO) e o Firestore.
// ============================================================================

import admin from 'firebase-admin';
import { getCaixaPostalProvider, getProviderMode } from './caixa-postal-provider.js';

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
 * Sincroniza a caixa postal de uma empresa: chama o provider, persiste novos,
 * preserva o estado de leitura local (data leitura).
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
    // Estrategia atual: pula direto pro MSGCONTRIBUINTE61. Quando o SERPRO corrigir o
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

    const mensagensRemotas = await provider.listarMensagens(empresaCnpj);

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

    const batch = db.batch();
    let novas = 0, atualizadas = 0;

    // 23/05: normaliza empresaCnpj defensivamente.
    // SERPRO as vezes retorna CNPJ formatado; salvar sempre limpo previne
    // 746 mensagens com formatacao suja que vimos hoje.
    const empresaCnpjLimpo = _normCnpj(empresaCnpj);

    for (const msg of mensagensRemotas) {
        const docId = `${empresaCnpjLimpo}_${msg.mensagemId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        const ref = db.collection(COLLECTION).doc(docId);
        const dataLeituraLocal = lidasLocais.get(msg.mensagemId) || msg.dataLeitura || null;

        const empresaNome = _nomeCache.get(empresaCnpjLimpo) || '';
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
            fonte: msg.fonte || mode,
            ultimaSincronizacao: new Date().toISOString(),
        };
        batch.set(ref, payload, { merge: true });

        if (lidasLocais.has(msg.mensagemId)) atualizadas++; else novas++;
    }
    await batch.commit();

    return { mode, total: mensagensRemotas.length, novas, atualizadas };
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
export async function listarMensagensLocais({ empresaCnpj, naoLidas, categoria } = {}) {
    const db = fa().firestore();
    let q = db.collection(COLLECTION);
    if (empresaCnpj) q = q.where('empresaCnpj', '==', empresaCnpj);
    if (categoria) q = q.where('categoria', '==', categoria);

    // FIX 23/05: ordena por dataEnvio desc ANTES de paginar pra mostrar
    // as mensagens mais recentes (e nao uma fatia arbitraria do .limit()).
    // Limite subido pra 2000 — ainda barato, cobre nosso volume atual de 4091
    // total com folga (a maioria das telas filtra por nao-lidas).
    const snap = await q.orderBy('dataEnvio', 'desc').limit(2000).get();
    let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (naoLidas) docs = docs.filter(d => !d.dataLeitura);
    return docs;
}

/**
 * Resumo agregado pra dashboard global.
 */
export async function getResumoGlobal(cnpjsPermitidos = null) {
    const db = fa().firestore();

    // 23/05 Patch B: usa aggregation queries (.count()) em vez de baixar todos
    // os docs. 4091 reads -> ~6 reads por chamada. Latencia ~50ms vs ~2s.
    //
    // Caminho rapido: admin (sem filtro de carteira) — usa count().
    if (cnpjsPermitidos === null) {
        const col = db.collection(COLLECTION);
        const CATS = ['intimacao', 'malha', 'exclusao', 'informativo'];

        // 5 counts em paralelo: total geral + 4 nao-lidas por categoria
        const [totalAgg, ...porCatAgg] = await Promise.all([
            col.count().get(),
            ...CATS.map(c =>
                col.where('categoria', '==', c)
                   .where('dataLeitura', '==', null)
                   .count().get()
            ),
        ]);

        const porCategoria = {};
        CATS.forEach((c, i) => {
            const n = porCatAgg[i].data().count;
            if (n > 0) porCategoria[c] = n;
        });

        const naoLidasTotal = Object.values(porCategoria).reduce((a, b) => a + b, 0);

        // Empresas com criticas: precisa fetch (~48 docs hoje, bem menor que 4091).
        const criticasSnap = await col
            .where('categoria', 'in', ['intimacao', 'malha', 'exclusao'])
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
            empresasComCriticas: empresasComCriticas.size,
            mode: getProviderMode(),
        };
    }

    // Caminho carteira (colaborador): mantem agregacao em memoria.
    // Firestore 'where in' tem limite 30 valores e colaborador pode ter 50+ empresas.
    const snap = await db.collection(COLLECTION)
        .select('empresaCnpj', 'categoria', 'dataLeitura')
        .get();
    let docs = snap.docs.map(d => d.data());

    const permitidos = new Set(cnpjsPermitidos.map(_normCnpj));
    docs = docs.filter(d => permitidos.has(_normCnpj(d.empresaCnpj)));

    const naoLidas = docs.filter(d => !d.dataLeitura);
    const porCategoria = {};
    for (const d of naoLidas) {
        porCategoria[d.categoria] = (porCategoria[d.categoria] || 0) + 1;
    }
    const empresasComCriticas = new Set();
    for (const d of naoLidas) {
        if (d.categoria === 'intimacao' || d.categoria === 'malha' || d.categoria === 'exclusao') {
            empresasComCriticas.add(d.empresaCnpj);
        }
    }

    return {
        totalMensagens: docs.length,
        naoLidasTotal: naoLidas.length,
        naoLidasPorCategoria: porCategoria,
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
