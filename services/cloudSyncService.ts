/**
 * cloudSyncService.ts
 *
 * Sync one-shot de localStorage -> Firestore na primeira vez que um usuario
 * entra com Firebase Auth ativo. Resolve o cenario de empresas cadastradas
 * em modo offline (antes das regras Firestore corretas) que ficaram presas
 * em localStorage.
 *
 * - Idempotente: setDoc com ID deterministico (mesmo ID = sobrescreve, nao duplica).
 * - Marca flag por uid em localStorage para nao re-sincronizar a cada login.
 * - Skip de docs que ja existem na cloud (nao sobrescreve dados mais novos).
 * - Fire-and-forget: nao bloqueia o UI mesmo se a sincronizacao demorar.
 */

import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';
import type { User } from '../types';

const FLAG_PREFIX = '__initial_cloud_sync_done_';

interface CounterStats {
    total: number;
    uploaded: number;
    skipped: number;
    errors: number;
}

interface SyncStats {
    lucroEmpresas: CounterStats;
    simplesEmpresas: CounterStats;
    simplesNotas: CounterStats;
}

const newCounter = (): CounterStats => ({ total: 0, uploaded: 0, skipped: 0, errors: 0 });

const readLocalArray = <T>(key: string): T[] => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const readLocalNotas = (): any[] => {
    try {
        const raw = localStorage.getItem('simples_nacional_notas');
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return [];
        const out: any[] = [];
        Object.values(parsed).forEach((arr: any) => {
            if (Array.isArray(arr)) arr.forEach(n => out.push(n));
        });
        return out;
    } catch {
        return [];
    }
};

const sanitize = (obj: any) =>
    JSON.parse(JSON.stringify(obj, (_k, v) => (v === undefined ? null : v)));

async function syncCollection(
    collectionName: string,
    items: any[],
    uid: string,
    counter: CounterStats,
): Promise<void> {
    counter.total = items.length;
    if (items.length === 0 || !db) return;

    for (const item of items) {
        try {
            if (!item || !item.id) {
                counter.errors++;
                continue;
            }

            const ref = doc(db, collectionName, String(item.id));
            const snap = await getDoc(ref);
            if (snap.exists()) {
                counter.skipped++;
                continue;
            }

            // Garante createdBy = uid (regra exige). Mantem se item ja tinha.
            const payload = sanitize({
                ...item,
                createdBy: item.createdBy || uid,
            });

            await setDoc(ref, payload);
            counter.uploaded++;
        } catch (err: any) {
            counter.errors++;
            console.warn(`[cloudSync] erro em ${collectionName}/${item?.id}:`, err?.message);
        }
    }
}

/**
 * Sincroniza dados locais com Firestore na primeira vez que o usuario loga.
 * Idempotente. Fire-and-forget.
 */
export async function runInitialSync(user: User | null): Promise<SyncStats | null> {
    if (!user) return null;
    if (!isFirebaseConfigured || !db || !auth?.currentUser) return null;

    const uid = auth.currentUser.uid;
    const flagKey = FLAG_PREFIX + uid;
    const isAdmin = user.role === 'admin';

    // Admin sempre re-sincroniza (cobre empresas criadas APOS o primeiro sync
    // que ficaram so em localStorage). Colaborador mantem o gate da flag.
    if (!isAdmin && localStorage.getItem(flagKey) === '1') return null;

    const stats: SyncStats = {
        lucroEmpresas: newCounter(),
        simplesEmpresas: newCounter(),
        simplesNotas: newCounter(),
    };

    try {
        const lucroLocal = readLocalArray('lucro_presumido_empresas');
        const simplesLocal = readLocalArray('simples_nacional_empresas');
        const notasLocal = readLocalNotas();

        await syncCollection('lucro_empresas', lucroLocal, uid, stats.lucroEmpresas);
        await syncCollection('simples_empresas', simplesLocal, uid, stats.simplesEmpresas);
        await syncCollection('simples_notas', notasLocal, uid, stats.simplesNotas);

        localStorage.setItem(flagKey, '1');

        const total = stats.lucroEmpresas.uploaded + stats.simplesEmpresas.uploaded + stats.simplesNotas.uploaded;
        if (total > 0) {
            console.info(
                `[cloudSync] +${total} item(s) -> cloud. ` +
                `Lucro empresas: +${stats.lucroEmpresas.uploaded} (${stats.lucroEmpresas.skipped} existiam de ${stats.lucroEmpresas.total}). ` +
                `Simples empresas: +${stats.simplesEmpresas.uploaded} (${stats.simplesEmpresas.skipped} existiam de ${stats.simplesEmpresas.total}). ` +
                `Simples notas: +${stats.simplesNotas.uploaded} (${stats.simplesNotas.skipped} existiam de ${stats.simplesNotas.total}).`,
            );
        } else {
            console.info(
                `[cloudSync] nada novo. ` +
                `Locais: Lucro ${stats.lucroEmpresas.total}, Simples ${stats.simplesEmpresas.total} empresas, ${stats.simplesNotas.total} notas.`,
            );
        }

        return stats;
    } catch (err: any) {
        console.warn('[cloudSync] falha no sync inicial:', err?.message);
        return null;
    }
}

/** Reseta a flag para forcar re-sync. Util para debug no console do navegador. */
export function resetCloudSyncFlag(): void {
    if (auth?.currentUser?.uid) {
        localStorage.removeItem(FLAG_PREFIX + auth.currentUser.uid);
        console.info('[cloudSync] flag resetada — proximo login vai re-sincronizar');
    }
}
