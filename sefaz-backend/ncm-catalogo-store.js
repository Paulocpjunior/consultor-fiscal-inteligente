/**
 * ncm-catalogo-store.js — leitura do cadastro de NCM (`ncm_parametros`) para
 * quem decide por NCM fora da rota: o gerador do EFD-Contribuições (28/09,
 * CST de entrada) lê o catálogo inteiro uma vez por geração.
 *
 * Só I/O. A régua (prefixo, vigência, UF) mora em `ncm-parametros.js`.
 */
import { fetchAllDocs } from './firestore-paginate.js';
import { COLECAO_NCM } from './ncm-parametros.js';

/** @returns {Promise<{catalogo: Array<object>, erro: string|null}>} */
export async function carregarCatalogoNcm(db) {
    try {
        const snaps = await fetchAllDocs(db.collection(COLECAO_NCM), { label: 'ncm_parametros (gerador)', maxDocs: 40000 });
        return { catalogo: snaps.map((s) => ({ id: s.id, ...s.data() })), erro: null };
    } catch (e) {
        // Falhar em LER o cadastro não derruba a geração — mas vai DITO: sem o
        // catálogo, toda compra cai no padrão (50), e o aviso da geração diz.
        return { catalogo: [], erro: `cadastro de NCM não pôde ser lido (${e?.message || e}); a CST de entrada saiu no padrão.` };
    }
}
