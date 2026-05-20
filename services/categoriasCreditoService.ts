/**
 * categoriasCreditoService — categorias customizadas (alem das 11 da IA).
 *
 * As 11 fixas (ALUGUEL, MEDICINA, ...) continuam no codigo e nao podem ser
 * editadas/apagadas — sao a base do classificador automatico.
 *
 * Esta colecao acumula categorias criadas pelo time (ex: MARKETING,
 * TREINAMENTO). Nao entram no classificador automatico; sao usadas para
 * atribuicao MANUAL via dropdown (em categorias_fornecedor).
 *
 * Doc: { id, nome, criadoPor, criadoEm }
 *   - nome ja normalizado (UPPERCASE, trim, espacos colapsados)
 *
 * Regras Firestore: leitura e escrita para qualquer signed-in.
 */
import {
    collection,
    addDoc,
    deleteDoc,
    doc,
    getDocs,
    query,
    where,
    updateDoc,
    serverTimestamp,
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';
import { CATEGORIAS_CREDITO } from './analiseCreditoExtratoService';

const COLLECTION = 'categorias_credito_custom';

export interface CategoriaCustom {
    id: string;
    nome: string;
    criadoPor: string | null;
}

/** Normaliza: UPPERCASE, trim, colapsa multiplos espacos em um. */
export function normalizarNomeCategoria(nome: string): string {
    return (nome || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();
}

/** Conjunto (Set) das 11 fixas, em UPPERCASE. */
const FIXAS_UPPER = new Set(
    CATEGORIAS_CREDITO.map(c => c.toUpperCase()),
);

/** Lista todas as categorias customizadas. */
export async function listarCustom(): Promise<CategoriaCustom[]> {
    if (!isFirebaseConfigured) return [];
    try {
        const snap = await getDocs(collection(db, COLLECTION));
        return snap.docs
            .map(d => ({ id: d.id, ...(d.data() as Omit<CategoriaCustom, 'id'>) }))
            .sort((a, b) => a.nome.localeCompare(b.nome));
    } catch (e) {
        console.error('[categoriasCredito] listar:', e);
        return [];
    }
}

/**
 * Cria uma categoria custom. Se ja existir (dedup case-insensitive,
 * inclusive contra as 11 fixas), retorna a existente sem criar.
 */
export async function criarCategoria(
    nome: string,
): Promise<{ ok: boolean; id?: string; nome?: string; jaExistia?: boolean; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, error: 'Firebase nao configurado' };
    const norm = normalizarNomeCategoria(nome);
    if (!norm) return { ok: false, error: 'Nome obrigatorio' };

    // dedup contra as 11 fixas
    if (FIXAS_UPPER.has(norm)) {
        return { ok: false, error: `"${norm}" ja existe como categoria padrao` };
    }
    // dedup contra as custom
    try {
        const snap = await getDocs(query(
            collection(db, COLLECTION),
            where('nome', '==', norm),
        ));
        if (!snap.empty) {
            const d = snap.docs[0];
            return { ok: true, id: d.id, nome: norm, jaExistia: true };
        }
        const ref = await addDoc(collection(db, COLLECTION), {
            nome: norm,
            criadoPor: auth?.currentUser?.uid || null,
            criadoEm: serverTimestamp(),
        });
        return { ok: true, id: ref.id, nome: norm, jaExistia: false };
    } catch (e) {
        console.error('[categoriasCredito] criar:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}

/** Renomeia uma categoria custom. Normaliza, dedupa contra fixas e outras custom. */
export async function renomearCategoria(
    id: string, novoNome: string,
): Promise<{ ok: boolean; nome?: string; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, error: 'Firebase nao configurado' };
    const norm = normalizarNomeCategoria(novoNome);
    if (!norm) return { ok: false, error: 'Nome obrigatorio' };
    if (FIXAS_UPPER.has(norm)) {
        return { ok: false, error: `"${norm}" ja existe como categoria padrao` };
    }
    try {
        const snap = await getDocs(query(
            collection(db, COLLECTION),
            where('nome', '==', norm),
        ));
        // dedup: ja existe outra com o mesmo nome?
        const colisao = snap.docs.find(d => d.id !== id);
        if (colisao) {
            return { ok: false, error: `Ja existe categoria "${norm}"` };
        }
        await updateDoc(doc(db, COLLECTION, id), { nome: norm });
        return { ok: true, nome: norm };
    } catch (e) {
        console.error('[categoriasCredito] renomear:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}

/**
 * Conta quantos fornecedores estao classificados numa dada categoria
 * (consulta a colecao categorias_fornecedor). Usado pra bloquear remocao.
 */
export async function contarFornecedoresNaCategoria(
    nomeCategoria: string,
): Promise<number> {
    if (!isFirebaseConfigured) return 0;
    try {
        const snap = await getDocs(query(
            collection(db, 'categorias_fornecedor'),
            where('categoria', '==', nomeCategoria),
        ));
        return snap.size;
    } catch (e) {
        console.error('[categoriasCredito] contar:', e);
        return 0;
    }
}

/**
 * Remove uma categoria custom. BLOQUEIA se houver fornecedores
 * classificados nela — chame contarFornecedoresNaCategoria antes.
 */
export async function removerCategoria(
    id: string, nomeCategoria: string,
): Promise<{ ok: boolean; bloqueado?: boolean; usados?: number; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, error: 'Firebase nao configurado' };
    try {
        const usados = await contarFornecedoresNaCategoria(nomeCategoria);
        if (usados > 0) {
            return { ok: false, bloqueado: true, usados };
        }
        await deleteDoc(doc(db, COLLECTION, id));
        return { ok: true };
    } catch (e) {
        console.error('[categoriasCredito] remover:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}
