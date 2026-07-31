// ============================================================================
// sefaz-backend/dipam-store.js  (I/O — leitura/gravação do cadastro do produtor)
// ----------------------------------------------------------------------------
// A regra fica no módulo puro (`dipam-produtor-rural.js`); aqui só tem Firestore.
//
// Coleção `produtores_rurais` — id = CPF/CNPJ só dígitos. É a MEMÓRIA da
// conferência que hoje a equipe refaz nota a nota: quem já foi olhado no CADESP,
// de que município é a produção e se optou por recolher sobre a folha (aí não
// há sub-rogação e a nota NÃO pode gerar FUNRURAL). O cadastro é do FORNECEDOR,
// não do cliente: o mesmo produtor vende para vários clientes da carteira.
// ============================================================================

import admin from 'firebase-admin';

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

export const COLECAO_PRODUTORES = 'produtores_rurais';

/** Naturezas aceitas — 'produtor_rural_pf' é a única que gera DIPAM 1.1. */
export const NATUREZAS = ['produtor_rural_pf', 'pessoa_juridica', 'cooperativa'];
/** Regime do FUNRURAL do produtor. */
export const REGIMES_FUNRURAL = ['sub_rogacao', 'folha', 'nao_aplica'];

/**
 * Carrega os cadastros dos fornecedores citados nos documentos.
 * Devolve um mapa { [cpfCnpj]: cadastro } — do jeito que o módulo puro espera.
 *
 * Lê em lotes de 10 (limite do `in` do Firestore) e só dos documentos que
 * apareceram no período: nada de varrer a coleção inteira por empresa.
 */
export async function carregarProdutoresRurais(docsCpfCnpj = []) {
    const ids = Array.from(new Set(docsCpfCnpj.map(soDigitos).filter(Boolean)));
    if (ids.length === 0) return {};
    const db = getDb();
    const mapa = {};
    for (let i = 0; i < ids.length; i += 10) {
        const lote = ids.slice(i, i + 10);
        const snap = await db.collection(COLECAO_PRODUTORES)
            .where(admin.firestore.FieldPath.documentId(), 'in', lote)
            .get();
        snap.forEach((d) => {
            const data = d.data() || {};
            if (data._deleted) return;
            mapa[d.id] = { id: d.id, ...data };
        });
    }
    return mapa;
}

/** Grava/atualiza o cadastro de um produtor (upsert com auditoria de quem). */
export async function salvarProdutorRural(doc, dados, usuario) {
    const id = soDigitos(doc);
    if (id.length !== 11 && id.length !== 14) {
        const err = new Error('Informe o CPF (11 dígitos) ou CNPJ (14 dígitos) do produtor.');
        err.code = 'DOC_INVALIDO';
        throw err;
    }
    if (dados.natureza && !NATUREZAS.includes(dados.natureza)) {
        const err = new Error(`Natureza inválida: "${dados.natureza}". Use uma de: ${NATUREZAS.join(', ')}.`);
        err.code = 'NATUREZA_INVALIDA';
        throw err;
    }
    if (dados.funrural && !REGIMES_FUNRURAL.includes(dados.funrural)) {
        const err = new Error(`Regime de FUNRURAL inválido: "${dados.funrural}". Use um de: ${REGIMES_FUNRURAL.join(', ')}.`);
        err.code = 'FUNRURAL_INVALIDO';
        throw err;
    }
    const codMun = soDigitos(dados.codMunIBGE);
    if (codMun && codMun.length !== 7) {
        const err = new Error(`Código IBGE do município deve ter 7 dígitos (recebido "${dados.codMunIBGE}").`);
        err.code = 'MUNICIPIO_INVALIDO';
        throw err;
    }

    const registro = {
        doc: id,
        nome: String(dados.nome || '').trim(),
        ie: String(dados.ie || '').trim().toUpperCase(),
        uf: String(dados.uf || '').trim().toUpperCase(),
        codMunIBGE: codMun,
        municipio: String(dados.municipio || '').trim(),
        natureza: dados.natureza || null,
        funrural: dados.funrural || null,
        observacao: String(dados.observacao || '').trim(),
        confirmadoPor: usuario?.email || usuario?.uid || 'desconhecido',
        confirmadoEm: Date.now(),
    };
    await getDb().collection(COLECAO_PRODUTORES).doc(id).set(registro, { merge: true });
    return registro;
}

/**
 * Condição rural do CLIENTE, lida do cadastro (dadosFiscais.condicaoRural).
 * É o que diz se este cliente compra de produtor (DIPAM 1.1 + sub-rogação), se
 * ele MESMO é produtor PF (aí entrega DIPAM-A e não lança 1.1) ou se é
 * cooperativa (código 1.3).
 */
export function lerCondicaoRural(empresa) {
    const c = empresa?.dadosFiscais?.condicaoRural || {};
    return {
        id: empresa?.id || null,
        nome: empresa?.razaoSocial || empresa?.nome || null,
        cnpj: soDigitos(empresa?.cnpj),
        adquireDeProdutor: !!c.adquireDeProdutor,
        ehProdutorRuralPF: !!c.ehProdutorRuralPF,
        ehCooperativa: !!c.ehCooperativa,
        funruralSubRogacao: c.funruralSubRogacao === 'nao_aplica' ? 'nao_aplica' : 'automatico',
        observacao: c.observacao || '',
    };
}

/** CPF/CNPJ da contraparte de cada documento (emitente na entrada, destinatário na devolução). */
export function documentosDaContraparte(notas = []) {
    const out = [];
    for (const n of notas) {
        const p = n?.direcao === 'saida'
            ? (n.destinatario || n.tomador)
            : (n.emitente || n.prestador);
        const d = soDigitos(p?.cnpjCpf || p?.cnpj || p?.cpf);
        if (d) out.push(d);
    }
    return out;
}
