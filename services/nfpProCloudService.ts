/**
 * nfpProCloudService — Persistência Firestore para o módulo NFP Pro Cloud.
 *
 * Coleção: `nfp_analises`
 * Doc ID: empresaId (uma análise por empresa, sobrescreve ao atualizar).
 */
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    limit as fbLimit,
    runTransaction,
    serverTimestamp,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db, isFirebaseConfigured, auth } from './firebaseConfig';
import { sanitizeForFirestore } from './firestoreSanitize';
import { mesclarAnaliseComRemota } from './nfpAnaliseMerge';
import type { User, NfpAnaliseEmpresa, NfpDebito } from '../types';

const COLLECTION = 'nfp_analises';
const API_BASE = '/api/admin/nfp-compliance';

async function authHeaders(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuário não autenticado');
    const token = await u.getIdToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

/**
 * Chama a análise completa de compliance via backend SERPRO.
 */
export async function analisarEmpresaCompleta(cnpj: string, regime?: string, uf?: string, codMunIBGE?: string): Promise<any> {
    const res = await fetch(`${API_BASE}/analise-completa`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ cnpj, regime, uf, codMunIBGE }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Erro ${res.status} na análise completa`);
    }
    return res.json();
}

/**
 * Salva (ou atualiza) a análise de uma empresa.
 *
 * A análise é preenchida por vários colaboradores (departamentos) sobre o
 * mesmo documento; gravar o estado local direto substituiria os arrays
 * inteiros e o último a salvar apagaria os lançamentos dos demais. Por isso
 * o salvamento roda em transação: lê a versão atual, mescla com o estado
 * local (ver `mesclarAnaliseComRemota`) e grava o resultado.
 *
 * `baseline` é o snapshot que a tela carregou do servidor — é o que permite
 * distinguir "removido de propósito nesta tela" de "lançado por outra pessoa
 * depois do carregamento".
 *
 * Retorna a análise efetivamente gravada (já mesclada), para a tela
 * atualizar seu estado com os dados dos demais colaboradores.
 */
export async function salvarAnalise(
    analise: NfpAnaliseEmpresa,
    user: User,
    baseline?: NfpAnaliseEmpresa | null,
): Promise<NfpAnaliseEmpresa> {
    if (!isFirebaseConfigured || !db) throw new Error('Firebase não configurado');
    if (!auth?.currentUser) throw new Error('Usuário não autenticado');

    const uidAtual = auth.currentUser.uid;
    const docRef = doc(db, COLLECTION, analise.empresaId);

    const salva = await runTransaction(db, async tx => {
        const snap = await tx.get(docRef);
        const remota = snap.exists() ? (snap.data() as NfpAnaliseEmpresa) : null;
        const mesclada: NfpAnaliseEmpresa = {
            ...mesclarAnaliseComRemota(analise, remota, baseline),
            analisadoPor: user.name,
            dataAnalise: new Date().toISOString(),
        };

        const payload = sanitizeForFirestore({
            ...mesclada,
            analisadoPorUid: uidAtual,
        });
        tx.set(docRef, {
            ...payload,
            updatedAt: serverTimestamp(),
        }, { merge: true });

        return mesclada;
    });

    return salva;
}

/**
 * Lista todas as análises salvas (limite 500).
 */
export async function listarAnalises(user: User): Promise<NfpAnaliseEmpresa[]> {
    if (!isFirebaseConfigured || !db) return [];
    if (!auth?.currentUser) return [];

    const q = query(collection(db, COLLECTION), fbLimit(500));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data() } as NfpAnaliseEmpresa));
}

/**
 * Retorna a análise de uma empresa específica (ou null).
 */
export async function getAnalise(empresaId: string): Promise<NfpAnaliseEmpresa | null> {
    if (!isFirebaseConfigured || !db) return null;
    if (!auth?.currentUser) return null;

    const docRef = doc(db, COLLECTION, empresaId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return snap.data() as NfpAnaliseEmpresa;
}

/**
 * Atualiza os débitos com correção pela taxa Selic.
 * Fórmula: valorAtualizado = valorOriginal * (1 + (taxaSelicAnual/100) * diasAtraso / 365)
 * Somente débitos com status 'aberto' são atualizados.
 */
export function atualizarDebitosSelic(debitos: NfpDebito[], taxaSelicAnual: number): NfpDebito[] {
    const hoje = new Date();
    return debitos.map(d => {
        if (d.status !== 'aberto') return d;
        const venc = new Date(d.dataVencimento);
        const diffMs = hoje.getTime() - venc.getTime();
        if (diffMs <= 0) return { ...d, valorAtualizado: d.valorOriginal, dataAtualizacao: hoje.toISOString() };
        const diasAtraso = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const valorAtualizado = d.valorOriginal * (1 + (taxaSelicAnual / 100) * diasAtraso / 365);
        return {
            ...d,
            valorAtualizado: Math.round(valorAtualizado * 100) / 100,
            dataAtualizacao: hoje.toISOString(),
        };
    });
}
