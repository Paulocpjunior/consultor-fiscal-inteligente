/**
 * carteiraService — gestão da carteira de colaboradores.
 *
 * Cada documento da coleção `carteiras` é UM vínculo empresa <-> colaborador.
 * Uma empresa pode ter vários colaboradores (vários docs). O admin atribui;
 * o colaborador apenas lê os vínculos dele.
 *
 * Regras Firestore: leitura para qualquer logado, escrita só admin.
 * O isolamento "colaborador vê só os seus" é feito AQUI no código.
 */
import {
    collection,
    addDoc,
    deleteDoc,
    getDocs,
    doc,
    query,
    where,
    serverTimestamp,
    limit as fbLimit,
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';
import type { User } from '../types';
import { vinculoPertenceAoUsuario } from './visibilidadeCarteira';
// 🚨 Dono ÚNICO da leitura dos vínculos — eram duas cópias do mesmo teto
// mudo de 500, e a segunda decidia o ESCOPO da Central de XMLs.
import { lerTodosOsVinculos } from './carteiraVinculos';

const COLLECTION = 'carteiras';

export type PapelCarteira = 'principal' | 'backup';

/** Um vínculo empresa <-> colaborador, como gravado no Firestore. */
export interface VinculoCarteira {
    id: string;
    empresaId: string;
    empresaColecao: 'simples_empresas' | 'lucro_empresas';
    empresaNome: string;
    empresaCnpj: string;
    colaboradorUid: string;
    colaboradorNome: string;
    papel: PapelCarteira;
    atribuidoPor: string;
    atribuidoEm: any;
}

/** Dados para criar um novo vínculo. */
export interface NovoVinculo {
    empresaId: string;
    empresaColecao: 'simples_empresas' | 'lucro_empresas';
    empresaNome: string;
    empresaCnpj: string;
    colaboradorUid: string;
    colaboradorNome: string;
    papel: PapelCarteira;
}

/**
 * Lista todos os vínculos da carteira.
 * Admin recebe todos; colaborador recebe só os vínculos com o uid dele.
 * O filtro é feito em memória (a regra Firestore libera a leitura).
 */
export async function listarCarteiras(user: User | null): Promise<VinculoCarteira[]> {
    if (!user || !isFirebaseConfigured || !db) return [];
    try {
        // 🚨 ERA `fbLimit(500)` — teto MUDO. Com 420 empresas e principal +
        // backup a carteira passou de 500 vínculos, e os que ficaram fora da
        // página viravam "Sem responsável" na tela (Paulo, 27/08: 21 empresas).
        // E atribuir respondia "já atende" porque a conferência de duplicata
        // consulta por empresaId+colaboradorUid, que NÃO passa pela página
        // cortada: o vínculo existia, quem não o via era a lista.
        const leitura = await lerTodosOsVinculos<VinculoCarteira>((id, dados) => ({
            id, ...(dados as Omit<VinculoCarteira, 'id'>),
        }));
        const todos = leitura.vinculos;

        const isAdmin = user.role === 'admin';
        const uid = auth?.currentUser?.uid;
        if (isAdmin || !uid) return todos;
        return todos.filter(v => vinculoPertenceAoUsuario(v, user, uid));
    } catch (err: any) {
        console.warn('listarCarteiras:', err?.message);
        return [];
    }
}

/**
 * Cria um vínculo empresa <-> colaborador. Só admin (garantido pela regra).
 * Evita duplicar: se o mesmo par empresa+colaborador já existir, não recria.
 */
export async function atribuir(novo: NovoVinculo): Promise<{ ok: boolean; jaExistia?: boolean; error?: string }> {
    if (!isFirebaseConfigured || !db) return { ok: false, error: 'Firebase não configurado' };
    const uid = auth?.currentUser?.uid;
    if (!uid) return { ok: false, error: 'Usuário não autenticado' };
    try {
        const existentes = await getDocs(query(
            collection(db, COLLECTION),
            where('empresaId', '==', novo.empresaId),
            where('colaboradorUid', '==', novo.colaboradorUid),
            fbLimit(1),
        ));
        if (!existentes.empty) {
            return { ok: true, jaExistia: true };
        }
        await addDoc(collection(db, COLLECTION), {
            empresaId: novo.empresaId,
            empresaColecao: novo.empresaColecao,
            empresaNome: novo.empresaNome,
            empresaCnpj: novo.empresaCnpj,
            colaboradorUid: novo.colaboradorUid,
            colaboradorNome: novo.colaboradorNome,
            papel: novo.papel,
            atribuidoPor: uid,
            atribuidoEm: serverTimestamp(),
        });
        return { ok: true };
    } catch (err: any) {
        console.warn('atribuir:', err?.message);
        return { ok: false, error: err?.message || 'Falha ao atribuir' };
    }
}

/** Remove um vínculo pelo id. Só admin (garantido pela regra). */
export async function removerVinculo(vinculoId: string): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured || !db) return { ok: false, error: 'Firebase não configurado' };
    try {
        await deleteDoc(doc(db, COLLECTION, vinculoId));
        return { ok: true };
    } catch (err: any) {
        console.warn('removerVinculo:', err?.message);
        return { ok: false, error: err?.message || 'Falha ao remover' };
    }
}

/**
 * Retorna os empresaId que pertencem à carteira de um colaborador.
 * Usado pelas frentes 3/4 e pelo AlertaPopup para filtrar por carteira.
 */
export async function getEmpresasDoColaborador(uid: string): Promise<string[]> {
    if (!isFirebaseConfigured || !db || !uid) return [];
    try {
        const snap = await getDocs(query(
            collection(db, COLLECTION),
            where('colaboradorUid', '==', uid),
            fbLimit(500),
        ));
        return snap.docs.map(d => (d.data() as VinculoCarteira).empresaId);
    } catch (err: any) {
        console.warn('getEmpresasDoColaborador:', err?.message);
        return [];
    }
}
