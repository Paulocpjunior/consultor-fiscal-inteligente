/**
 * xmlFiscalService.ts
 * Operações de alto nível da Central de Documentos Fiscais.
 *
 * - Importação manual end-to-end (parse + storage + firestore + log).
 * - Listagem com filtros respeitando perfil (admin vs colaborador).
 * - Logs de captura e registro de erros.
 */

import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit as fbLimit,
    type QueryConstraint,
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured, isFirebaseStorageConfigured } from './firebaseConfig';
import {
    parseNFeXml,
    matchCompanyAndDirection,
    buildDocumentoFiscal,
    sha256Hex,
    XmlParseError,
} from './xmlParserService';
import { uploadXml, deleteXml } from './xmlStorageService';
import type {
    DocumentoFiscal,
    XmlCaptura,
    XmlErro,
    XmlOrigem,
    User,
    SimplesNacionalEmpresa,
    LucroPresumidoEmpresa,
} from '../types';

// ─── Constantes ─────────────────────────────────────────────────────────────

const MASTER_ADMIN_EMAIL = 'junior@spassessoriacontabil.com.br';
const COLLECTIONS = {
    DOCUMENTOS: 'documentos_fiscais',
    CAPTURAS: 'xml_capturas',
    ERROS: 'xml_erros',
    EMPRESAS_XML: 'empresas_xml_config',
} as const;

const sanitize = (obj: any) => JSON.parse(JSON.stringify(obj, (_k, v) => v === undefined ? null : v));

const isMasterUser = (user: User | null | undefined): boolean =>
    !!user && (user.role === 'admin' ||
        user.email?.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase());

// ─── Erros tipados ──────────────────────────────────────────────────────────

export class DocumentoDuplicadoError extends Error {
    chave: string;
    existingId: string;
    constructor(chave: string, existingId: string) {
        super(`Documento já importado (chave ${chave}).`);
        this.name = 'DocumentoDuplicadoError';
        this.chave = chave;
        this.existingId = existingId;
    }
}

export { XmlParseError };

// ─── Empresas (helper para a UI escolher a qual atribuir) ───────────────────

/**
 * União de empresas de Simples + Lucro disponíveis para o usuário.
 * Reaproveita o cadastro existente — não cria coleção nova.
 */
export interface EmpresaXmlOption {
    id: string;
    nome: string;
    cnpj: string;
    fonte: 'simples' | 'lucro';
    createdBy?: string;
}

function dedupEmpresas(list: EmpresaXmlOption[]): EmpresaXmlOption[] {
    const map = new Map<string, EmpresaXmlOption>();
    list.forEach(e => {
        const key = (e.cnpj || '').replace(/\D/g, '') || e.id;
        if (!map.has(key)) map.set(key, e);
    });
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
}

/** Fallback para empresas em localStorage (modo offline dos modulos Simples/Lucro). */
function getEmpresasFromLocalStorage(user: User): EmpresaXmlOption[] {
    const isMaster = isMasterUser(user);
    const out: EmpresaXmlOption[] = [];
    try {
        const simples: SimplesNacionalEmpresa[] = JSON.parse(localStorage.getItem('simples_nacional_empresas') || '[]');
        simples.forEach(e => {
            if (isMaster || !e.createdBy || e.createdBy === user.id) {
                out.push({ id: e.id, nome: e.nome, cnpj: e.cnpj, fonte: 'simples', createdBy: e.createdBy });
            }
        });
    } catch { /* silent */ }
    try {
        const lucro: LucroPresumidoEmpresa[] = JSON.parse(localStorage.getItem('lucro_presumido_empresas') || '[]');
        lucro.forEach(e => {
            if (isMaster || !e.createdBy || e.createdBy === user.id) {
                out.push({ id: e.id, nome: e.nome, cnpj: e.cnpj, fonte: 'lucro', createdBy: e.createdBy });
            }
        });
    } catch { /* silent */ }
    return out;
}

export async function getEmpresasDisponiveis(user: User | null): Promise<EmpresaXmlOption[]> {
    if (!user) return [];
    const isMaster = isMasterUser(user);
    const uid = auth?.currentUser?.uid;

    const cloudResults: EmpresaXmlOption[] = [];

    if (isFirebaseConfigured && db) {
        const buildQuery = (): QueryConstraint[] =>
            (isMaster || !uid) ? [] : [where('createdBy', '==', uid)];

        // Cada coleção tem seu try/catch separado: se uma falhar (sem
        // permissão nas Rules atuais, por exemplo), a outra ainda pode ser lida.
        try {
            const simplesSnap = await getDocs(query(collection(db, 'simples_empresas'), ...buildQuery()));
            simplesSnap.docs.forEach(d => {
                const data = d.data() as SimplesNacionalEmpresa;
                cloudResults.push({ id: d.id, nome: data.nome, cnpj: data.cnpj, fonte: 'simples', createdBy: data.createdBy });
            });
        } catch (err: any) {
            if (err?.code !== 'permission-denied') {
                console.warn('getEmpresasDisponiveis simples:', err?.message);
            }
        }

        try {
            const lucroSnap = await getDocs(query(collection(db, 'lucro_empresas'), ...buildQuery()));
            lucroSnap.docs.forEach(d => {
                const data = d.data() as LucroPresumidoEmpresa;
                cloudResults.push({ id: d.id, nome: data.nome, cnpj: data.cnpj, fonte: 'lucro', createdBy: data.createdBy });
            });
        } catch (err: any) {
            if (err?.code !== 'permission-denied') {
                console.warn('getEmpresasDisponiveis lucro:', err?.message);
            }
        }
    }

    // Fallback localStorage: indispensavel enquanto as rules nao cobrirem
    // simples_empresas e lucro_empresas. dedupEmpresas remove repeticoes
    // por CNPJ entre cloud e local.
    const localResults = getEmpresasFromLocalStorage(user);

    return dedupEmpresas([...cloudResults, ...localResults]);
}

// ─── Importação manual (entry point principal) ──────────────────────────────

export interface ImportXmlInput {
    file: File;
    empresa: { id: string; nome: string; cnpj: string };
    user: User;
    origem?: XmlOrigem;
}

export interface ImportXmlSuccess {
    status: 'ok';
    documento: DocumentoFiscal;
}

export interface ImportXmlSkipped {
    status: 'duplicado';
    existingId: string;
    chave: string;
}

export type ImportXmlResult = ImportXmlSuccess | ImportXmlSkipped;

/**
 * Importação manual ponta-a-ponta:
 *  1. Lê o arquivo (FileReader).
 *  2. Faz parse via xmlParserService.
 *  3. Valida CNPJ da empresa selecionada (emitente ou destinatário).
 *  4. Calcula hash SHA-256 do XML.
 *  5. Verifica duplicidade pela chave da NF-e.
 *  6. Sobe o XML original para o Firebase Storage.
 *  7. Grava metadados em documentos_fiscais.
 *  8. Registra log em xml_capturas.
 *  9. Em caso de erro, registra em xml_erros e propaga a exceção.
 */
export async function importXmlManual(input: ImportXmlInput): Promise<ImportXmlResult> {
    if (!isFirebaseConfigured || !db) {
        throw new Error('Firebase não está configurado.');
    }
    if (!isFirebaseStorageConfigured) {
        throw new Error('Firebase Storage não está configurado. Configure VITE_FIREBASE_STORAGE_BUCKET.');
    }

    const { file, empresa, user, origem = 'manual' } = input;
    const fileName = file.name;
    let chave = '';

    try {
        const xmlText = await file.text();
        const parsed = parseNFeXml(xmlText);
        chave = parsed.chave;

        const match = matchCompanyAndDirection(parsed, empresa.cnpj);
        if (!match.ok) {
            throw new Error(match.motivo || 'XML não pertence à empresa selecionada.');
        }

        const xmlHash = await sha256Hex(xmlText);

        // Duplicidade — id determinístico pela chave.
        const docId = chave || xmlHash;
        const existing = await getDoc(doc(db, COLLECTIONS.DOCUMENTOS, docId));
        if (existing.exists()) {
            await registrarCaptura({
                chave,
                empresaId: empresa.id,
                origem,
                status: 'duplicado',
                fileName,
                tamanhoBytes: file.size,
                user,
                mensagem: 'Documento já importado anteriormente.',
                documentoId: docId,
            });
            return { status: 'duplicado', existingId: docId, chave };
        }

        const upload = await uploadXml(empresa.id, chave, xmlText, fileName);

        const documento = buildDocumentoFiscal({
            id: docId,
            parsed,
            xmlHash,
            direcao: match.direcao,
            empresaId: empresa.id,
            empresaCnpj: empresa.cnpj,
            empresaNome: empresa.nome,
            origem,
            importadoPor: user.id,
            importadoPorEmail: user.email,
            fileName,
            tamanhoBytes: file.size,
            storagePath: upload.storagePath,
            storageUrl: upload.storageUrl,
        });

        try {
            await setDoc(doc(db, COLLECTIONS.DOCUMENTOS, docId), sanitize(documento));
        } catch (err) {
            // Rollback do storage se o Firestore falhar para não deixar lixo.
            await deleteXml(upload.storagePath).catch(() => {});
            throw err;
        }

        await registrarCaptura({
            chave,
            empresaId: empresa.id,
            origem,
            status: 'sucesso',
            fileName,
            tamanhoBytes: file.size,
            user,
            documentoId: docId,
        });

        return { status: 'ok', documento };
    } catch (err: any) {
        await registrarErro({
            fileName,
            chave,
            empresaId: empresa?.id,
            origem,
            user,
            mensagem: err?.message || 'Falha desconhecida na importação.',
            detalhe: err?.stack,
        });
        throw err;
    }
}

// ─── Logs e erros ───────────────────────────────────────────────────────────

interface CapturaInput {
    documentoId?: string;
    chave?: string;
    empresaId?: string;
    origem: XmlOrigem;
    status: XmlCaptura['status'];
    mensagem?: string;
    fileName?: string;
    tamanhoBytes?: number;
    user: User;
}

export async function registrarCaptura(input: CapturaInput): Promise<void> {
    if (!isFirebaseConfigured || !db) return;
    const payload: Omit<XmlCaptura, 'id'> = {
        documentoId: input.documentoId,
        chave: input.chave,
        empresaId: input.empresaId,
        origem: input.origem,
        status: input.status,
        mensagem: input.mensagem,
        fileName: input.fileName,
        tamanhoBytes: input.tamanhoBytes,
        usuarioId: input.user.id,
        usuarioNome: input.user.name,
        usuarioEmail: input.user.email,
        timestamp: Date.now(),
    };
    try {
        await addDoc(collection(db, COLLECTIONS.CAPTURAS), sanitize(payload));
    } catch (err) {
        console.warn('registrarCaptura:', err);
    }
}

interface ErroInput {
    fileName?: string;
    chave?: string;
    empresaId?: string;
    origem: XmlOrigem;
    user: User;
    mensagem: string;
    detalhe?: string;
}

export async function registrarErro(input: ErroInput): Promise<void> {
    if (!isFirebaseConfigured || !db) return;
    const payload: Omit<XmlErro, 'id'> = {
        fileName: input.fileName,
        chave: input.chave,
        empresaId: input.empresaId,
        origem: input.origem,
        usuarioId: input.user.id,
        usuarioEmail: input.user.email,
        mensagem: input.mensagem,
        detalhe: input.detalhe,
        timestamp: Date.now(),
        resolvido: false,
    };
    try {
        await addDoc(collection(db, COLLECTIONS.ERROS), sanitize(payload));
    } catch (err) {
        console.warn('registrarErro:', err);
    }
}

// ─── Listagens ──────────────────────────────────────────────────────────────

export interface ListDocumentosFilters {
    empresaId?: string;
    direcao?: 'entrada' | 'saida';
    competencia?: string;        // YYYY-MM
    competenciaInicio?: string;
    competenciaFim?: string;
    status?: DocumentoFiscal['status'];
    origem?: XmlOrigem;
    busca?: string;              // numero / chave / emitente / destinatario
}

/**
 * Lista documentos fiscais respeitando perfil:
 *   - admin: vê tudo (com filtros aplicados);
 *   - colaborador: somente os que ele importou (createdBy = uid).
 *
 * Como o Firestore tem restrições para combinar where com orderBy,
 * fazemos uma query mínima e filtramos o restante em memória.
 */
export async function listDocumentos(
    user: User | null,
    filters: ListDocumentosFilters = {},
): Promise<DocumentoFiscal[]> {
    if (!user || !isFirebaseConfigured || !db) return [];
    const isMaster = isMasterUser(user);
    const uid = auth?.currentUser?.uid;

    const constraints: QueryConstraint[] = [];
    if (!isMaster && uid) constraints.push(where('createdBy', '==', uid));
    if (filters.empresaId) constraints.push(where('empresaId', '==', filters.empresaId));
    constraints.push(orderBy('importadoEm', 'desc'));
    constraints.push(fbLimit(500));

    let docs: DocumentoFiscal[] = [];
    try {
        const snap = await getDocs(query(collection(db, COLLECTIONS.DOCUMENTOS), ...constraints));
        docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as DocumentoFiscal));
    } catch (err: any) {
        console.warn('listDocumentos:', err?.message);
        return [];
    }

    return docs.filter(d => {
        if (filters.direcao && d.direcao !== filters.direcao) return false;
        if (filters.status && d.status !== filters.status) return false;
        if (filters.origem && d.origem !== filters.origem) return false;
        if (filters.competencia && d.competencia !== filters.competencia) return false;
        if (filters.competenciaInicio && d.competencia < filters.competenciaInicio) return false;
        if (filters.competenciaFim && d.competencia > filters.competenciaFim) return false;
        if (filters.busca) {
            const term = filters.busca.toLowerCase();
            const blob = `${d.numero} ${d.chave} ${d.emitente.nome} ${d.destinatario.nome} ${d.empresaNome}`.toLowerCase();
            if (!blob.includes(term)) return false;
        }
        return true;
    });
}

export async function getDocumento(id: string): Promise<DocumentoFiscal | null> {
    if (!isFirebaseConfigured || !db) return null;
    const snap = await getDoc(doc(db, COLLECTIONS.DOCUMENTOS, id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as any) } as DocumentoFiscal;
}

export async function listCapturas(user: User | null, max = 200): Promise<XmlCaptura[]> {
    if (!user || !isFirebaseConfigured || !db) return [];
    const isMaster = isMasterUser(user);
    const uid = auth?.currentUser?.uid;
    const constraints: QueryConstraint[] = [];
    if (!isMaster && uid) constraints.push(where('usuarioId', '==', user.id));
    constraints.push(orderBy('timestamp', 'desc'));
    constraints.push(fbLimit(max));
    try {
        const snap = await getDocs(query(collection(db, COLLECTIONS.CAPTURAS), ...constraints));
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as XmlCaptura));
    } catch (err: any) {
        console.warn('listCapturas:', err?.message);
        return [];
    }
}

export async function listErros(user: User | null, max = 200): Promise<XmlErro[]> {
    if (!user || !isFirebaseConfigured || !db) return [];
    const isMaster = isMasterUser(user);
    const constraints: QueryConstraint[] = [];
    if (!isMaster) constraints.push(where('usuarioId', '==', user.id));
    constraints.push(orderBy('timestamp', 'desc'));
    constraints.push(fbLimit(max));
    try {
        const snap = await getDocs(query(collection(db, COLLECTIONS.ERROS), ...constraints));
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as XmlErro));
    } catch (err: any) {
        console.warn('listErros:', err?.message);
        return [];
    }
}

export async function deleteDocumento(id: string): Promise<void> {
    if (!isFirebaseConfigured || !db) return;
    const existing = await getDocumento(id);
    if (!existing) return;
    if (existing.storagePath) {
        await deleteXml(existing.storagePath).catch(() => {});
    }
    await deleteDoc(doc(db, COLLECTIONS.DOCUMENTOS, id));
}

// ─── Agregações para Dashboard / Relatórios ─────────────────────────────────

export interface DashboardSummary {
    total: number;
    entradas: number;
    saidas: number;
    valorTotal: number;
    valorEntradas: number;
    valorSaidas: number;
    porCompetencia: Record<string, { entradas: number; saidas: number; valorEntradas: number; valorSaidas: number }>;
    porEmpresa: Record<string, { nome: string; total: number; valorTotal: number }>;
    porStatus: Record<string, number>;
    cfops: Record<string, { quantidade: number; valor: number }>;
    ncms: Record<string, { quantidade: number; valor: number }>;
    duplicados: number;
}

export function summarize(docs: DocumentoFiscal[]): DashboardSummary {
    const out: DashboardSummary = {
        total: docs.length,
        entradas: 0,
        saidas: 0,
        valorTotal: 0,
        valorEntradas: 0,
        valorSaidas: 0,
        porCompetencia: {},
        porEmpresa: {},
        porStatus: {},
        cfops: {},
        ncms: {},
        duplicados: 0,
    };

    const seenChaves = new Set<string>();
    for (const d of docs) {
        const valor = d.totais?.vNF || 0;
        out.valorTotal += valor;
        if (d.direcao === 'entrada') { out.entradas++; out.valorEntradas += valor; }
        else if (d.direcao === 'saida') { out.saidas++; out.valorSaidas += valor; }

        if (d.chave) {
            if (seenChaves.has(d.chave)) out.duplicados++;
            else seenChaves.add(d.chave);
        }

        const comp = d.competencia || 'sem-competencia';
        const c = out.porCompetencia[comp] ||= { entradas: 0, saidas: 0, valorEntradas: 0, valorSaidas: 0 };
        if (d.direcao === 'entrada') { c.entradas++; c.valorEntradas += valor; }
        else if (d.direcao === 'saida') { c.saidas++; c.valorSaidas += valor; }

        const e = out.porEmpresa[d.empresaId] ||= { nome: d.empresaNome, total: 0, valorTotal: 0 };
        e.total++;
        e.valorTotal += valor;

        out.porStatus[d.status] = (out.porStatus[d.status] || 0) + 1;

        for (const it of d.itens || []) {
            if (it.cfop) {
                const cf = out.cfops[it.cfop] ||= { quantidade: 0, valor: 0 };
                cf.quantidade++;
                cf.valor += it.vProd || 0;
            }
            if (it.ncm) {
                const nc = out.ncms[it.ncm] ||= { quantidade: 0, valor: 0 };
                nc.quantidade++;
                nc.valor += it.vProd || 0;
            }
        }
    }

    return out;
}

export const xmlCollections = COLLECTIONS;
