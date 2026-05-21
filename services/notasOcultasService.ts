/**
 * notasOcultasService — regras "ignorar ESTA nota fiscal especifica nesta
 * empresa" no calculo de credito PIS/COFINS.
 *
 * Diferente de fornecedoresOcultosService (que oculta TODAS as notas de um
 * CNPJ): aqui a granularidade eh a NF individual, identificada pela tripla
 * (CNPJ, numero, serie).
 *
 * Caso de uso: prestador legitimo, mas uma NF especifica nao deve entrar
 * (cancelada, reembolsada, lancada duas vezes, etc). Ao adicionar uma
 * nova NF do mesmo CNPJ via "Adicionar invoice manual", a nova nota
 * aparece normalmente — porque a chave dela difere da que esta oculta.
 *
 * Estrutura:
 *   id = `${empresaId}__${cnpjDigits}__${numero}__${serie}` (sanitizado)
 *   empresaId, cnpjFornecedor, numero, serie, razaoSocial, criadoPor, criadoEm
 *
 * Regras Firestore: read/write para qualquer usuario logado.
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
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';

const COLLECTION = 'notas_ocultas';

export interface NotaOculta {
    id: string;
    empresaId: string;
    cnpjFornecedor: string;
    numero: string;
    serie: string;
    razaoSocial: string;
    criadoPor: string | null;
}

const soDigitos = (s: string): string => (s || '').replace(/\D+/g, '');

/** Chave deterministica de uma NF: `cnpjDigits__numero__serie` */
export function nfChave(cnpj: string, numero: string, serie: string): string {
    return `${soDigitos(cnpj)}__${(numero || '').trim()}__${(serie || '').trim()}`;
}

function regraId(empresaId: string, chave: string): string {
    // Firestore doc ID nao aceita /, [, ], etc — sanitiza
    return `${empresaId}__${chave.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

export async function listarNotasOcultas(empresaId: string): Promise<Set<string>> {
    const set = new Set<string>();
    if (!isFirebaseConfigured || !empresaId) return set;
    try {
        const snap = await getDocs(query(
            collection(db, COLLECTION),
            where('empresaId', '==', empresaId),
        ));
        snap.forEach(d => {
            const r = d.data() as NotaOculta;
            if (r.cnpjFornecedor && r.numero !== undefined) {
                set.add(nfChave(r.cnpjFornecedor, r.numero, r.serie || ''));
            }
        });
    } catch (e) {
        console.error('[notasOcultas] listar:', e);
    }
    return set;
}

export async function ocultarNota(params: {
    empresaId: string;
    cnpjFornecedor: string;
    numero: string;
    serie: string;
    razaoSocial: string;
}): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, error: 'Firebase nao configurado' };
    const cnpj = soDigitos(params.cnpjFornecedor);
    if (!params.empresaId || !cnpj || !params.numero) {
        return { ok: false, error: 'empresaId, CNPJ e numero obrigatorios' };
    }
    try {
        const chave = nfChave(cnpj, params.numero, params.serie || '');
        await setDoc(doc(db, COLLECTION, regraId(params.empresaId, chave)), {
            empresaId: params.empresaId,
            cnpjFornecedor: cnpj,
            numero: params.numero,
            serie: params.serie || '',
            razaoSocial: params.razaoSocial || '',
            criadoPor: auth?.currentUser?.uid || null,
            criadoEm: serverTimestamp(),
        });
        return { ok: true };
    } catch (e) {
        console.error('[notasOcultas] ocultar:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}

export async function restaurarTodasNotas(empresaId: string): Promise<{ ok: boolean; count: number; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, count: 0, error: 'Firebase nao configurado' };
    if (!empresaId) return { ok: false, count: 0, error: 'empresaId obrigatorio' };
    try {
        const snap = await getDocs(query(
            collection(db, COLLECTION),
            where('empresaId', '==', empresaId),
        ));
        if (snap.empty) return { ok: true, count: 0 };
        const batch = writeBatch(db);
        snap.forEach(d => batch.delete(d.ref));
        await batch.commit();
        return { ok: true, count: snap.size };
    } catch (e) {
        console.error('[notasOcultas] restaurarTodas:', e);
        return { ok: false, count: 0, error: e instanceof Error ? e.message : 'erro' };
    }
}
