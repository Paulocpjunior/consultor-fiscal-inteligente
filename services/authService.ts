import { User, UserRole, AccessLog } from '../types';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';
import { fetchAllDocs } from './firestorePaginate';
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
    getDocs, deleteDoc, query, orderBy, limit as fbLimit, where
} from 'firebase/firestore';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STORAGE_KEY_SESSION  = 'app_current_session';   // cache local (fallback offline)
const STORAGE_KEY_LOGS     = 'app_access_logs';        // cache local de logs
const REQUIRED_DOMAIN      = '@spassessoriacontabil.com.br';
const MASTER_ADMIN_EMAIL   = 'junior@spassessoriacontabil.com.br';

// Modo local (somente dev, sem Firebase configurado). Em prod, isFirebaseConfigured
// eh sempre true (envs obrigatorias - vide firebaseConfig.ts), entao esse caminho
// nunca executa. Aqui apenas removemos a senha hardcoded "123456" que ficava no
// bundle final - quem precisar de modo local em dev define explicitamente.
const LOCAL_MODE_HABILITADO = (import.meta as any).env?.VITE_AUTH_LOCAL_MODE === '1';
const LOCAL_MASTER_PASSWORD: string = (import.meta as any).env?.VITE_AUTH_LOCAL_MASTER_PASSWORD || '';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const normalizeEmail  = (email: string) => email.trim().toLowerCase();
const preparePassword = (pwd: string)   => pwd.trim();
// btoa eh codificacao (NAO hash) - so existe pra evitar senha em texto claro no
// localStorage do colaborador. Reversivel trivialmente, vide DevTools. Aceitavel
// SO porque modo local nao roda em prod.
const encodePasswordForLocalStorage = (pwd: string) => { try { return btoa(pwd); } catch { return pwd; } };

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
        name:       firebaseUser.displayName || cleanEmail.split('@')[0] || cleanEmail,
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
        passwordHash: encodePasswordForLocalStorage(cleanPassword), isVerified: true
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

    // Auto-seed local do Master Admin (so se modo local explicitamente habilitado
    // E senha master vier de env - sem default hardcoded "123456" no bundle).
    if (LOCAL_MODE_HABILITADO &&
        LOCAL_MASTER_PASSWORD &&
        cleanEmail === normalizeEmail(MASTER_ADMIN_EMAIL) &&
        !users.find(u => normalizeEmail(u.email) === cleanEmail)) {
        const master: any = {
            id: crypto.randomUUID(), name: 'Administrador Master', email: cleanEmail,
            role: 'admin', passwordHash: encodePasswordForLocalStorage(LOCAL_MASTER_PASSWORD), isVerified: true
        };
        users.push(master);
        saveLocalUsers(users);
    }

    const user = users.find(u => normalizeEmail(u.email) === cleanEmail);
    if (!user) throw new Error('Usuário não encontrado.');

    const isValid = user.passwordHash === encodePasswordForLocalStorage(cleanPassword) ||
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
            const snaps = await fetchAllDocs('users');
            return snaps.map(d => d.data() as User);
        } catch (e: any) {
            if (e.code === 'permission-denied') {
                // Propaga erro pra UI mostrar mensagem clara
                throw new Error('PERMISSION_DENIED: Apenas administradores podem listar usuarios. Solicite a um admin que te promova.');
            }
            console.warn('getAllUsers:', e.message);
            throw e;
        }
    }
    return getLocalUsers().map(({ passwordHash, ...u }) => u);
};

/**
 * Atualiza role do usuario (apenas admin pode chamar — Firestore rules garantem).
 * @param userId UID do usuario alvo
 * @param role 'admin' | 'colaborador'
 */
export const setUserRole = async (userId: string, role: 'admin' | 'colaborador'): Promise<boolean> => {
    if (!isFirebaseConfigured || !db) {
        // Modo local: atualiza no localStorage
        const users = getLocalUsers();
        const idx = users.findIndex(u => u.id === userId);
        if (idx === -1) return false;
        users[idx].role = role;
        saveLocalUsers(users);
        return true;
    }
    try {
        await setDoc(doc(db, 'users', userId), { role }, { merge: true });
        return true;
    } catch (e: any) {
        console.warn('setUserRole:', e.message);
        if (e.code === 'permission-denied') {
            throw new Error('PERMISSION_DENIED: Apenas administradores podem alterar roles.');
        }
        return false;
    }
};

/**
 * Atualiza a lista de modulos restritos (adminOnly) liberados para um
 * usuario especifico. So admin pode chamar — Firestore rules bloqueiam
 * colaborador de alterar o proprio `modulosPermitidos` (anti auto-concessao).
 * @param userId UID do usuario alvo
 * @param modulos lista de SearchType liberados (ex.: ['Consulta Situação Fiscal'])
 */
export const setUserModulos = async (userId: string, modulos: string[]): Promise<boolean> => {
    const clean = Array.from(new Set((modulos || []).filter(m => typeof m === 'string' && m.trim())));
    if (!isFirebaseConfigured || !db) {
        const users = getLocalUsers();
        const idx = users.findIndex(u => u.id === userId);
        if (idx === -1) return false;
        users[idx].modulosPermitidos = clean;
        saveLocalUsers(users);
        return true;
    }
    try {
        await setDoc(doc(db, 'users', userId), { modulosPermitidos: clean }, { merge: true });
        return true;
    } catch (e: any) {
        console.warn('setUserModulos:', e.message);
        if (e.code === 'permission-denied') {
            throw new Error('PERMISSION_DENIED: Apenas administradores podem liberar módulos restritos.');
        }
        return false;
    }
};

/**
 * Vincula o usuario aos DEPARTAMENTOS do SaaS (fiscal, contabil, dp-folha,
 * legalizacao, financeiro) — o gate dos módulos irmãos, consultado pelo túnel
 * no login deles. Só admin (rules bloqueiam auto-vínculo, mesmo desenho do
 * modulosPermitidos). A validação de catálogo mora no backend
 * (cadastro-central-departamentos.js); aqui só higiene básica.
 */
/**
 * Grava a EXCEÇÃO de horário do usuário (Paulo, 10/08). null limpa (volta ao
 * padrão seg–sex 07–20). Só admin (as rules de users gateiam a escrita).
 */
export const setUserHorario = async (userId: string, horario: import('../types').HorarioAcesso | null): Promise<boolean> => {
    if (!isFirebaseConfigured || !db) {
        const users = getLocalUsers();
        const idx = users.findIndex(u => u.id === userId);
        if (idx === -1) return false;
        users[idx].horarioAcesso = horario;
        saveLocalUsers(users);
        return true;
    }
    try {
        await setDoc(doc(db, 'users', userId), { horarioAcesso: horario }, { merge: true });
        return true;
    } catch (e: any) {
        console.warn('setUserHorario:', e.message);
        if (e.code === 'permission-denied') {
            throw new Error('PERMISSION_DENIED: Apenas administradores podem definir horário de acesso.');
        }
        return false;
    }
};

export const setUserDepartamentos = async (userId: string, departamentos: string[]): Promise<boolean> => {
    const clean = Array.from(new Set((departamentos || []).map(d => (d || '').trim().toLowerCase()).filter(Boolean)));
    if (!isFirebaseConfigured || !db) {
        const users = getLocalUsers();
        const idx = users.findIndex(u => u.id === userId);
        if (idx === -1) return false;
        users[idx].departamentos = clean;
        saveLocalUsers(users);
        return true;
    }
    try {
        await setDoc(doc(db, 'users', userId), { departamentos: clean }, { merge: true });
        return true;
    } catch (e: any) {
        console.warn('setUserDepartamentos:', e.message);
        if (e.code === 'permission-denied') {
            throw new Error('PERMISSION_DENIED: Apenas administradores podem vincular departamentos.');
        }
        return false;
    }
};

/**
 * Atualiza o display name (campo `name`) do usuario. So admin pode chamar
 * (rules em users.update já garantem isso). Email NAO eh editavel daqui:
 * o email vive no Firebase Auth + e duplicado no doc; alterar so o doc
 * deixaria as duas coisas dessincronizadas e o login continuaria com o
 * email antigo. Mudanca de email exige Admin SDK no backend.
 */
export const setUserName = async (userId: string, name: string): Promise<boolean> => {
    const nameTrim = (name || '').trim();
    if (!nameTrim) return false;
    if (!isFirebaseConfigured || !db) {
        const users = getLocalUsers();
        const idx = users.findIndex(u => u.id === userId);
        if (idx === -1) return false;
        users[idx].name = nameTrim;
        saveLocalUsers(users);
        return true;
    }
    try {
        await setDoc(doc(db, 'users', userId), { name: nameTrim }, { merge: true });
        return true;
    } catch (e: any) {
        console.warn('setUserName:', e.message);
        if (e.code === 'permission-denied') {
            throw new Error('PERMISSION_DENIED: Apenas administradores podem editar o nome.');
        }
        return false;
    }
};

/**
 * Le os ultimos N logs do access_logs.
 * @param limit numero maximo de logs (default 50)
 */
export const getRecentLogs = async (limit: number = 50): Promise<AccessLog[]> => {
    if (!isFirebaseConfigured || !db) {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_LOGS);
            const logs = raw ? JSON.parse(raw) : [];
            return Array.isArray(logs) ? logs.slice(0, limit) : [];
        } catch {
            return [];
        }
    }
    try {
        const q = query(
            collection(db, 'access_logs'),
            orderBy('timestamp', 'desc'),
            fbLimit(limit),
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => d.data() as AccessLog);
    } catch (e: any) {
        if (e.code === 'permission-denied') {
            throw new Error('PERMISSION_DENIED: Apenas administradores podem ler logs.');
        }
        console.warn('getRecentLogs:', e.message);
        throw e;
    }
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
    if (!LOCAL_MODE_HABILITADO || !LOCAL_MASTER_PASSWORD) return false;
    const users = getLocalUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx !== -1) {
        users[idx].passwordHash = encodePasswordForLocalStorage(LOCAL_MASTER_PASSWORD);
        saveLocalUsers(users);
    }
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
                    fbLimit(100)
                );
            } else {
                q = query(
                    collection(db, 'access_logs'),
                    orderBy('timestamp', 'desc'),
                    fbLimit(100)
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
        // Firestore SDK rejeita objetos com campos `undefined` antes de virar Promise.
        // Sanitiza removendo chaves com undefined (especialmente `details`, opcional).
        const cloudPayload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(newLog)) {
            if (v !== undefined) cloudPayload[k] = v;
        }
        try {
            addDoc(collection(db, 'access_logs'), cloudPayload).catch((err) => {
                console.debug('logAction: falha silenciosa ao gravar em access_logs:', err?.message);
            });
        } catch (err: any) {
            // Erro síncrono de validação (ex.: payload com undefined que escapou)
            console.debug('logAction: payload inválido para Firestore:', err?.message);
        }
    }
};
