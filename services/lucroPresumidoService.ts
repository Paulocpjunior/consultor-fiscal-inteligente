
import { LucroPresumidoEmpresa, FichaFinanceiraRegistro, User } from '../types';
import { db, isFirebaseConfigured, auth } from './firebaseConfig';
import { fetchAllDocs } from './firestorePaginate';
import { verificarCnpjDuplicado, mensagemCnpjDuplicado } from './empresaUniquenessService';
import { validarCnpj } from './validadorDocumento';
import { collection, getDocs, doc, updateDoc, setDoc, addDoc, getDoc, query, where, limit as fbLimit } from 'firebase/firestore';

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

    let cloudEmpresas: LucroPresumidoEmpresa[] = [];
    // TODOS os ids que a nuvem conhece (incl. _deleted/_merged_into) — o merge
    // local só pode re-adicionar id DESCONHECIDO da nuvem (criado offline).
    const cloudIds = new Set<string>();

    if (isFirebaseConfigured && db && auth?.currentUser) {
        try {
            const snaps = await fetchAllDocs('lucro_empresas', []);
            snaps.forEach(doc => cloudIds.add(doc.id));
            cloudEmpresas = snaps
                .filter(doc => {
                    const d = doc.data() as any;
                    return !d._merged_into && !d._deleted;
                })
                .map(doc => ({ id: doc.id, ...doc.data() } as LucroPresumidoEmpresa));
            console.info('[Lucro] cloud retornou', cloudEmpresas.length, 'empresas');
        } catch (err: any) {
            console.error('[Lucro] erro buscando empresas no Firestore:', err?.code, err?.message);
        }
    }

    // Merge cloud + local SÓ pra empresa que a nuvem NUNCA viu (criada offline).
    // O merge antigo re-adicionava qualquer cópia do localStorage de QUALQUER
    // navegador — a empresa deletada "ressuscitava" (caso WALDESA 24/07:
    // deletada várias vezes, voltava sempre; um save posterior regravava o
    // zumbi na nuvem pra todo mundo). Cópia local de id conhecido = descartada
    // (nuvem é a fonte da verdade, inclusive sobre exclusão).
    const localEmpresas = getLocalEmpresas();
    const merged = [...cloudEmpresas];
    if (cloudIds.size > 0) {
        localEmpresas.forEach(l => {
            if (!cloudIds.has(l.id) && !merged.find(c => c.id === l.id)) merged.push(l);
        });
    } else {
        // Nuvem indisponível (offline/erro): preserva o cache inteiro.
        localEmpresas.forEach(l => { if (!merged.find(c => c.id === l.id)) merged.push(l); });
    }
    saveLocalEmpresas(merged);
    return merged;
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
    } else if (isFirebaseConfigured && db) {
        // UPDATE: a trava antiga só cobria cadastro novo — editar o CNPJ de uma
        // empresa existente pra um já cadastrado passava direto (2º furo achado
        // na auditoria WALDESA 24/07). Só varre quando o CNPJ MUDOU de fato
        // (salvamento de ficha não paga o custo da varredura).
        try {
            const atual = await getDoc(doc(db, 'lucro_empresas', empresa.id));
            // Guarda anti-ressurreição: doc com lápide _deleted não aceita
            // regravação — sem isso, um "salvar" disparado de um navegador com
            // cache velho recriava a empresa que o admin acabou de excluir.
            if (atual.exists() && (atual.data() as any)._deleted) {
                throw new Error('Esta empresa foi excluída por um administrador — o cadastro não pode ser regravado. Atualize a página (F5); se ela precisa voltar, cadastre-a novamente.');
            }
            const cnpjAtual = String(atual.exists() ? (atual.data() as any).cnpj || '' : '').replace(/\D/g, '');
            const cnpjNovo = String(empresa.cnpj || '').replace(/\D/g, '');
            if (atual.exists() && cnpjNovo && cnpjAtual && cnpjNovo !== cnpjAtual) {
                if (!validarCnpj(empresa.cnpj)) {
                    throw new Error(`CNPJ invalido: "${empresa.cnpj}". Verifique os digitos.`);
                }
                const check = await verificarCnpjDuplicado(empresa.cnpj, empresa.id);
                if (check.duplicado) {
                    throw new Error(mensagemCnpjDuplicado(empresa.cnpj, check));
                }
            }
        } catch (e) {
            // Erros de trava/exclusão sobem; falha de REDE na leitura não bloqueia o save.
            if (e instanceof Error && /CNPJ|exclu/i.test(e.message)) throw e;
        }
    }

    // Garante ID
    const id = empresa.id || generateUUID();

    const newEmpresaData: LucroPresumidoEmpresa = {
        ...empresa,
        id,
        // CNPJ canônico: SÓ DÍGITOS. A base tinha formatos mistos
        // ('05.049.535/0001-70' vs '05049535000170') — caso WALDESA 24/07:
        // mesma empresa duplicada porque o formato enganava o olho. A exibição
        // formata na tela; o dado gravado é normalizado.
        cnpj: String(empresa.cnpj || '').replace(/\D/g, '') || empresa.cnpj,
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
    // createdBy/createdByEmail nao sao alterados e falha na nuvem PROPAGA —
    // mesmo conserto do simplesNacionalService (posse roubada a cada update +
    // erro engolido faziam a edicao "salvar" so no localStorage e sumir no
    // proximo refetch). Ver comentario detalhado la.
    if (isFirebaseConfigured && db && auth?.currentUser) {
        const docRef = doc(db, 'lucro_empresas', id);
        const { id: _, createdBy: __, createdByEmail: ___, ...safeData } = data as any;
        await setDoc(docRef, sanitizePayload(safeData), { merge: true });
    }

    // 2. Update Local (so apos sucesso na nuvem)
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
 * SOFT-DELETE com lápide (caso WALDESA 24/07): o deleteDoc antigo apagava
 * o doc da nuvem, mas cópias no localStorage de OUTROS navegadores eram
 * re-adicionadas pelo merge do getEmpresas e um save posterior regravava
 * o zumbi — "deletada por várias vezes, mas a empresa retorna". A lápide
 * `_deleted` mantém o id conhecido na nuvem pra sempre: o merge descarta
 * a cópia local e as guardas de save/ficha recusam regravação.
 *
 * Regra Firestore (firestore.rules):
 *   allow update: if isOwnerOrAdmin(resource.data.createdBy);
 */
export const deleteEmpresa = async (id: string): Promise<boolean> => {
    if (!isFirebaseConfigured || !db) {
        throw new Error('Firebase nao configurado — nao foi possivel deletar a empresa.');
    }
    // 1. Lápide na nuvem (fonte da verdade). merge:true — NUNCA setDoc cheio
    //    aqui: full overwrite apagaria createdBy e quebraria a regra de posse.
    await setDoc(doc(db, 'lucro_empresas', id), {
        _deleted: true,
        _deletedAt: new Date().toISOString(),
        _deletedBy: auth?.currentUser?.email || 'admin',
    }, { merge: true });

    // 2. Atualiza local cache so depois do sucesso na nuvem
    const localEmpresas = getLocalEmpresas();
    saveLocalEmpresas(localEmpresas.filter(e => e.id !== id));

    return true;
};

export const addFichaFinanceira = async (empresaId: string, registro: FichaFinanceiraRegistro): Promise<LucroPresumidoEmpresa | null> => {

    // 1. Nuvem = fonte da verdade. MESMO conserto do updateEmpresa acima:
    //    - NAO regrava createdBy/createdByEmail (a regra de lucro_empresas
    //      exige dono imutavel no update; gravar o uid de quem salva gerava
    //      permission-denied pra qualquer colaborador que nao fosse o dono);
    //    - erro na nuvem PROPAGA — o silent-catch antigo caia no localStorage
    //      e a competencia "salvava" so no navegador, sumindo no proximo
    //      refetch (bug reportado: ficha Lucro Presumido nao ficava salva).
    if (isFirebaseConfigured && db && auth?.currentUser) {
        const docRef = doc(db, 'lucro_empresas', empresaId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const empresaData = docSnap.data() as LucroPresumidoEmpresa;
            // Lápide: empresa excluída não recebe ficha (grava-se no cadastro
            // certo — o gêmeo mantido — nunca no zumbi).
            if ((empresaData as any)._deleted) {
                throw new Error('Esta empresa foi excluída por um administrador — a ficha não pode ser salva nela. Atualize a página (F5) e lance no cadastro correto.');
            }
            const currentFicha = empresaData.fichaFinanceira || [];

            const fichaAtualizada = currentFicha.filter(f => f.mesReferencia !== registro.mesReferencia);
            fichaAtualizada.push(registro);

            fichaAtualizada.sort((a, b) => (a.mesReferencia || '').localeCompare(b.mesReferencia || ''));

            await updateDoc(docRef, {
                fichaFinanceira: sanitizePayload(fichaAtualizada),
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
        // Doc nao existe na nuvem (empresa so-local legada) — cai no fallback.
    }

    // 2. Fallback Local — apenas quando Firebase esta indisponivel/deslogado
    //    ou a empresa nunca foi sincronizada pra nuvem.
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
