/**
 * legalizacaoService.ts — I/O do módulo Legalização.
 *
 * Coleções:
 *   legalizacao_vencimentos — espelho dos formulários Jotform (certidões,
 *     certificados digitais, parcelamentos). SÓ o backend escreve (sync);
 *     aqui apenas leitura.
 *   legalizacao_processos — processos do departamento (abertura, alteração,
 *     encerramento, contrato, procuração, regularização...). CRUD do
 *     colaborador; exclusão só admin (rules).
 *
 * Backend: /api/admin/legalizacao (status, resumo, cron-now).
 */
import {
    collection,
    addDoc,
    deleteDoc,
    doc,
    updateDoc,
    serverTimestamp,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db, isFirebaseConfigured } from './firebaseConfig';
import { fetchAllDocs } from './firestorePaginate';
import { sanitizeForFirestore } from './firestoreSanitize';
import type { CategoriaVencimento, StatusProcesso, TipoProcesso } from './legalizacaoLogic';

const COL_VENCIMENTOS = 'legalizacao_vencimentos';
const COL_PROCESSOS = 'legalizacao_processos';

const API_BASE = '/api/admin/legalizacao';

export interface VencimentoLegalizacao {
    id: string;
    origem: 'jotform' | 'processo';
    categoria: CategoriaVencimento;
    tipoDetalhe: string | null;
    empresaNome: string;
    empresaNumero?: string | null;
    cnpj: string | null;
    emailCliente: string | null;
    dataEmissao?: string | null;      // "YYYY-MM-DD"
    dataVencimento: string | null;    // "YYYY-MM-DD"
    numeroProcesso?: string | null;
    numeroParcelas?: string | null;
    valorParcela?: string | null;
    responsavel?: string | null;
    observacao?: string | null;
}

export interface ProcessoLegalizacao {
    id: string;
    tipo: TipoProcesso;
    status: StatusProcesso;
    titulo: string;
    descricao?: string | null;
    empresaNome: string;
    cnpj?: string | null;
    emailCliente?: string | null;
    /** "YYYY-MM-DD" — preenchido = entra na análise de vencimentos/alertas (ex.: procuração). */
    dataVencimento?: string | null;
    responsavelNome?: string | null;
    criadoPor?: string | null;
    criadoEm?: Date | null;
    atualizadoEm?: Date | null;
}

export interface NovoProcesso {
    tipo: TipoProcesso;
    titulo: string;
    empresaNome: string;
    descricao?: string;
    cnpj?: string;
    emailCliente?: string;
    dataVencimento?: string;
    responsavelNome?: string;
}

export async function listarVencimentos(): Promise<VencimentoLegalizacao[]> {
    if (!isFirebaseConfigured || !db) return [];
    const docs = await fetchAllDocs(COL_VENCIMENTOS);
    return docs.map(d => ({ id: d.id, ...d.data() } as VencimentoLegalizacao));
}

export async function listarProcessos(): Promise<ProcessoLegalizacao[]> {
    if (!isFirebaseConfigured || !db) return [];
    const docs = await fetchAllDocs(COL_PROCESSOS);
    return docs.map(d => {
        const data = d.data();
        return {
            id: d.id,
            ...data,
            criadoEm: data.criadoEm?.toDate?.() ?? null,
            atualizadoEm: data.atualizadoEm?.toDate?.() ?? null,
        } as ProcessoLegalizacao;
    });
}

export async function criarProcesso(input: NovoProcesso): Promise<string> {
    if (!db) throw new Error('Firebase não configurado');
    const u = getAuth().currentUser;
    const ref = await addDoc(collection(db, COL_PROCESSOS), sanitizeForFirestore({
        ...input,
        status: 'solicitado' as StatusProcesso,
        criadoPor: u?.uid ?? null,
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
    }));
    return ref.id;
}

export async function atualizarProcesso(id: string, patch: Partial<Omit<ProcessoLegalizacao, 'id'>>): Promise<void> {
    if (!db) throw new Error('Firebase não configurado');
    await updateDoc(doc(db, COL_PROCESSOS, id), sanitizeForFirestore({
        ...patch,
        atualizadoEm: serverTimestamp(),
    }) as Record<string, unknown>);
}

export async function removerProcesso(id: string): Promise<void> {
    if (!db) throw new Error('Firebase não configurado');
    await deleteDoc(doc(db, COL_PROCESSOS, id));
}

// ─── Backend ────────────────────────────────────────────────────────────────

async function authHeaders(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada — faça login novamente');
    return { Authorization: `Bearer ${await u.getIdToken()}`, 'Content-Type': 'application/json' };
}

export interface StatusLegalizacao {
    jotformConfigured: boolean;
    graphConfigured: boolean;
    forms: { certidoesCertificados: string; parcelamentos: string };
}

export interface ResumoLegalizacao {
    totalItens: number;
    farol: Record<string, { total: number; vencido: number; critico: number; atencao: number; ok: number; sem_data: number }>;
    proximos: Array<{
        id: string; categoria: string; tipoDetalhe: string | null; empresaNome: string;
        cnpj: string | null; dataVencimento: string; dataVencimentoFmt: string;
        diasRestantes: number; nivel: string;
    }>;
    jotformConfigured: boolean;
    graphConfigured: boolean;
    ultimaSync: { em: string | null; gravados: number | null; erros: string[]; ok: boolean } | null;
    ultimoCron: { em: string | null; ok: boolean; motivoDominante: string | null; emailsEnviados: number; falhasEmail: number } | null;
}

export async function getStatusLegalizacao(): Promise<StatusLegalizacao> {
    const res = await fetch(`${API_BASE}/status`, { headers: await authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export async function getResumoLegalizacao(): Promise<ResumoLegalizacao> {
    const res = await fetch(`${API_BASE}/resumo`, { headers: await authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/** Dispara sync Jotform + alertas em background (admin). */
export async function dispararCronAgora(force = false): Promise<{ ok: boolean; motivo?: string }> {
    const res = await fetch(`${API_BASE}/cron-now`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ force }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, motivo: data.error || `HTTP ${res.status}` };
    return data;
}
