import { User, UserRole, AccessLog } from '../types';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    updateProfile,
    onAuthStateChanged,
    User as FirebaseUser
} from 'firebase/auth';
import {
    doc, setDoc, getDoc, collection, addDoc,
    getDocs, deleteDoc, query, orderBy, limit, where
} from 'firebase/firestore';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STORAGE_KEY_SESSION  = 'app_current_session';   // cache local (fallback offline)
const STORAGE_KEY_LOGS     = 'app_access_logs';        // cache local de logs
const REQUIRED_DOMAIN      = '@spassessoriacontabil.com.br';
const MASTER_ADMIN_EMAIL   = 'junior@spassessoriacontabil.com.br';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const normalizeEmail  = (email: string) => email.trim().toLowerCase();
const preparePassword = (pwd: string)   => pwd.trim();
const hashPassword    = (pwd: string)   => { try { return btoa(pwd); } catch { return pwd; } };

/** Cache local só para suporte offline */
const cacheSession = (user: User) =>
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(user));

const clearLocalSession = () =>
    localStorage.removeItem(STORAGE_KEY_SESSION);

const getLocalUsers = (): any[] => {
    try { return JSON.parse(localStorage.getItem('app_users') || '[]'); }
    catch { return []; }
};
const saveLocalUsers = (users: any[]) =>
    localStorage.setItem('app_users', JSON.stringify(users));

// ─── AUTH STATE LISTENER (use no App root) ────────────────────────────────────
/**
 * Subscreve às mudanças de autenticação do Firebase.
 * Use na raiz do app: const unsub = subscribeAuthState(setCurrentUser)
 */
export const subscribeAuthState = (callback: (user: User | null) => void) => {
    if (!isFirebaseConfigured || !auth) {
        // Modo local: lê do cache
        try {
            const cached = localStorage.getItem(STORAGE_KEY_SESSION);
            callback(cached ? JSON.parse(cached) : null);
        } catch { callback(null); }
        return () => {};
    }

    return onAuthStateChanged(auth, async (firebaseUser) => {
        if (!firebaseUser) {
            clearLocalSession();
            callback(null);
            return;
        }
        const user = await syncUserFromAuth(firebaseUser);
        callback(user);
    });
};

// ─── CURRENT USER ─────────────────────────────────────────────────────────────
/**
 * Retorna o usuário atual.
 * Prioridade: Firebase Auth (online) → cache localStorage (offline).
 */
export const getCurrentUser = (): User | null => {
    // Se Firebase disponível e há usuário autenticado, usa o cache que foi
    // gravado pelo syncUserFromAuth (atualizado a cada login/refresh).
    try {
        const session = localStorage.getItem(STORAGE_KEY_SESSION);
        return session ? JSON.parse(session) : null;
    } catch { return null; }
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
export const logout = async () => {
    const user = getCurrentUser();
    if (user) logAction(user.id, user.name, 'logout');
    clearLocalSession();
    if (isFirebaseConfigured && auth) await signOut(auth);
};

// ─── SYNC USER FROM FIREBASE AUTH ─────────────────────────────────────────────
/**
 * Recupera/cria o perfil completo no Firestore e atualiza o cache local.
 * Chamada automaticamente pelo onAuthStateChanged e após login/register.
 */
export const syncUserFromAuth = async (firebaseUser: FirebaseUser): Promise<User> => {
    const cleanEmail = normalizeEmail(firebaseUser.email || '');
    const isMaster   = cleanEmail === normalizeEmail(MASTER_ADMIN_EMAIL);

    const fallbackUser: User = {
        id:         firebaseUser.uid,
        name:       firebaseUser.displayName || cleanEmail.split('@')[0],
        email:      cleanEmail,
        role:       isMaster ? 'admin' : 'colaborador',
        isVerified: true
    };

    if (!db) {
        cacheSession(fallbackUser);
        return fallbackUser;
    }

    try {
        const userDocRef  = doc(db, 'users', firebaseUser.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            const userData = userDocSnap.data() as User;

            // Auto-correção: garante que o master sempre seja admin
            if (isMaster && userData.role !== 'admin') {
                userData.role = 'admin';
                await setDoc(userDocRef, userData, { merge: true });
            }

            cacheSession(userData);
            logAction(userData.id, userData.name, 'login');
            return userData;
        }

        // Usuário existe no Auth mas não no Firestore → cria agora
        console.log('Perfil ausente no Firestore. Criando:', cleanEmail);
        await setDoc(userDocRef, fallbackUser).catch(err => {
            if (err.code === 'permission-denied')
                console.error('Firestore: permissão negada em "users". Verifique as Security Rules.');
        });

        cacheSession(fallbackUser);
        logAction(fallbackUser.id, fallbackUser.name, 'login');
        return fallbackUser;

    } catch (e: any) {
        // Offline ou erro de rede: usa fallback com cache
        console.warn('syncUserFromAuth: usando fallback offline.', e?.message);
        cacheSession(fallbackUser);
        return fallbackUser;
    }
};

// ─── REGISTER ─────────────────────────────────────────────────────────────────
export const register = async (
    name: string, email: string, password: string
): Promise<{ user: User }> => {
    const cleanEmail    = normalizeEmail(email);
    const cleanPassword = preparePassword(password);

    if (!cleanEmail.endsWith(REQUIRED_DOMAIN))
        throw new Error(`Cadastro permitido apenas para e-mails ${REQUIRED_DOMAIN}`);
    if (!cleanPassword)
        throw new Error('Senha vazia.');

    // ── Firebase (modo padrão) ──
    if (isFirebaseConfigured && auth) {
        try {
            const credential = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPassword);
            await updateProfile(credential.user, { displayName: name.trim() });
            const user = await syncUserFromAuth(credential.user);
            return { user };
        } catch (error: any) {
            if (error.code === 'auth/email-already-in-use')
                throw new Error('Este e-mail já está cadastrado. Tente fazer login.');
            if (error.code === 'auth/weak-password')
                throw new Error('A senha deve ter pelo menos 6 caracteres.');
            throw new Error(error.message || 'Erro no cadastro.');
        }
    }

    // ── Modo local (sem Firebase) ──
    const users = getLocalUsers();
    if (users.some(u => normalizeEmail(u.email) === cleanEmail))
        throw new Error('E-mail já existe.');

    const isMaster = cleanEmail === normalizeEmail(MASTER_ADMIN_EMAIL);
    const newUser: any = {
        id: crypto.randomUUID(), name: name.trim(), email: cleanEmail,
        role: isMaster ? 'admin' : 'colaborador',
        passwordHash: hashPassword(cleanPassword), isVerified: true
    };
    users.push(newUser);
    saveLocalUsers(users);

    const { passwordHash, ...safeUser } = newUser;
    cacheSession(safeUser);
    return { user: safeUser };
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
export const login = async (
    email: string, password: string
): Promise<{ user: User }> => {
    const cleanEmail    = normalizeEmail(email);
    const cleanPassword = preparePassword(password);

    // ── Firebase (modo padrão) ──
    if (isFirebaseConfigured && auth) {
        try {
            const credential = await signInWithEmailAndPassword(auth, cleanEmail, cleanPassword);
            const user = await syncUserFromAuth(credential.user);
            return { user };
        } catch (error: any) {
            // Auto-seed do Admin Master se não existir na nuvem
            if (cleanEmail === normalizeEmail(MASTER_ADMIN_EMAIL) &&
                ['auth/user-not-found', 'auth/invalid-credential'].includes(error.code)) {
                try {
                    return await register('Administrador Master', cleanEmail, cleanPassword);
                } catch { /* cai no erro genérico abaixo */ }
            }
            if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password']
                .includes(error.code))
                throw new Error('Usuário não encontrado ou senha incorreta.');
            throw new Error(`Falha de login: ${error.message}`);
        }
    }

    // ── Modo local ──
    const users = getLocalUsers();

    // Auto-seed local do Master Admin
    if (cleanEmail === normalizeEmail(MASTER_ADMIN_EMAIL) &&
        !users.find(u => normalizeEmail(u.email) === cleanEmail)) {
        const master: any = {
            id: crypto.randomUUID(), name: 'Administrador Master', email: cleanEmail,
            role: 'admin', passwordHash: hashPassword('123456'), isVerified: true
        };
        users.push(master);
        saveLocalUsers(users);
    }

    const user = users.find(u => normalizeEmail(u.email) === cleanEmail);
    if (!user) throw new Error('Usuário não encontrado.');

    const isValid = user.passwordHash === hashPassword(cleanPassword) ||
                    user.passwordHash === cleanPassword;
    if (!isValid) throw new Error('Senha incorreta.');

    const { passwordHash, ...safeUser } = user;
    cacheSession(safeUser);
    return { user: safeUser };
};

// ─── ADMIN ────────────────────────────────────────────────────────────────────
export const getAllUsers = async (): Promise<User[]> => {
    if (isFirebaseConfigured && db) {
        try {
            const snapshot = await getDocs(collection(db, 'users'));
            return snapshot.docs.map(d => d.data() as User);
        } catch (e: any) {
            if (e.code !== 'permission-denied') console.warn('getAllUsers:', e.message);
        }
    }
    return getLocalUsers().map(({ passwordHash, ...u }) => u);
};

export const deleteUser = async (userId: string): Promise<boolean> => {
    if (isFirebaseConfigured && db) {
        try { await deleteDoc(doc(db, 'users', userId)); return true; }
        catch (e) { console.warn('deleteUser:', e); return false; }
    }
    saveLocalUsers(getLocalUsers().filter(u => u.id !== userId));
    return true;
};

export const resetUserPassword = async (userId: string): Promise<boolean> => {
    if (isFirebaseConfigured) return true; // requer backend/email p/ outro usuário
    const users = getLocalUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx !== -1) { users[idx].passwordHash = hashPassword('123456'); saveLocalUsers(users); }
    return idx !== -1;
};

// ─── ACCESS LOGS ──────────────────────────────────────────────────────────────
/**
 * Lê logs do Firestore (cloud-first) com fallback para localStorage.
 */
export const getAccessLogs = async (userIdFilter?: string): Promise<AccessLog[]> => {
    // ── Cloud ──
    if (isFirebaseConfigured && db) {
        try {
            let q;
            if (userIdFilter) {
                q = query(
                    collection(db, 'access_logs'),
                    where('userId', '==', userIdFilter),
                    orderBy('timestamp', 'desc'),
                    limit(100)
                );
            } else {
                q = query(
                    collection(db, 'access_logs'),
                    orderBy('timestamp', 'desc'),
                    limit(100)
                );
            }
            const snapshot = await getDocs(q);
            return snapshot.docs.map(d => d.data() as AccessLog);
        } catch (e: any) {
            if (e.code !== 'permission-denied') console.warn('getAccessLogs cloud:', e.message);
        }
    }

    // ── Local fallback ──
    try {
        const logs: AccessLog[] = JSON.parse(localStorage.getItem(STORAGE_KEY_LOGS) || '[]');
        const sorted = logs.sort((a, b) => b.timestamp - a.timestamp);
        return userIdFilter ? sorted.filter(l => l.userId === userIdFilter) : sorted;
    } catch { return []; }
};

export const logAction = (
    userId: string, userName: string, action: string, details?: string
) => {
    const newLog: AccessLog = {
        id: Date.now().toString(), userId, userName,
        timestamp: Date.now(), action, details
    };

    // ── Local (imediato) ──
    try {
        const logs: AccessLog[] = JSON.parse(localStorage.getItem(STORAGE_KEY_LOGS) || '[]');
        localStorage.setItem(STORAGE_KEY_LOGS,
            JSON.stringify([newLog, ...logs].slice(0, 100)));
    } catch { /* silent */ }

    // ── Cloud (async, sem bloquear) ──
    if (isFirebaseConfigured && db) {
        addDoc(collection(db, 'access_logs'), newLog).catch(() => {});
    }
};
