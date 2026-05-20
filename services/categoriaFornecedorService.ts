/**
 * categoriaFornecedorService — tabela CNPJ -> categoria, por empresa-cliente.
 *
 * Cada documento da colecao `categorias_fornecedor` e UMA regra:
 *   empresaId + cnpjFornecedor -> categoria.
 * Sobrepoe a classificacao automatica do efiscalCreditoService.
 *
 * Quando o usuario corrige a categoria de uma NF na tela, o CNPJ daquele
 * fornecedor e gravado aqui (vira regra fixa para aquela empresa).
 *
 * Regras Firestore: leitura para qualquer logado, escrita so admin.
 */
import {
    collection,
    doc,
    setDoc,
    getDocs,
    query,
    where,
    serverTimestamp,
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';
import type { TipoDespesaCredito } from './analiseCreditoExtratoService';

const COLLECTION = 'categorias_fornecedor';

/** Uma regra CNPJ -> categoria, como gravada no Firestore. */
export interface RegraCategoria {
    id: string;             // `${empresaId}__${cnpjDigitos}`
    empresaId: string;
    cnpjFornecedor: string; // so digitos
    razaoSocial: string;    // ultima razao vista (referencia humana)
    categoria: string;  // pode ser custom
    atualizadoPor: string | null;
}

const soDigitos = (s: string): string => (s || '').replace(/\D+/g, '');

/** ID deterministico — garante 1 regra por (empresa, CNPJ). */
function regraId(empresaId: string, cnpj: string): string {
    return `${empresaId}__${soDigitos(cnpj)}`;
}

/**
 * Carrega todas as regras de uma empresa como Map<cnpjDigitos, categoria>.
 * Esse Map e passado ao calcularCreditoEfiscal como override.
 */
export async function carregarRegras(empresaId: string): Promise<Map<string, string>> {
    const mapa = new Map<string, string>();
    if (!isFirebaseConfigured || !empresaId) return mapa;
    try {
        const snap = await getDocs(query(
            collection(db, COLLECTION),
            where('empresaId', '==', empresaId),
        ));
        snap.forEach(d => {
            const r = d.data() as RegraCategoria;
            if (r.cnpjFornecedor && r.categoria) {
                mapa.set(r.cnpjFornecedor, r.categoria);
            }
        });
    } catch (e) {
        console.error('[categoriaFornecedor] carregarRegras:', e);
    }
    return mapa;
}

/**
 * Grava (ou sobrescreve) a regra CNPJ -> categoria para uma empresa.
 * Chamado quando o usuario corrige a categoria de uma NF na tela.
 */
export async function salvarRegra(params: {
    empresaId: string;
    cnpjFornecedor: string;
    razaoSocial: string;
    categoria: string;
}): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured) {
        return { ok: false, error: 'Firebase nao configurado' };
    }
    const cnpj = soDigitos(params.cnpjFornecedor);
    if (!params.empresaId || !cnpj) {
        return { ok: false, error: 'empresaId e CNPJ obrigatorios' };
    }
    try {
        const id = regraId(params.empresaId, cnpj);
        await setDoc(doc(db, COLLECTION, id), {
            empresaId: params.empresaId,
            cnpjFornecedor: cnpj,
            razaoSocial: params.razaoSocial || '',
            categoria: params.categoria,
            atualizadoPor: auth?.currentUser?.uid || null,
            atualizadoEm: serverTimestamp(),
        });
        return { ok: true };
    } catch (e) {
        console.error('[categoriaFornecedor] salvarRegra:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}
