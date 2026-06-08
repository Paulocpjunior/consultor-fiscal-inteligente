
import { LucroPresumidoEmpresa, FichaFinanceiraRegistro, User } from '../types';
import { db, isFirebaseConfigured, auth } from './firebaseConfig';
import { fetchAllDocs } from './firestorePaginate';
import { getEmpresasDoColaborador } from './carteiraService';
import { verificarCnpjDuplicado, mensagemCnpjDuplicado } from './empresaUniquenessService';
import { validarCnpj } from './validadorDocumento';
import { collection, getDocs, doc, updateDoc, setDoc, addDoc, getDoc, query, where, deleteDoc, limit as fbLimit } from 'firebase/firestore';

const STORAGE_KEY_LUCRO_EMPRESAS = 'lucro_presumido_empresas';
const MASTER_ADMIN_EMAIL = 'junior@spassessoriacontabil.com.br';

const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// Helper to remove undefined values which Firestore dislikes
const sanitizePayload = (obj: any) => {
    return JSON.parse(JSON.stringify(obj));
};

const getLocalEmpresas = (): LucroPresumidoEmpresa[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY_LUCRO_EMPRESAS);
        return stored ? JSON.parse(stored) : [];
    } catch { return []; }
};

const saveLocalEmpresas = (empresas: LucroPresumidoEmpresa[]) => {
    localStorage.setItem(STORAGE_KEY_LUCRO_EMPRESAS, JSON.stringify(empresas));
};

// --- CRUD ---

export const getEmpresas = async (currentUser?: User | null): Promise<LucroPresumidoEmpresa[]> => {
    if (!currentUser) return [];
    
    const isMasterAdmin = currentUser.role === 'admin' || currentUser.email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase();

    // 1. Tenta buscar da Nuvem (Prioridade)
    if (isFirebaseConfigured && db && auth?.currentUser) {
        try {
            const uid = auth.currentUser.uid;

            try {
                // Admin/Junior: busca TUDO. Colaborador: busca TUDO (rules
                // permitem) e filtra no cliente por createdBy OU vinculo em
                // carteiras. Antes filtrava so por createdBy -- colaborador nao
                // via empresa atribuida via carteira quando outro colega criava
                // (bug reportado 06/2026, mesma raiz do Simples).
                const snaps = await fetchAllDocs('lucro_empresas', []);
                let cloudEmpresas = snaps
                    .filter(doc => !(doc.data() as any)._merged_into)
                    .map(doc => ({ id: doc.id, ...doc.data() } as LucroPresumidoEmpresa));

                if (!isMasterAdmin) {
                    const carteiraIds = new Set(await getEmpresasDoColaborador(uid));
                    cloudEmpresas = cloudEmpresas.filter(e => e.createdBy === uid || carteiraIds.has(e.id));
                }
                
                // Se conseguiu buscar da nuvem, atualiza o cache local (apenas para modo offline)
                if (cloudEmpresas.length > 0) {
                    const local = getLocalEmpresas();
                    const merged = [...cloudEmpresas];
                    local.forEach(l => {
                        if (!merged.find(c => c.id === l.id)) merged.push(l);
                    });
                    saveLocalEmpresas(merged);
                    return cloudEmpresas;
                }
            } catch (err: any) {
                if (err.code !== 'permission-denied' && err.code !== 'failed-precondition') {
                    console.debug("Firebase fetch warning (Lucro):", err.message);
                }
            }
        } catch (e: any) {
            // Silently ignore main query errors
        }
    }

    // 2. Fallback Local (Se nuvem falhar ou não configurada)
    const localEmpresas = getLocalEmpresas();

    if (!isMasterAdmin) {
        return localEmpresas.filter(e => e.createdBy === currentUser.id || !e.createdBy);
    }
    return localEmpresas;
};

export const saveEmpresa = async (empresa: any, userId: string): Promise<LucroPresumidoEmpresa> => {
    // Trava de unicidade — SO em cadastro novo (sem id). Preserva re-saves
    // de empresas ja existentes (fluxo atual usa saveEmpresa pra update tambem).
    if (!empresa.id) {
        if (!validarCnpj(empresa.cnpj || '')) {
            throw new Error(`CNPJ invalido: "${empresa.cnpj || ''}". Verifique os digitos.`);
        }
        const check = await verificarCnpjDuplicado(empresa.cnpj || '');
        if (check.duplicado) {
            throw new Error(mensagemCnpjDuplicado(empresa.cnpj || '', check));
        }
    }

    // Garante ID
    const id = empresa.id || generateUUID();
    
    const newEmpresaData: LucroPresumidoEmpresa = { 
        ...empresa, 
        id,
        fichaFinanceira: empresa.fichaFinanceira || [], 
        createdBy: userId,
        createdByEmail: auth?.currentUser?.email || undefined,
        // Default: nova empresa ativa pra cron SEFAZ. Preserva valor se já vier no objeto.
        capturarSefaz: empresa.capturarSefaz !== false
    };

    // 1. Tenta salvar na Nuvem (Fonte da Verdade)
    if (isFirebaseConfigured && db && auth?.currentUser) {
        try {
            newEmpresaData.createdBy = auth.currentUser.uid;
            newEmpresaData.createdByEmail = auth.currentUser.email || undefined;

            const payload = sanitizePayload(newEmpresaData);
            await setDoc(doc(db, 'lucro_empresas', id), payload);
        } catch (e: any) { 
            // Silent fallback
        }
    }

    // 2. Salva Local (Backup/Cache)
    const localEmpresas = getLocalEmpresas();
    const existingIndex = localEmpresas.findIndex(e => e.id === id);
    if (existingIndex >= 0) {
        localEmpresas[existingIndex] = newEmpresaData;
    } else {
        localEmpresas.push(newEmpresaData);
    }
    saveLocalEmpresas(localEmpresas);

    return newEmpresaData;
};

export const updateEmpresa = async (id: string, data: Partial<LucroPresumidoEmpresa>): Promise<LucroPresumidoEmpresa | null> => {
    // 1. Update Cloud
    if (isFirebaseConfigured && db && auth?.currentUser) {
        try {
            const docRef = doc(db, 'lucro_empresas', id);
            const { id: _, createdBy: __, createdByEmail: ___, ...safeData } = data as any; 
            
            const payload = sanitizePayload({ 
                ...safeData, 
                createdBy: auth.currentUser.uid,
                createdByEmail: auth.currentUser.email 
            });
            
            await setDoc(docRef, payload, { merge: true });
        } catch (e: any) { 
            // Silent fallback
        }
    }

    // 2. Update Local
    const localEmpresas = getLocalEmpresas();
    const index = localEmpresas.findIndex(e => e.id === id);
    const existente = index !== -1 ? localEmpresas[index] : null;
    if (existente) {
        const atualizada = { ...existente, ...data };
        localEmpresas[index] = atualizada;
        saveLocalEmpresas(localEmpresas);
        return atualizada;
    }

    return null;
};

/**
 * Deleta uma empresa do Lucro Presumido/Real. Firestore eh fonte da
 * verdade — se a delecao na nuvem falhar (permission-denied, network,
 * etc), o erro propaga e o cache local NAO eh modificado.
 *
 * Antes (bug): silent catch + sempre apaga local => empresa "sumia da
 * tela mas voltava no proximo refresh". Sintoma classico de admin que
 * "nao consegue deletar". Conserto: throw em vez de silenciar.
 *
 * Regra Firestore (firestore.rules):
 *   allow delete: if isOwnerOrAdmin(resource.data.createdBy);
 */
export const deleteEmpresa = async (id: string): Promise<boolean> => {
    if (!isFirebaseConfigured || !db) {
        throw new Error('Firebase nao configurado — nao foi possivel deletar a empresa.');
    }
    // 1. Deleta da nuvem (fonte da verdade). Se falhar, throw — nao toca no local.
    await deleteDoc(doc(db, 'lucro_empresas', id));

    // 2. Atualiza local cache so depois do sucesso na nuvem
    const localEmpresas = getLocalEmpresas();
    saveLocalEmpresas(localEmpresas.filter(e => e.id !== id));

    return true;
};

export const addFichaFinanceira = async (empresaId: string, registro: FichaFinanceiraRegistro): Promise<LucroPresumidoEmpresa | null> => {
    
    // 1. Se estiver online, busca o documento atualizado primeiro para não perder histórico
    if (isFirebaseConfigured && db && auth?.currentUser) {
        try {
            const docRef = doc(db, 'lucro_empresas', empresaId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const empresaData = docSnap.data() as LucroPresumidoEmpresa;
                const currentFicha = empresaData.fichaFinanceira || [];
                
                const fichaAtualizada = currentFicha.filter(f => f.mesReferencia !== registro.mesReferencia);
                fichaAtualizada.push(registro);

                fichaAtualizada.sort((a, b) => a.mesReferencia.localeCompare(b.mesReferencia));

                await updateDoc(docRef, { 
                    fichaFinanceira: sanitizePayload(fichaAtualizada),
                    createdBy: auth.currentUser.uid,
                    createdByEmail: auth.currentUser.email
                });
                
                const localEmpresas = getLocalEmpresas();
                const idx = localEmpresas.findIndex(e => e.id === empresaId);
                const empLocal = idx !== -1 ? localEmpresas[idx] : null;
                if (empLocal) {
                    empLocal.fichaFinanceira = fichaAtualizada;
                    saveLocalEmpresas(localEmpresas);
                    return empLocal;
                }
                return { ...empresaData, fichaFinanceira: fichaAtualizada };
            }
        } catch (e: any) {
            if (e.code !== 'permission-denied') {
                console.debug("Firestore: Falha ao salvar ficha na nuvem:", e.message);
            }
        }
    }

    // 2. Fallback Local
    const localEmpresas = getLocalEmpresas();
    const index = localEmpresas.findIndex(e => e.id === empresaId);
    const empresa = index !== -1 ? localEmpresas[index] : null;

    if (empresa) {
        const currentFicha = empresa.fichaFinanceira || [];
        const fichaAtualizada = currentFicha.filter(f => f.mesReferencia !== registro.mesReferencia);
        fichaAtualizada.push(registro);

        empresa.fichaFinanceira = fichaAtualizada;
        saveLocalEmpresas(localEmpresas);
        return empresa;
    }

    return null;
};
