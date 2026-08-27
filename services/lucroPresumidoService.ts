
import { LucroPresumidoEmpresa, FichaFinanceiraRegistro, User } from '../types';
import { db, isFirebaseConfigured, auth } from './firebaseConfig';
import { fetchAllDocs } from './firestorePaginate';
import { verificarCnpjDuplicado, mensagemCnpjDuplicado } from './empresaUniquenessService';
import { validarCnpj } from './validadorDocumento';
import { collection, getDocs, doc, updateDoc, setDoc, addDoc, getDoc, query, where, limit as fbLimit } from 'firebase/firestore';
// 🔒 O dono da pergunta "qual é a competência?" — a ficha grava `mesReferencia`
// em quatro formas, e `===` perderia a competência fechada em silêncio.
import { normalizarCompetencia } from '../sefaz-backend/competencia.js';
// 🔒 O ID do carimbo é RÉGUA ÚNICA — o I/O difere (aqui é o SDK modular, lá é o
// admin), mas `${id}_07/2026` e `${id}_2026-07` seriam DOIS carimbos para o
// mesmo mês. Montá-lo à mão aqui foi pego pela varredura.
import { idDoFechamento, COLECAO_FECHAMENTOS } from '../sefaz-backend/fechamento-store.js';

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

// ─── LISTA LEVE (cadastro, SEM a ficha financeira) ───────────────────────────
//
// Paulo, 14/08: *"não carregamos nenhuma informação do banco de dados até que o
// colaborador ative a empresa, ganhamos tempo e agilidade"*.
//
// A `fichaFinanceira[]` é EMBUTIDA no documento da empresa (um registro de ~46
// campos por mês), e o SDK do navegador não projeta campos: `getDocs` traz o
// documento inteiro, sempre. Por isso a lista leve vem do BACKEND, que tem
// `.select()`.
//
// ⚠️ O TIPO É OUTRO DE PROPÓSITO. `LucroEmpresaResumo` **não é** um
// `LucroPresumidoEmpresa` — ele não tem `fichaFinanceira`. Se fosse o mesmo
// tipo, dava para espalhar um resumo num `updateEmpresa` e **apagar a ficha
// financeira inteira** de um cliente, em silêncio e sem volta. Sendo tipos
// distintos, quem tentar isso não compila: o `tsc` é a trava, e trava que o
// compilador aplica não depende de ninguém lembrar.

export interface LucroEmpresaResumo {
    id: string;
    nome: string | null;
    cnpj: string | null;
    uf: string | null;
    regimePadrao: 'Presumido' | 'Real' | null;
    codCliente: string | null;
    /**
     * CONTAGEM de fichas — nunca o array.
     *
     * O selo de duplicata da lista diz "0 fichas — excluir este" × "N ficha(s)
     * — manter", e é com ele que alguém decide QUAL CADASTRO APAGAR. Um zero
     * que na verdade significasse "não carreguei" mandaria excluir o cadastro
     * bom. Por isso o backend lê o array e devolve o número.
     */
    fichas: number;
    capturarSefaz: boolean;
}

export interface LucroResumoResposta {
    empresas: LucroEmpresaResumo[];
    total: number;
    ocultas: { excluidas: number; fundidas: number };
    /** Motivo de a lista ter vindo pelo caminho antigo (pesado), quando veio. */
    degradado?: string;
}

/**
 * Lista para ESCOLHER a empresa. O documento completo só é buscado no ⚡ Ativar.
 *
 * Se a rota falhar, cai no caminho antigo (documento inteiro) e DIZ que caiu:
 * mais lento porém funcionando é melhor que lista vazia, que seria lida como
 * "não há empresas no Lucro" — mentira que manda procurar cadastro perdido.
 */
export const getEmpresasResumo = async (currentUser?: User | null): Promise<LucroResumoResposta> => {
    if (!currentUser) return { empresas: [], total: 0, ocultas: { excluidas: 0, fundidas: 0 } };
    try {
        const u = auth?.currentUser;
        if (!u) throw new Error('sem sessão');
        const token = await u.getIdToken();
        const res = await fetch('/api/admin/lucro/empresas-resumo', {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        return { empresas: data.empresas || [], total: data.total || 0, ocultas: data.ocultas || { excluidas: 0, fundidas: 0 } };
    } catch (e: any) {
        console.warn('[Lucro] resumo indisponível, caindo no caminho completo:', e?.message);
        const completas = await getEmpresas(currentUser);
        return {
            empresas: completas.map((e) => ({
                id: e.id,
                nome: (e as any).nome || (e as any).razaoSocial || null,
                cnpj: String((e as any).cnpj || '').replace(/\D/g, '') || null,
                uf: String((e as any).uf || '').toUpperCase() || null,
                regimePadrao: (e as any).regimePadrao || null,
                codCliente: String((e as any).codCliente ?? (e as any).dadosFiscais?.codCliente ?? '') || null,
                fichas: ((e as any).fichaFinanceira || []).length,
                capturarSefaz: (e as any).capturarSefaz !== false,
            })),
            total: completas.length,
            ocultas: { excluidas: 0, fundidas: 0 },
            degradado: 'A lista veio pelo caminho antigo (mais lento). A ficha financeira de todas as empresas foi baixada junto.',
        };
    }
};

/**
 * O documento COMPLETO de uma empresa — é o que o ⚡ Ativar busca.
 *
 * Uma leitura por id, sob demanda. É aqui que a ficha financeira chega, e só
 * da empresa que a pessoa abriu.
 */
export const getEmpresaCompleta = async (id: string): Promise<LucroPresumidoEmpresa | null> => {
    if (!isFirebaseConfigured || !db || !auth?.currentUser) {
        return getLocalEmpresas().find((e) => e.id === id) || null;
    }
    const snap = await getDoc(doc(db, 'lucro_empresas', id));
    if (!snap.exists()) return null;
    const d = snap.data() as any;
    if (d._deleted || d._merged_into) return null;
    return { id: snap.id, ...d } as LucroPresumidoEmpresa;
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

            // ═══════════════════════════════════════════════════════════════
            // 🔒 COMPETÊNCIA COM FIM DE MÊS DADO NÃO MUDA DE VALOR (26/08)
            //
            // Paulo: *"deve se expandir às fichas financeiras, com os devidos
            // valores apurados e fechados, para que não haja divergência em
            // valores apurados"*.
            //
            // Sem isto, a ficha de uma competência já entregue pode ser editada
            // e o número muda **em silêncio** — e o Contábil, no CCI, fica com
            // o valor que importou sem saber que ele mudou. É essa divergência
            // que o ato existe para matar.
            //
            // ⚠️ ESTA NÃO É A PROTEÇÃO PRINCIPAL, e dizer isso importa: o que
            // de fato garante o número é o CARIMBO, que guarda uma CÓPIA dos
            // apurados — editar a ficha não o altera. Esta trava é o aviso na
            // porta, para a pessoa não perder o trabalho digitando algo que
            // não vai valer.
            //
            // ⚠️ E a competência casa NORMALIZADA: `mesReferencia` aparece como
            // 'YYYY-MM', 'YYYY-MM-DD' e 'MM/YYYY' conforme a época do
            // lançamento, e `===` perderia a competência fechada em silêncio —
            // exatamente o descasamento que mordeu três vezes em 15/08.
            const comp = normalizarCompetencia(registro.mesReferencia);
            const idFech = idDoFechamento(empresaId, comp);
            if (comp && idFech) {
                const fechSnap = await getDoc(doc(db, COLECAO_FECHAMENTOS, idFech));
                const fech = fechSnap.exists() ? (fechSnap.data() as any) : null;
                // 'reaberta' é competência ABERTA de novo — travá-la impediria
                // justamente a correção que a reabertura veio permitir.
                if (fech?.estado === 'fechada') {
                    throw new Error(
                        `O fim de mês de ${comp} já foi dado`
                        + `${fech.fechadoPor?.email ? ` por ${fech.fechadoPor.email}` : ''}`
                        + ` e esses valores são a base que a contabilidade importa. `
                        + 'Para alterar, peça a um administrador que reabra a competência na Rotina do mês.',
                    );
                }
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
