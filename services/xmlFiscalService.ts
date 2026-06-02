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
import { fetchAllDocs } from './firestorePaginate';
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
    uf?: string;
    municipio?: string;
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

export async function getEmpresasDisponiveis(user: User | null): Promise<EmpresaXmlOption[]> {
    if (!user || !isFirebaseConfigured || !db) return [];
    const isMaster = isMasterUser(user);
    const uid = auth?.currentUser?.uid;

    const buildConstraints = (): QueryConstraint[] =>
        (!isMaster && uid) ? [where('createdBy', '==', uid)] : [];

    try {
        const [simplesSnap, lucroSnap] = await Promise.all([
            fetchAllDocs('simples_empresas', buildConstraints()),
            fetchAllDocs('lucro_empresas', buildConstraints()),
        ]);

        // 23/05: filtra perdedores do merge de duplicatas
        const simples: EmpresaXmlOption[] = simplesSnap
            .filter(d => !(d.data() as any)._merged_into)
            .map(d => {
            const data = d.data() as SimplesNacionalEmpresa;
            return { id: d.id, nome: data.nome, cnpj: data.cnpj, fonte: 'simples', uf: data.dadosFiscais?.uf, municipio: (data as any).municipio || undefined, createdBy: data.createdBy };
        });
        const lucro: EmpresaXmlOption[] = lucroSnap
            .filter(d => !(d.data() as any)._merged_into)
            .map(d => {
            const data = d.data() as LucroPresumidoEmpresa;
            return { id: d.id, nome: data.nome, cnpj: data.cnpj, fonte: 'lucro', uf: data.dadosFiscais?.uf, municipio: (data as any).municipio || undefined, createdBy: data.createdBy };
        });

        return dedupEmpresas([...simples, ...lucro]);
    } catch (err: any) {
        console.warn('getEmpresasDisponiveis:', err?.message);
        return [];
    }
}

// ─── Perfil do Cliente (Análise de Créditos) ──────────────────────────────

export type RegimeSugerido =
    | 'LUCRO_REAL_INDUSTRIA'
    | 'LUCRO_REAL_SERVICOS'
    | 'LUCRO_REAL_COMERCIO'
    | 'LUCRO_PRESUMIDO'
    | 'SIMPLES';

export interface EmpresaPerfilOption {
    id: string;
    nome: string;
    cnpj: string;
    fonte: 'simples' | 'lucro';
    regimeSugerido: RegimeSugerido;
    uf?: string;
    inscricaoEstadual?: string;
    ccmSp?: string;
    createdBy?: string;
}

function inferirRegimeLucro(data: LucroPresumidoEmpresa): RegimeSugerido {
    if (data.regimePadrao === 'Real') {
        const t = data.tiposAtividade;
        if (t?.industria) return 'LUCRO_REAL_INDUSTRIA';
        if (t?.servico)   return 'LUCRO_REAL_SERVICOS';
        if (t?.comercio)  return 'LUCRO_REAL_COMERCIO';
        return 'LUCRO_REAL_SERVICOS';
    }
    return 'LUCRO_PRESUMIDO';
}

function dedupPerfilOptions(list: EmpresaPerfilOption[]): EmpresaPerfilOption[] {
    const map = new Map<string, EmpresaPerfilOption>();
    list.forEach(e => {
        const key = (e.cnpj || '').replace(/\D/g, '') || e.id;
        if (!map.has(key)) map.set(key, e);
    });
    return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
}

export async function getEmpresasParaPerfilCliente(user: User | null): Promise<EmpresaPerfilOption[]> {
    if (!user || !isFirebaseConfigured || !db) return [];

    // Seletor de empresa da Analise de Creditos / Carteira: TODOS os
    // usuarios logados veem TODAS as empresas (sem filtro por createdBy).
    // O Firestore ja garante isso com `allow list: if isSignedIn()`.
    try {
        const [simplesSnap, lucroSnap] = await Promise.all([
            fetchAllDocs('simples_empresas'),
            fetchAllDocs('lucro_empresas'),
        ]);

        // 23/05: filtra perdedores do merge de duplicatas
        const simples: EmpresaPerfilOption[] = simplesSnap
            .filter(d => !(d.data() as any)._merged_into)
            .map(d => {
            const data = d.data() as SimplesNacionalEmpresa;
            return {
                id: d.id,
                nome: data.nome,
                cnpj: data.cnpj,
                fonte: 'simples' as const,
                regimeSugerido: 'SIMPLES' as RegimeSugerido,
                uf: data.dadosFiscais?.uf,
                inscricaoEstadual: data.dadosFiscais?.inscricaoEstadual,
                ccmSp: data.ccmSp,
                createdBy: data.createdBy,
            };
        });
        const lucro: EmpresaPerfilOption[] = lucroSnap
            .filter(d => !(d.data() as any)._merged_into)
            .map(d => {
            const data = d.data() as LucroPresumidoEmpresa;
            return {
                id: d.id,
                nome: data.nome,
                cnpj: data.cnpj,
                fonte: 'lucro' as const,
                regimeSugerido: inferirRegimeLucro(data),
                uf: data.dadosFiscais?.uf,
                inscricaoEstadual: data.dadosFiscais?.inscricaoEstadual,
                ccmSp: data.ccmSp,
                createdBy: data.createdBy,
            };
        });

        return dedupPerfilOptions([...simples, ...lucro]);
    } catch (err: any) {
        console.warn('getEmpresasParaPerfilCliente:', err?.message);
        return [];
    }
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

        // Para colaboradores nao-admin, regras Firestore retornam permission-denied
        // ao ler doc inexistente (comportamento padrao do Firestore para evitar
        // enumeracao). Tratamos esse caso como 'doc nao existe' e seguimos o
        // fluxo de criacao. Se for de fato uma duplicacao de OUTRO usuario,
        // o setDoc abaixo vai falhar tambem e o rollback de storage cuida do lixo.
        let existing: Awaited<ReturnType<typeof getDoc>> | null = null;
        try {
            existing = await getDoc(doc(db, COLLECTIONS.DOCUMENTOS, docId));
        } catch (err: any) {
            if (err?.code !== 'permission-denied') throw err;
            // permission-denied: doc nao existe OU pertence a outro usuario.
            // Continua como se fosse novo.
        }
        if (existing && existing.exists()) {
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
            importadoPor: auth?.currentUser?.uid ?? user.id,
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
        usuarioId: auth?.currentUser?.uid ?? input.user.id,
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
        usuarioId: auth?.currentUser?.uid ?? input.user.id,
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
    // NÃO usamos orderBy aqui: Firestore exclui docs que não têm o campo.
    // Ordenação fica em memória com fallbacks (ver abaixo).
    // Paginação via cursor (fetchAllDocs) substitui o antigo fbLimit(500) que
    // truncava o dashboard silenciosamente quando a base passava de 500 XMLs.

    let docs: DocumentoFiscal[] = [];
    try {
        const snaps = await fetchAllDocs(COLLECTIONS.DOCUMENTOS, constraints);
        docs = snaps.map(d => ({ id: d.id, ...(d.data() as any) } as DocumentoFiscal));
    } catch (err: any) {
        console.warn('listDocumentos:', err?.message);
        return [];
    }

    // Ordena em memória com cascata de fallbacks (importadoEm → createdAt → dhEmi → competencia → numero)
    const tsOf = (d: any): number => {
        const candidates = [d.importadoEm, d.createdAt, d.dhEmi, d.dataImportacao];
        for (const c of candidates) {
            if (!c) continue;
            if (typeof c === 'number') return c;
            if (typeof c === 'string') { const t = new Date(c).getTime(); if (!isNaN(t)) return t; }
            if (c?.seconds) return c.seconds * 1000;
            if (c?.toMillis) return c.toMillis();
        }
        return 0;
    };
    docs.sort((a, b) => tsOf(b) - tsOf(a));

    return docs.filter(d => {
        if (filters.direcao && d.direcao !== filters.direcao) return false;
        if (filters.status && d.status !== filters.status) return false;
        if (filters.origem && d.origem !== filters.origem) return false;
        if (filters.competencia && d.competencia !== filters.competencia) return false;
        if (filters.competenciaInicio && d.competencia < filters.competenciaInicio) return false;
        if (filters.competenciaFim && d.competencia > filters.competenciaFim) return false;
        if (filters.busca) {
            const term = filters.busca.toLowerCase();
            const blob = `${d.numero || ''} ${d.chave || ''} ${(d as any).emitente?.nome || (d as any).prestador?.nome || ''} ${(d as any).destinatario?.nome || (d as any).tomador?.nome || ''} ${d.empresaNome || ''}`.toLowerCase();
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

/**
 * Busca documentos por chave de acesso (44 dígitos) em batches.
 * Usado pela conferência SPED — busca por chave é independente de empresaId
 * e ignora filtro de createdBy (qualquer admin/colaborador pode conferir).
 *
 * Firestore aceita até 30 chaves por query 'in'. Batches em paralelo.
 */
export async function getDocumentosByChaves(chaves: string[]): Promise<DocumentoFiscal[]> {
    if (!isFirebaseConfigured || !db || !chaves.length) return [];
    const chavesLimpas = chaves.map(c => (c || '').replace(/\D/g, '')).filter(c => c.length === 44);
    if (!chavesLimpas.length) return [];

    const BATCH_SIZE = 30;
    const batches: string[][] = [];
    for (let i = 0; i < chavesLimpas.length; i += BATCH_SIZE) {
        batches.push(chavesLimpas.slice(i, i + BATCH_SIZE));
    }

    const results: DocumentoFiscal[] = [];
    await Promise.all(batches.map(async batch => {
        try {
            const q = query(
                collection(db!, COLLECTIONS.DOCUMENTOS),
                where('chave', 'in', batch),
                fbLimit(30),
            );
            const snap = await getDocs(q);
            snap.docs.forEach(d => {
                results.push({ id: d.id, ...(d.data() as any) } as DocumentoFiscal);
            });
        } catch (err: any) {
            console.warn('getDocumentosByChaves batch failed:', err?.message);
        }
    }));

    return results;
}

/**
 * Busca XMLs pra uma empresa (CNPJ) num período [dtIniIso, dtFimIso].
 * Tenta tanto cnpjDest (NFe entrada) quanto cnpjEmit (NFe saída) e empresaCnpj
 * (campo do importer). Usado como fallback quando getDocumentosByChaves
 * não encontra nada — provável que captura SEFAZ não rodou contra essa empresa.
 */
export async function getDocumentosByCnpjPeriodo(
    cnpj: string,
    dtIniIso: string,
    dtFimIso: string,
): Promise<DocumentoFiscal[]> {
    if (!isFirebaseConfigured || !db || !cnpj) return [];
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    if (cnpjLimpo.length !== 14) return [];

    const results: DocumentoFiscal[] = [];
    const visto = new Set<string>();

    async function buscar(campo: string) {
        try {
            const q = query(
                collection(db!, COLLECTIONS.DOCUMENTOS),
                where(campo, '==', cnpjLimpo),
                where('dhEmi', '>=', dtIniIso),
                where('dhEmi', '<=', dtFimIso),
                fbLimit(2000),
            );
            const snap = await getDocs(q);
            snap.docs.forEach(d => {
                if (visto.has(d.id)) return;
                visto.add(d.id);
                results.push({ id: d.id, ...(d.data() as any) } as DocumentoFiscal);
            });
        } catch (err: any) {
            console.warn(`getDocumentosByCnpjPeriodo (${campo}) falhou:`, err?.message);
        }
    }

    await Promise.all([
        buscar('empresaCnpj'),
        buscar('cnpjDest'),
        buscar('cnpjEmit'),
    ]);

    return results;
}

export async function listCapturas(user: User | null, max = 200): Promise<XmlCaptura[]> {
    if (!user || !isFirebaseConfigured || !db) return [];
    const isMaster = isMasterUser(user);
    const uid = auth?.currentUser?.uid;
    const constraints: QueryConstraint[] = [];
    if (!isMaster && uid) constraints.push(where('usuarioId', '==', auth?.currentUser?.uid ?? user.id));
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
    if (!isMaster) constraints.push(where('usuarioId', '==', auth?.currentUser?.uid ?? user.id));
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
    porTipoDoc: Record<string, { quantidade: number; valor: number }>;
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
        porTipoDoc: {},
        cfops: {},
        ncms: {},
        duplicados: 0,
    };

    const seenChaves = new Set<string>();
    for (const d of docs) {
        // valorTotal normalizado pelo importer (vNF | vTPrest | vRec). Fallback p/ docs antigos.
        const valor = d.valorTotal ?? d.totais?.vNF ?? d.valores?.liquido ?? 0;
        const tipoKey = d.tipoDoc || d.tipo || 'desconhecido';
        const t = out.porTipoDoc[tipoKey] ||= { quantidade: 0, valor: 0 };
        t.quantidade++;
        t.valor += valor;
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
