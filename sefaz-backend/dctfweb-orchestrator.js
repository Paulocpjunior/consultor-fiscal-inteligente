// ============================================================================
// sefaz-backend/dctfweb-orchestrator.js
// Sincroniza declaracoes DCTFWeb entre provider e Firestore.
// ============================================================================

import admin from 'firebase-admin';
import { getDctfwebProvider, getDctfwebMode } from './dctfweb-provider.js';
import { normalizarRetencaoDctfweb } from './dctfweb-retencao-normalizer.js';
import { assertEmissaoLiberada } from './emissao-guard.js';
import { fetchAllDocs } from './firestore-paginate.js';

const COLLECTION = 'dctfweb_declaracoes';
const COLLECTION_MIT = 'dctfweb_mit_apuracoes';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

function sanitize(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (v !== undefined) out[k] = v;
    }
    return out;
}

function paPenultima() {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return { anoPA: d.getFullYear(), mesPA: d.getMonth() + 1 };
}

export async function sincronizarEmpresa(empresaId, empresaCnpj, opts = {}) {
    const db = fa().firestore();
    const provider = getDctfwebProvider();
    const mode = getDctfwebMode();
    const { anoPA, mesPA } = (opts.anoPA && opts.mesPA) ? opts : paPenultima();

    const declaracoes = await provider.listarDeclaracoes(empresaCnpj, { anoPA, mesPA, categoria: opts.categoria });

    const batch = db.batch();
    let novas = 0, atualizadas = 0;

    for (const decl of declaracoes) {
        const docId = decl.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const ref = db.collection(COLLECTION).doc(docId);
        const payload = sanitize({
            empresaId,
            empresaCnpj,
            categoria: decl.categoria,
            categoriaCodigo: decl.categoriaCodigo,
            anoPA: decl.anoPA,
            mesPA: decl.mesPA,
            situacao: decl.situacao,
            valorTotal: decl.valorTotal,
            inssRetido: decl.inssRetido,
            cprbDevido: decl.cprbDevido,
            dataVencimento: decl.dataVencimento,
            numeroRecibo: decl.numeroRecibo,
            transmitidoEm: decl.transmitidoEm,
            fonte: decl.fonte || mode,
            ultimaSincronizacao: new Date().toISOString(),
            _erro: decl._erro || null,
        });

        const existing = await ref.get();
        if (existing.exists) atualizadas++; else novas++;
        batch.set(ref, payload, { merge: true });
    }
    await batch.commit();

    return { mode, total: declaracoes.length, novas, atualizadas, anoPA, mesPA };
}

export async function sincronizarTodasLucro() {
    const db = fa().firestore();
    const snap = await db.collection('lucro_empresas').get();
    // 23/05: filtra perdedores do merge de duplicatas
    const ativos = snap.docs.filter(d => !d.data()._merged_into);
    const stats = { totalEmpresas: ativos.length, sucesso: 0, falha: 0, detalhes: [] };
    for (const d of ativos) {
        const emp = d.data();
        if (!emp.cnpj) continue;
        try {
            const r = await sincronizarEmpresa(d.id, emp.cnpj);
            stats.sucesso++;
            stats.detalhes.push({ empresa: emp.nome, ...r });
        } catch (err) {
            stats.falha++;
            console.warn(`[dctfweb] ${emp.nome}: ${err.message}`);
        }
    }
    return stats;
}

export async function listarDeclaracoes({ empresaCnpj, situacao, anoPA, mesPA } = {}) {
    const db = fa().firestore();
    let q = db.collection(COLLECTION);
    if (empresaCnpj) q = q.where('empresaCnpj', '==', empresaCnpj);
    if (situacao) q = q.where('situacao', '==', situacao);
    if (anoPA) q = q.where('anoPA', '==', anoPA);
    if (mesPA) q = q.where('mesPA', '==', mesPA);
    const snap = await q.limit(500).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.anoPA - a.anoPA) || (b.mesPA - a.mesPA));
}

export async function transmitirDeclaracao({ empresaId, empresaCnpj, anoPA, mesPA, categoria }) {
    assertEmissaoLiberada('DCTFWEB');
    const db = fa().firestore();
    const provider = getDctfwebProvider();
    const r = await provider.transmitirDeclaracao({ empresaCnpj, anoPA, mesPA, categoria });

    const docId = `${empresaCnpj}_${anoPA}${String(mesPA).padStart(2,'0')}_${categoria || 'GERAL_MENSAL'}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    await db.collection(COLLECTION).doc(docId).set(sanitize({
        empresaId, empresaCnpj, categoria: categoria || 'GERAL_MENSAL',
        anoPA, mesPA,
        situacao: 'ATIVA',
        numeroRecibo: r.numeroRecibo,
        transmitidoEm: r.transmitidoEm,
        fonte: r.fonte,
        ultimaSincronizacao: new Date().toISOString(),
    }), { merge: true });

    return { ok: true, ...r };
}

export async function gerarDarf({ empresaId, empresaCnpj, anoPA, mesPA, categoria, emAndamento }) {
    assertEmissaoLiberada('DCTFWEB');
    const provider = getDctfwebProvider();
    return await provider.gerarDarf({ empresaCnpj, anoPA, mesPA, categoria, emAndamento });
}

export async function consultarDeclaracaoCompleta({ empresaCnpj, anoPA, mesPA, categoria }) {
    const provider = getDctfwebProvider();
    return await provider.consultarDeclaracaoCompleta({ empresaCnpj, anoPA, mesPA, categoria });
}

export async function consultarRecibo({ empresaCnpj, anoPA, mesPA, categoria }) {
    const provider = getDctfwebProvider();
    return await provider.consultarRecibo({ empresaCnpj, anoPA, mesPA, categoria });
}

export async function encerrarApuracaoMit({ empresaId, empresaCnpj, anoPA, mesPA, dadosApuracaoMit }) {
    assertEmissaoLiberada('DCTFWEB');
    const db = fa().firestore();
    const provider = getDctfwebProvider();
    const r = await provider.encerrarApuracaoMit({ empresaCnpj, anoPA, mesPA, dadosApuracaoMit });

    const docId = `${empresaCnpj}_${anoPA}${String(mesPA).padStart(2,'0')}_MIT`.replace(/[^a-zA-Z0-9_-]/g, '_');
    await db.collection(COLLECTION_MIT).doc(docId).set(sanitize({
        empresaId, empresaCnpj, anoPA, mesPA,
        statusEncerramento: r.statusEncerramento,
        protocolo: r.protocolo,
        idApuracao: r.idApuracao,
        encerradoEm: new Date().toISOString(),
        fonte: r.fonte,
    }), { merge: true });

    return { ok: true, ...r };
}

export async function consultarStatusEncerramentoMit({ empresaCnpj, protocolo, anoPA, mesPA }) {
    const provider = getDctfwebProvider();
    return await provider.consultarStatusEncerramentoMit({ empresaCnpj, protocolo, anoPA, mesPA });
}

export async function consultarApuracaoMit({ empresaCnpj, anoPA, mesPA }) {
    const provider = getDctfwebProvider();
    return await provider.consultarApuracaoMit({ empresaCnpj, anoPA, mesPA });
}

export async function consultarApuracoesAno({ empresaCnpj, anoPA }) {
    const provider = getDctfwebProvider();
    return await provider.consultarApuracoesAno({ empresaCnpj, anoPA });
}

// Consulta a declaracao DCTFWeb (XML) e NORMALIZA a retencao consolidada pra
// cruzar contra a EFD-Reinf. Devolve { lido, motivo, retencoes, ... } — honesto
// quando nao consegue ler (NUNCA zeros falsos).
export async function consultarRetencaoDctfwebNormalizada({ empresaCnpj, anoPA, mesPA, categoria }) {
    const provider = getDctfwebProvider();
    const consulta = await provider.consultarXmlDeclaracao({ empresaCnpj, anoPA, mesPA, categoria });
    const norm = normalizarRetencaoDctfweb(consulta?.xml || consulta?._raw || '');
    return { competencia: `${anoPA}-${String(mesPA).padStart(2, '0')}`, fonte: consulta?.fonte, ...norm };
}

export async function getResumoGlobal() {
    const db = fa().firestore();
    const docs = (await fetchAllDocs(db.collection(COLLECTION), { label: 'dctfweb_declaracoes/resumo' })).map(d => d.data());
    const pendentes = docs.filter(d => d.situacao === 'EM_ANDAMENTO');
    const transmitidas = docs.filter(d => d.situacao === 'ATIVA');
    return {
        totalDeclaracoes: docs.length,
        pendentes: pendentes.length,
        transmitidas: transmitidas.length,
        empresasComPendente: new Set(pendentes.map(d => d.empresaCnpj)).size,
        mode: getDctfwebMode(),
    };
}
