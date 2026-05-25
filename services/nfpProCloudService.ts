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
    setDoc,
    query,
    limit as fbLimit,
    serverTimestamp,
} from 'firebase/firestore';
import { db, isFirebaseConfigured, auth } from './firebaseConfig';
import type { User, NfpAnaliseEmpresa, NfpDebito } from '../types';

const COLLECTION = 'nfp_analises';

/**
 * Salva (ou atualiza) a análise de uma empresa.
 * Retorna o docId utilizado (= empresaId).
 */
export async function salvarAnalise(analise: NfpAnaliseEmpresa, user: User): Promise<string> {
    if (!isFirebaseConfigured || !db) throw new Error('Firebase não configurado');
    if (!auth?.currentUser) throw new Error('Usuário não autenticado');

    const docRef = doc(db, COLLECTION, analise.empresaId);
    await setDoc(docRef, {
        ...analise,
        analisadoPor: user.name,
        analisadoPorUid: auth.currentUser.uid,
        dataAnalise: new Date().toISOString(),
        updatedAt: serverTimestamp(),
    }, { merge: true });

    return analise.empresaId;
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
