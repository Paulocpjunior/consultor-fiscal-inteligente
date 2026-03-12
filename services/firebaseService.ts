/**
 * firebaseService.ts
 * Camada de serviço Firebase — Consultor Fiscal Inteligente
 * Centraliza todas as operações com Firestore, Auth e Storage
 */

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore';

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';

// ─── Firebase Config (variáveis de ambiente Vite) ────────────────────────────
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// ─── Verifica se o Firebase está configurado ─────────────────────────────────
export const isFirebaseConfigured =
  !!firebaseConfig.apiKey &&
  !!firebaseConfig.projectId &&
  firebaseConfig.apiKey !== 'undefined';

// ─── Inicializa app (evita duplicação em hot-reload) ─────────────────────────
let app: FirebaseApp;
if (isFirebaseConfigured) {
  app = getApps().length === 0
    ? initializeApp(firebaseConfig)
    : getApps()[0];
} else {
  console.warn('⚠️ Firebase não configurado. Usando modo local (localStorage).');
}

// ─── Exports das instâncias ───────────────────────────────────────────────────
export const auth = isFirebaseConfigured ? getAuth(app!) : null;
export const db   = isFirebaseConfigured ? getFirestore(app!) : null;

// ─────────────────────────────────────────────────────────────────────────────
// AUTH SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export const firebaseAuth = {

  /** Login com email e senha */
  async login(email: string, password: string): Promise<FirebaseUser> {
    if (!auth) throw new Error('Firebase Auth não configurado.');
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  },

  /** Logout */
  async logout(): Promise<void> {
    if (!auth) return;
    await signOut(auth);
  },

  /** Criar novo usuário */
  async createUser(email: string, password: string, displayName: string): Promise<FirebaseUser> {
    if (!auth) throw new Error('Firebase Auth não configurado.');
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    return cred.user;
  },

  /** Recuperar senha */
  async resetPassword(email: string): Promise<void> {
    if (!auth) throw new Error('Firebase Auth não configurado.');
    await sendPasswordResetEmail(auth, email);
  },

  /** Observador de estado de autenticação */
  onAuthChange(callback: (user: FirebaseUser | null) => void) {
    if (!auth) return () => {};
    return onAuthStateChanged(auth, callback);
  },

  /** Usuário atual */
  getCurrentUser(): FirebaseUser | null {
    return auth?.currentUser ?? null;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// FIRESTORE GENÉRICO
// ─────────────────────────────────────────────────────────────────────────────

export const firestoreService = {

  /** Busca um documento por ID */
  async getDoc<T = DocumentData>(collectionName: string, docId: string): Promise<T | null> {
    if (!db) return null;
    const ref = doc(db, collectionName, docId);
    const snap = await getDoc(ref);
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null;
  },

  /** Busca todos os documentos de uma coleção (com filtros opcionais) */
  async getCollection<T = DocumentData>(
    collectionName: string,
    constraints: QueryConstraint[] = []
  ): Promise<T[]> {
    if (!db) return [];
    const ref = collection(db, collectionName);
    const q = constraints.length > 0 ? query(ref, ...constraints) : query(ref);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as T));
  },

  /** Cria ou sobrescreve um documento com ID específico */
  async setDoc<T extends object>(collectionName: string, docId: string, data: T): Promise<void> {
    if (!db) throw new Error('Firestore não configurado.');
    await setDoc(doc(db, collectionName, docId), {
      ...data,
      updatedAt: serverTimestamp(),
    });
  },

  /** Adiciona documento com ID gerado automaticamente */
  async addDoc<T extends object>(collectionName: string, data: T): Promise<string> {
    if (!db) throw new Error('Firestore não configurado.');
    const ref = await addDoc(collection(db, collectionName), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  },

  /** Atualiza campos específicos de um documento */
  async updateDoc<T extends object>(collectionName: string, docId: string, data: Partial<T>): Promise<void> {
    if (!db) throw new Error('Firestore não configurado.');
    await updateDoc(doc(db, collectionName, docId), {
      ...data,
      updatedAt: serverTimestamp(),
    });
  },

  /** Remove um documento */
  async deleteDoc(collectionName: string, docId: string): Promise<void> {
    if (!db) throw new Error('Firestore não configurado.');
    await deleteDoc(doc(db, collectionName, docId));
  },

  /** Listener em tempo real de uma coleção */
  subscribeCollection<T = DocumentData>(
    collectionName: string,
    constraints: QueryConstraint[],
    callback: (data: T[]) => void
  ) {
    if (!db) return () => {};
    const ref = collection(db, collectionName);
    const q = query(ref, ...constraints);
    return onSnapshot(q, snap => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as T)));
    });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// COLEÇÕES ESPECÍFICAS DO PROJETO
// ─────────────────────────────────────────────────────────────────────────────

/** Nomes das coleções no Firestore */
export const COLLECTIONS = {
  USERS:              'users',
  EMPRESAS_SIMPLES:   'empresas_simples',
  NOTAS_SIMPLES:      'notas_simples',
  EMPRESAS_LUCRO:     'empresas_lucro',
  ACCESS_LOGS:        'access_logs',
  OBRIGACOES:         'obrigacoes',
} as const;

// ─── Utilitários ─────────────────────────────────────────────────────────────

/** Converte Timestamp do Firestore para Date JS */
export function timestampToDate(ts: Timestamp | null | undefined): Date | null {
  return ts ? ts.toDate() : null;
}

/** Converte Date JS para Timestamp do Firestore */
export function dateToTimestamp(date: Date): Timestamp {
  return Timestamp.fromDate(date);
}

/** Helpers de query reutilizáveis */
export const q = {
  where,
  orderBy,
  limit,
};

export default firestoreService;
