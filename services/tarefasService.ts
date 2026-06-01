/**
 * tarefasService — gestao de tarefas/prazos por empresa.
 *
 * Doc na colecao `tarefas`:
 *   {
 *     titulo, descricao,
 *     empresaId, empresaCnpj, empresaNome,
 *     obrigacao: 'DAS'|'DCTFWEB'|'FGTS'|'SPED'|'OUTRA',
 *     competencia: "04/2026",
 *     vencimento: timestamp,
 *     status: 'a_fazer'|'em_andamento'|'concluida'|'cancelada',
 *     responsavel: uid|null,
 *     responsavelNome: string|null,
 *     origem: 'manual'|'automatica',
 *     criadoPor, criadoEm,
 *     concluidaEm, concluidaPor,
 *     ultimoEmailEm,
 *   }
 *
 * Unicidade: empresaId + obrigacao + competencia eh unico por tarefa
 * automatica. O cron mensal nunca cria duplicada.
 *
 * Regras Firestore: leitura/criacao/update pra qualquer signed-in;
 * delete soh admin.
 */
import {
    collection,
    addDoc,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    updateDoc,
    Timestamp,
    serverTimestamp,
    orderBy,
    limit as fbLimit,
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';
import { calcularVencimento, type Obrigacao, type RegraObrigacao } from './calendarioFiscal';
import { fetchAllDocs } from './firestorePaginate';

const COLLECTION = 'tarefas';
const COLLECTION_CARTEIRAS = 'carteiras';

export type StatusTarefa = 'a_fazer' | 'em_andamento' | 'concluida' | 'cancelada';
export type OrigemTarefa = 'manual' | 'automatica';
export type ObrigacaoTarefa = Obrigacao | 'OUTRA';

export interface Tarefa {
    id: string;
    titulo: string;
    descricao: string;
    empresaId: string;
    empresaCnpj: string;
    empresaNome: string;
    obrigacao: ObrigacaoTarefa;
    competencia: string;            // "04/2026"
    vencimento: Date;
    status: StatusTarefa;
    responsavel: string | null;     // uid
    responsavelNome: string | null;
    origem: OrigemTarefa;
    criadoPor: string;
    criadoEm: Date | null;
    concluidaEm: Date | null;
    concluidaPor: string | null;
    ultimoEmailEm: Date | null;
}

export interface NovaTarefaManual {
    titulo: string;
    descricao?: string;
    empresaId: string;
    empresaCnpj: string;
    empresaNome: string;
    obrigacao?: ObrigacaoTarefa;    // default OUTRA pra manual
    competencia?: string;            // default mes atual
    vencimento: Date;
    responsavel?: string | null;     // uid
    responsavelNome?: string | null;
}

export interface FiltrosTarefa {
    responsavel?: string | null;     // uid; 'null' = sem dono; undefined = todos
    empresaId?: string;
    status?: StatusTarefa | 'todas';
    obrigacao?: ObrigacaoTarefa;
    competencia?: string;
    apenasAtrasadas?: boolean;
}

// Helper: converte doc firestore -> Tarefa
function docToTarefa(id: string, data: any): Tarefa {
    return {
        id,
        titulo: data.titulo || '',
        descricao: data.descricao || '',
        empresaId: data.empresaId,
        empresaCnpj: data.empresaCnpj || '',
        empresaNome: data.empresaNome || '',
        obrigacao: data.obrigacao || 'OUTRA',
        competencia: data.competencia || '',
        vencimento: data.vencimento?.toDate?.() || new Date(0),
        status: data.status || 'a_fazer',
        responsavel: data.responsavel ?? null,
        responsavelNome: data.responsavelNome ?? null,
        origem: data.origem || 'manual',
        criadoPor: data.criadoPor || '',
        criadoEm: data.criadoEm?.toDate?.() || null,
        concluidaEm: data.concluidaEm?.toDate?.() || null,
        concluidaPor: data.concluidaPor ?? null,
        ultimoEmailEm: data.ultimoEmailEm?.toDate?.() || null,
    };
}

/**
 * Acha o titular (papel=principal) de uma empresa na Carteira.
 * Retorna { uid, nome } ou null se nao houver.
 */
export async function getTitularDaEmpresa(
    empresaId: string,
): Promise<{ uid: string; nome: string } | null> {
    if (!isFirebaseConfigured || !empresaId) return null;
    try {
        const snap = await getDocs(query(
            collection(db, COLLECTION_CARTEIRAS),
            where('empresaId', '==', empresaId),
            where('papel', '==', 'principal'),
            fbLimit(10),
        ));
        if (snap.empty) return null;
        const d = snap.docs[0].data();
        return { uid: d.colaboradorUid, nome: d.colaboradorNome || '' };
    } catch (e) {
        console.error('[tarefas] getTitular:', e);
        return null;
    }
}

/**
 * Lista tarefas com filtros.
 */
export async function listarTarefas(filtros: FiltrosTarefa = {}): Promise<Tarefa[]> {
    if (!isFirebaseConfigured) return [];
    try {
        // Firestore nao suporta muitos filtros 'where' compostos sem indice; faco
        // filtros simples na query e o resto em memoria.
        const constraints: any[] = [];
        if (filtros.empresaId) constraints.push(where('empresaId', '==', filtros.empresaId));
        if (filtros.competencia) constraints.push(where('competencia', '==', filtros.competencia));
        if (filtros.status && filtros.status !== 'todas') {
            constraints.push(where('status', '==', filtros.status));
        }
        if (filtros.obrigacao) constraints.push(where('obrigacao', '==', filtros.obrigacao));

        // Paginação via cursor (fetchAllDocs) substitui o antigo fbLimit(500)
        // que truncava a tela de Tarefas quando a base passava de 500 itens.
        const snaps = await fetchAllDocs(COLLECTION, constraints);
        let lista = snaps.map(d => docToTarefa(d.id, d.data()));

        // Filtros que ficam em memoria
        if (filtros.responsavel !== undefined) {
            lista = lista.filter(t => t.responsavel === filtros.responsavel);
        }
        if (filtros.apenasAtrasadas) {
            const hoje = new Date(); hoje.setHours(0,0,0,0);
            lista = lista.filter(t => t.status !== 'concluida' && t.vencimento < hoje);
        }

        // Ordena por vencimento (mais antigas primeiro)
        lista.sort((a, b) => a.vencimento.getTime() - b.vencimento.getTime());
        return lista;
    } catch (e) {
        console.error('[tarefas] listar:', e);
        return [];
    }
}

/**
 * Cria uma tarefa MANUAL.
 */
export async function criarTarefaManual(
    nova: NovaTarefaManual,
): Promise<{ ok: boolean; id?: string; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, error: 'Firebase nao configurado' };
    if (!nova.titulo?.trim()) return { ok: false, error: 'Titulo obrigatorio' };
    if (!nova.empresaId) return { ok: false, error: 'Empresa obrigatoria' };
    if (!nova.vencimento) return { ok: false, error: 'Vencimento obrigatorio' };

    try {
        // Se nao especificou responsavel, tenta auto-atribuir pelo titular
        let resp = nova.responsavel ?? null;
        let respNome = nova.responsavelNome ?? null;
        if (!resp) {
            const titular = await getTitularDaEmpresa(nova.empresaId);
            if (titular) {
                resp = titular.uid;
                respNome = titular.nome;
            }
        }

        const ref = await addDoc(collection(db, COLLECTION), {
            titulo: nova.titulo.trim(),
            descricao: nova.descricao?.trim() || '',
            empresaId: nova.empresaId,
            empresaCnpj: nova.empresaCnpj || '',
            empresaNome: nova.empresaNome || '',
            obrigacao: nova.obrigacao || 'OUTRA',
            competencia: nova.competencia || '',
            vencimento: Timestamp.fromDate(nova.vencimento),
            status: 'a_fazer' as StatusTarefa,
            responsavel: resp,
            responsavelNome: respNome,
            origem: 'manual' as OrigemTarefa,
            criadoPor: auth?.currentUser?.uid || '',
            criadoEm: serverTimestamp(),
            concluidaEm: null,
            concluidaPor: null,
            ultimoEmailEm: null,
        });
        return { ok: true, id: ref.id };
    } catch (e) {
        console.error('[tarefas] criarManual:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}

/**
 * Cria UMA tarefa automatica pra uma combinacao especifica.
 * Usado pelo cron mensal. Idempotente: se ja existe pra
 * (empresaId, obrigacao, competencia), retorna ok sem criar duplicata.
 */
export async function criarTarefaAutomatica(params: {
    empresaId: string;
    empresaCnpj: string;
    empresaNome: string;
    regra: RegraObrigacao;
    competencia: string;
}): Promise<{ ok: boolean; id?: string; jaExistia?: boolean; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, error: 'Firebase nao configurado' };

    try {
        // Check de duplicata
        const dup = await getDocs(query(
            collection(db, COLLECTION),
            where('empresaId', '==', params.empresaId),
            where('obrigacao', '==', params.regra.obrigacao),
            where('competencia', '==', params.competencia),
            fbLimit(1),
        ));
        if (!dup.empty) {
            return { ok: true, id: dup.docs[0].id, jaExistia: true };
        }

        const vencimento = calcularVencimento(params.competencia, params.regra);

        // Tenta auto-atribuir pelo titular
        const titular = await getTitularDaEmpresa(params.empresaId);

        const titulo = `${params.regra.label} ${params.competencia}`;

        const ref = await addDoc(collection(db, COLLECTION), {
            titulo,
            descricao: '',
            empresaId: params.empresaId,
            empresaCnpj: params.empresaCnpj,
            empresaNome: params.empresaNome,
            obrigacao: params.regra.obrigacao,
            competencia: params.competencia,
            vencimento: Timestamp.fromDate(vencimento),
            status: 'a_fazer' as StatusTarefa,
            responsavel: titular?.uid ?? null,
            responsavelNome: titular?.nome ?? null,
            origem: 'automatica' as OrigemTarefa,
            criadoPor: 'sistema',
            criadoEm: serverTimestamp(),
            concluidaEm: null,
            concluidaPor: null,
            ultimoEmailEm: null,
        });
        return { ok: true, id: ref.id, jaExistia: false };
    } catch (e) {
        console.error('[tarefas] criarAutomatica:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}

/**
 * Marca tarefa como concluida (manualmente).
 */
export async function marcarConcluida(
    tarefaId: string,
): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, error: 'Firebase nao configurado' };
    try {
        await updateDoc(doc(db, COLLECTION, tarefaId), {
            status: 'concluida',
            concluidaEm: serverTimestamp(),
            concluidaPor: auth?.currentUser?.uid || '',
        });
        return { ok: true };
    } catch (e) {
        console.error('[tarefas] marcarConcluida:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}

/**
 * Marca tarefa como concluida automaticamente pelo sistema.
 * Usado quando o SERPRO transmite DAS/DCTFWeb.
 * Acha pela combinacao empresaId+obrigacao+competencia.
 */
export async function marcarConcluidaPorSistema(params: {
    empresaId: string;
    obrigacao: ObrigacaoTarefa;
    competencia: string;
}): Promise<{ ok: boolean; encontradas: number; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, encontradas: 0, error: 'Firebase nao configurado' };
    try {
        const snap = await getDocs(query(
            collection(db, COLLECTION),
            where('empresaId', '==', params.empresaId),
            where('obrigacao', '==', params.obrigacao),
            where('competencia', '==', params.competencia),
            fbLimit(10),
        ));
        let n = 0;
        for (const d of snap.docs) {
            const data = d.data();
            if (data.status !== 'concluida') {
                await updateDoc(d.ref, {
                    status: 'concluida',
                    concluidaEm: serverTimestamp(),
                    concluidaPor: 'sistema',
                });
                n++;
            }
        }
        return { ok: true, encontradas: n };
    } catch (e) {
        console.error('[tarefas] marcarConcluidaPorSistema:', e);
        return { ok: false, encontradas: 0, error: e instanceof Error ? e.message : 'erro' };
    }
}

/**
 * Reatribui tarefa pra outro responsavel.
 */
export async function reatribuir(
    tarefaId: string,
    novoUid: string | null,
    novoNome: string | null,
): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, error: 'Firebase nao configurado' };
    try {
        await updateDoc(doc(db, COLLECTION, tarefaId), {
            responsavel: novoUid,
            responsavelNome: novoNome,
        });
        return { ok: true };
    } catch (e) {
        console.error('[tarefas] reatribuir:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}

/**
 * Atualiza status (ex: marcar 'em_andamento').
 */
export async function atualizarStatus(
    tarefaId: string,
    novoStatus: StatusTarefa,
): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, error: 'Firebase nao configurado' };
    try {
        const patch: any = { status: novoStatus };
        if (novoStatus === 'concluida') {
            patch.concluidaEm = serverTimestamp();
            patch.concluidaPor = auth?.currentUser?.uid || '';
        }
        await updateDoc(doc(db, COLLECTION, tarefaId), patch);
        return { ok: true };
    } catch (e) {
        console.error('[tarefas] atualizarStatus:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}

/**
 * Remove tarefa. Soh admin via Firestore rules.
 */
export async function removerTarefa(
    tarefaId: string,
): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, error: 'Firebase nao configurado' };
    try {
        await deleteDoc(doc(db, COLLECTION, tarefaId));
        return { ok: true };
    } catch (e) {
        console.error('[tarefas] remover:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}

/**
 * Acha tarefas atrasadas (vencimento < hoje, status != concluida).
 * Usado pelo cron de notificacao.
 */
export async function listarAtrasadas(): Promise<Tarefa[]> {
    return listarTarefas({ apenasAtrasadas: true });
}
