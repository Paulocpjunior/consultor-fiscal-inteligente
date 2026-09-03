/**
 * fornecedoresOcultosService — regras "ignorar esse fornecedor pra essa
 * empresa para sempre" no calculo de credito PIS/COFINS.
 *
 * Funciona em par com a exclusao LOCAL (Set<string> de state na UI):
 *   - "So desta vez" -> Set local (some so na sessao atual)
 *   - "Sempre nessa empresa" -> grava aqui (some em toda sessao futura)
 *
 * Estrutura:
 *   Cada doc da colecao `fornecedores_ocultos` eh uma regra (empresa, CNPJ):
 *     id = `${empresaId}__${cnpjDigitos}`
 *     empresaId, cnpjFornecedor, razaoSocial, criadoPor, criadoEm
 *
 * Regras Firestore: read/write para qualquer usuario logado (mesmo padrao
 * de categorias_fornecedor e empresa_credito_config).
 */
import {
    collection,
    doc,
    setDoc,
    getDocs,
    deleteDoc,
    query,
    where,
    serverTimestamp,
    writeBatch,
    limit as fbLimit,
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';

const COLLECTION = 'fornecedores_ocultos';

export interface FornecedorOculto {
    id: string;
    empresaId: string;
    cnpjFornecedor: string;
    razaoSocial: string;
    criadoPor: string | null;
}

const soDigitos = (s: string): string => (s || '').replace(/\D+/g, '');

function regraId(empresaId: string, cnpj: string): string {
    return `${empresaId}__${soDigitos(cnpj)}`;
}

export async function listarOcultos(empresaId: string): Promise<Set<string>> {
    const set = new Set<string>();
    if (!isFirebaseConfigured || !empresaId) return set;
    try {
        const snap = await getDocs(query(
            collection(db, COLLECTION),
            where('empresaId', '==', empresaId),
            fbLimit(500),
        ));
        snap.forEach(d => {
            const r = d.data() as FornecedorOculto;
            if (r.cnpjFornecedor) set.add(r.cnpjFornecedor);
        });
    } catch (e) {
        console.error('[fornecedoresOcultos] listarOcultos:', e);
    }
    return set;
}

export async function ocultarFornecedor(params: {
    empresaId: string;
    cnpjFornecedor: string;
    razaoSocial: string;
}): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, error: 'Firebase nao configurado' };
    const cnpj = soDigitos(params.cnpjFornecedor);
    if (!params.empresaId || !cnpj) return { ok: false, error: 'empresaId e CNPJ obrigatorios' };
    try {
        const id = regraId(params.empresaId, cnpj);
        await setDoc(doc(db, COLLECTION, id), {
            empresaId: params.empresaId,
            cnpjFornecedor: cnpj,
            razaoSocial: params.razaoSocial || '',
            criadoPor: auth?.currentUser?.uid || null,
            criadoEm: serverTimestamp(),
        });
        return { ok: true };
    } catch (e) {
        console.error('[fornecedoresOcultos] ocultarFornecedor:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}

export async function restaurarFornecedor(
    empresaId: string,
    cnpjFornecedor: string,
): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, error: 'Firebase nao configurado' };
    const cnpj = soDigitos(cnpjFornecedor);
    if (!empresaId || !cnpj) return { ok: false, error: 'empresaId e CNPJ obrigatorios' };
    try {
        await deleteDoc(doc(db, COLLECTION, regraId(empresaId, cnpj)));
        return { ok: true };
    } catch (e) {
        console.error('[fornecedoresOcultos] restaurarFornecedor:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}

export async function restaurarTodos(empresaId: string): Promise<{ ok: boolean; count: number; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, count: 0, error: 'Firebase nao configurado' };
    if (!empresaId) return { ok: false, count: 0, error: 'empresaId obrigatorio' };
    try {
        // 🚨 O `fbLimit(500)` era um TETO MUDO: acima de 500 regras, a função
        // restaurava as 500 primeiras e devolvia `count` como se fosse tudo — a
        // tela dizia "restauradas" e sobravam ocultas. Agora repete até esgotar
        // (com teto de rodadas contra laço infinito) e DIZ quantas sobraram.
        const TAMANHO = 500;
        const MAX_RODADAS = 40;
        let count = 0;
        for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
            const snap = await getDocs(query(
                collection(db, COLLECTION),
                where('empresaId', '==', empresaId),
                fbLimit(TAMANHO),
            ));
            if (snap.empty) return { ok: true, count };
            const batch = writeBatch(db);
            snap.forEach(d => batch.delete(d.ref));
            await batch.commit();
            count += snap.size;
            if (snap.size < TAMANHO) return { ok: true, count };
        }
        return {
            ok: true, count,
            error: `${count} restaurada(s), mas o teto de ${MAX_RODADAS * TAMANHO} por clique foi atingido — pode ter sobrado; clique de novo para continuar.`,
        };
    } catch (e) {
        console.error('[fornecedoresOcultos] restaurarTodos:', e);
        return { ok: false, count: 0, error: e instanceof Error ? e.message : 'erro' };
    }
}
