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
import { listarEmpresasPerfilBackend } from './empresasPerfilService';
import {
    parseNFeXml,
    matchCompanyAndDirection,
    buildDocumentoFiscal,
    sha256Hex,
    formatCnpjCpf,
    XmlParseError,
} from './xmlParserService';
import { uploadXml, deleteXml } from './xmlStorageService';
import { lerDuplicado, type LeituraDuplicado, type DocumentoExistente } from './importDuplicadoMotivo';
import { soZerosComoVazio } from './empresaDadosFiscaisSanitize';
// A direção EFETIVA — nunca o campo cru. A nota PRÓPRIA de entrada (art. 136)
// fica gravada como 'saida' até o backfill passar, e este painel é o número
// que a equipe compara com o livro e com o SPED.
import { direcaoEfetivaDoc } from '../sefaz-backend/xml-metadata-helper.js';

const direcaoDoDocumento = (d: any): string => (direcaoEfetivaDoc(d) as string) || '';
import { valorDoDocumento } from '../sefaz-backend/xml-metadata-helper.js';
import { applyDocumentosFilters, getCompetenciaDocumento } from './xmlDocumentosFilter';
import {
    podeVerDocumentoPorCarteira,
    podeVerEmpresaPorCarteira,
    montaCarteiraScope,
    vinculoPertenceAoUsuario,
    type CarteiraVinculoLike,
    type CarteiraScope,
} from './visibilidadeCarteira';
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

async function getCarteiraScope(user: User): Promise<CarteiraScope | null> {
    if (isMasterUser(user)) return null;
    const uid = auth?.currentUser?.uid ?? user.id;
    if (!uid || !db) return { uid, empresaIds: new Set(), empresaCnpjs: new Set() };

    try {
        const snap = await getDocs(query(collection(db, 'carteiras'), fbLimit(500)));
        const todosVinculos: CarteiraVinculoLike[] = snap.docs.map(d => d.data() as any);
        const meusVinculos = todosVinculos.filter(v => vinculoPertenceAoUsuario(v, user, uid));
        return montaCarteiraScope(uid, meusVinculos, !snap.empty);
    } catch (err: any) {
        console.warn('getCarteiraScope:', err?.message);
        return { uid, empresaIds: new Set(), empresaCnpjs: new Set() };
    }
}

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
    /** Cod.Cliente (E-Fiscal) — a equipe busca empresa por ele (04/08). */
    codCliente?: string;
}

/**
 * Dados de identificação (responsável legal + contador) do cadastro da
 * empresa — usados pelo bloco obrigatório dos relatórios em PDF. Leitura
 * direta do doc (dadosFiscais); null quando indisponível — o PDF imprime
 * "não cadastrado" no lugar, nunca esconde o buraco.
 */
export async function getIdentificacaoEmpresa(opt: EmpresaXmlOption): Promise<import('../types').EmpresaDadosFiscais | null> {
    if (!isFirebaseConfigured || !db || !opt?.id) return null;
    const colecoes = opt.fonte === 'lucro'
        ? ['lucro_empresas', 'simples_empresas']
        : ['simples_empresas', 'lucro_empresas'];
    for (const col of colecoes) {
        try {
            const snap = await getDoc(doc(db, col, opt.id));
            if (snap.exists()) return ((snap.data() as any).dadosFiscais || {}) as import('../types').EmpresaDadosFiscais;
        } catch { /* tenta a outra coleção */ }
    }
    return null;
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

    try {
        const backendList = await listarEmpresasPerfilBackend(user);
        if (backendList.length > 0) {
            return dedupEmpresas(backendList.map(e => ({
                id: e.id,
                nome: e.nome,
                cnpj: e.cnpj,
                fonte: e.fonte,
                uf: e.uf,
                createdBy: e.createdBy,
                codCliente: e.codCliente,
            })));
        }
    } catch (err: any) {
        console.warn('getEmpresasDisponiveis/backend:', err?.message);
    }

    try {
        const scope = await getCarteiraScope(user);
        const [simplesSnap, lucroSnap] = await Promise.all([
            fetchAllDocs('simples_empresas', []),
            fetchAllDocs('lucro_empresas', []),
        ]);

        // 23/05: filtra perdedores do merge de duplicatas
        const simples: EmpresaXmlOption[] = simplesSnap
            .filter(d => !(d.data() as any)._merged_into && !(d.data() as any)._deleted)
            .map(d => {
                const data = d.data() as SimplesNacionalEmpresa;
                return { id: d.id, nome: data.nome, cnpj: data.cnpj, fonte: 'simples' as const, uf: data.dadosFiscais?.uf, municipio: (data as any).municipio || undefined, createdBy: data.createdBy, codCliente: data.dadosFiscais?.codCliente };
            })
            .filter(e => !scope || podeVerEmpresaPorCarteira(e, scope));
        const lucro: EmpresaXmlOption[] = lucroSnap
            .filter(d => !(d.data() as any)._merged_into && !(d.data() as any)._deleted)
            .map(d => {
                const data = d.data() as LucroPresumidoEmpresa;
                return { id: d.id, nome: data.nome, cnpj: data.cnpj, fonte: 'lucro' as const, uf: data.dadosFiscais?.uf, municipio: (data as any).municipio || undefined, createdBy: data.createdBy, codCliente: data.dadosFiscais?.codCliente };
            })
            .filter(e => !scope || podeVerEmpresaPorCarteira(e, scope));

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
    // Campos da conferência de cadastro (cadastroClientePendencias) — vêm do
    // backend de perfil; ausentes em respostas antigas/fallback local.
    codMunIBGE?: string;
    email?: string;
    cnae?: string;
    anexo?: string;
    dataAbertura?: string;
    /** Responsável legal e contador (identificação dos relatórios, 01/08). */
    respLegalNome?: string;
    respLegalCpf?: string;
    respLegalCargo?: string;
    contadorNome?: string;
    contadorCrc?: string;
    contadorCpf?: string;
    /** Cod.Cliente (E-Fiscal) — chave da migração do PG12 (4 dígitos, texto). */
    codCliente?: string;
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

    try {
        const backendList = await listarEmpresasPerfilBackend(user);
        if (backendList.length > 0) {
            return dedupPerfilOptions(backendList);
        }
    } catch (err: any) {
        console.warn('getEmpresasParaPerfilCliente/backend:', err?.message);
    }

    try {
        const scope = await getCarteiraScope(user);
        const [simplesSnap, lucroSnap] = await Promise.all([
            fetchAllDocs('simples_empresas'),
            fetchAllDocs('lucro_empresas'),
        ]);

        // 23/05: filtra perdedores do merge de duplicatas
        const simples: EmpresaPerfilOption[] = simplesSnap
            .filter(d => !(d.data() as any)._merged_into && !(d.data() as any)._deleted)
            .map(d => {
            const data = d.data() as SimplesNacionalEmpresa;
            const df: any = data.dadosFiscais || {};
            return {
                id: d.id,
                nome: data.nome,
                cnpj: data.cnpj,
                fonte: 'simples' as const,
                regimeSugerido: 'SIMPLES' as RegimeSugerido,
                uf: df.uf,
                inscricaoEstadual: df.inscricaoEstadual,
                ccmSp: df.ccmSp || (data as any).ccmSp,
                createdBy: data.createdBy,
                // Campos da conferência de cadastro — sem eles o FALLBACK fazia
                // toda empresa parecer pendente quando o backend caía (03/08).
                codMunIBGE: df.codMunIBGE || (data as any).codMunIBGE,
                email: (data as any).email || df.email,
                cnae: (data as any).cnae || df.cnae,
                anexo: (data as any).anexo,
                dataAbertura: (data as any).dataAbertura || df.dataAbertura,
                respLegalNome: df.respLegalNome || df.responsaveisLegais?.[0]?.nome,
                contadorNome: df.contadorNome,
                contadorCrc: df.contadorCrc,
                codCliente: df.codCliente,
            };
        }).filter(e => !scope || podeVerEmpresaPorCarteira(e, scope));
        const lucro: EmpresaPerfilOption[] = lucroSnap
            .filter(d => !(d.data() as any)._merged_into && !(d.data() as any)._deleted)
            .map(d => {
            const data = d.data() as LucroPresumidoEmpresa;
            const df: any = data.dadosFiscais || {};
            return {
                id: d.id,
                nome: data.nome,
                cnpj: data.cnpj,
                fonte: 'lucro' as const,
                regimeSugerido: inferirRegimeLucro(data),
                uf: df.uf,
                inscricaoEstadual: df.inscricaoEstadual,
                ccmSp: df.ccmSp || data.ccmSp,
                createdBy: data.createdBy,
                codMunIBGE: df.codMunIBGE || (data as any).codMunIBGE,
                email: (data as any).email || df.email,
                cnae: (data as any).cnae || df.cnae,
                dataAbertura: (data as any).dataAbertura || df.dataAbertura,
                respLegalNome: df.respLegalNome || df.responsaveisLegais?.[0]?.nome,
                contadorNome: df.contadorNome,
                contadorCrc: df.contadorCrc,
                codCliente: df.codCliente,
            };
        }).filter(e => !scope || podeVerEmpresaPorCarteira(e, scope));

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
    /**
     * SUBSTITUIR o que já está no banco pelo conteúdo deste arquivo.
     *
     * Existe porque "já está aqui" não é resposta quando o que está aqui está
     * ERRADO — e era o caso do Paulo, 14/08: o documento no banco veio torto e
     * a única saída seria reimportar, que o app recusava. Ficar repetindo o
     * clique nunca ia mudar isso.
     *
     * É opt-in EXPLÍCITO na tela, nunca padrão: reimportar por engano em cima
     * de um documento certo sobrescreveria dado fiscal sem ninguém pedir.
     */
    substituir?: boolean;
}

export interface ImportXmlSuccess {
    status: 'ok';
    documento: DocumentoFiscal;
    /** true quando REESCREVEU um documento que já existia (opt-in na tela). */
    substituiu?: boolean;
    /** true quando COMPLETOU um resumo/incompleto com a NF-e inteira (upgrade). */
    completou?: boolean;
}

export interface ImportXmlSkipped {
    status: 'duplicado';
    existingId: string;
    chave: string;
    /**
     * POR QUE não entrou — com onde, quando e por qual trilho o documento já
     * está no banco. "Já importado" sozinho é um beco: a pessoa repete o
     * clique e a resposta nunca muda (Paulo, 14/08, com 12 arquivos na tela).
     */
    leitura: LeituraDuplicado;
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

    const { file, empresa, user, origem = 'manual', substituir = false } = input;
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
        // O QUE JÁ ESTAVA LÁ decide o que acontece agora — e as situações têm
        // ações OPOSTAS: em outra empresa não se resolve reimportando, e com
        // lápide de exclusão reimportar é justamente a ação certa (o documento
        // está invisível na lista E bloqueando a reentrada, o pior dos dois
        // mundos). Chamar tudo de "duplicado" era o que fechava o beco.
        const leitura = lerDuplicado(
            existing && existing.exists() ? (existing.data() as DocumentoExistente) : null,
            empresa,
        );
        // SUBSTITUIÇÃO: só quando alguém PEDIU, e só na MESMA empresa.
        //
        // Sobrescrever documento de outra empresa seria mover a nota de dona
        // por importação — sem ninguém decidir isso, e sem deixar rastro na
        // empresa que a perdeu. Essa continua recusada, com a causa na tela.
        const podeSubstituir = substituir && leitura.situacao !== 'em-outra-empresa';
        // UPGRADE resumo→completa (caso PWR, 19/08): o que está na base não tem
        // itens/nº/CST e o arquivo é a NF-e inteira. Não precisa de opt-in — é
        // estritamente MAIS dado do mesmo documento, a mesma decisão que o
        // trilho automático do backend sempre tomou (decidirGravacaoNFe).
        const podeCompletar = leitura.permiteCompletar === true;
        if (existing && existing.exists() && !leitura.permiteReincluir && !podeSubstituir && !podeCompletar) {
            await registrarCaptura({
                chave,
                empresaId: empresa.id,
                origem,
                status: 'duplicado',
                fileName,
                tamanhoBytes: file.size,
                user,
                // A auditoria guarda a MESMA frase que a pessoa leu na tela —
                // log que diz menos que a tela não serve para reconstruir o caso.
                mensagem: leitura.mensagem,
                documentoId: docId,
            });
            return { status: 'duplicado', existingId: docId, chave, leitura };
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
            // REINCLUSÃO: a lápide precisa sair explicitamente. `setDoc` sem
            // merge já sobrescreve o documento inteiro, mas deixar isso
            // implícito é confiar num detalhe do SDK para desfazer uma exclusão
            // — e o dia em que alguém trocar por `{ merge: true }` o documento
            // volta invisível, sem nada apontando para cá.
            const paraGravar: Record<string, unknown> = { ...sanitize(documento) };
            if (podeSubstituir && !leitura.permiteReincluir) {
                // O rastro fica NO documento: substituição é reescrita de dado
                // fiscal, e sem quem/quando ninguém reconstrói o que mudou.
                paraGravar._substituidoEm = new Date().toISOString();
                paraGravar._substituidoPorEmail = user.email || null;
            }
            if (leitura.permiteReincluir || podeSubstituir) {
                // TODAS as lápides saem — não só a de exclusão. Limpar uma e
                // deixar a outra devolve o documento ao mesmo estado de antes:
                // invisível no app e bloqueando a reentrada.
                paraGravar._deleted = false;
                paraGravar._merged_into = null;
                paraGravar._reincluidoEm = new Date().toISOString();
                paraGravar._reincluidoPorEmail = user.email || null;
            }
            // UPGRADE grava com MERGE — o resumo pode já ter recebido eventos
            // (cancelamento chega antes da completa) e um set sem merge os
            // apagaria. É o mesmo desenho do importer do backend.
            await setDoc(doc(db, COLLECTIONS.DOCUMENTOS, docId), paraGravar,
                podeCompletar ? { merge: true } : {});
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

        return {
            status: 'ok', documento,
            substituiu: podeSubstituir && !leitura.permiteReincluir && !podeCompletar,
            completou: podeCompletar,
        };
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
    /** Vários ids (matriz + filiais da mesma raiz) — vira `in` no servidor. */
    empresaIds?: string[];
    empresaCnpj?: string;        // match exato no campo empresaCnpj do doc
    direcao?: 'entrada' | 'saida';
    competencia?: string;        // YYYY-MM
    competenciaInicio?: string;
    competenciaFim?: string;
    status?: DocumentoFiscal['status'];
    origem?: XmlOrigem;
    tipoDoc?: string;            // NFe | NFCe | NFSe | CTe | MDFe — compara em memoria contra tipoDoc OU tipo
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
    // Out-param opcional: preenchido com truncado=true quando a leitura bateu no
    // teto de páginas (pode haver mais docs). Callers que exportam/agregam devem
    // avisar o usuário — senão o recorte fica silenciosamente incompleto.
    meta?: { truncado?: boolean },
): Promise<DocumentoFiscal[]> {
    if (meta) meta.truncado = false;
    if (!user || !isFirebaseConfigured || !db) return [];
    const scope = await getCarteiraScope(user);

    const constraints: QueryConstraint[] = [];
    // Admin: busca tudo (com filtro opcional de empresa). Colaborador: busca
    // tudo (rules permitem) e filtra no cliente por createdBy OU empresa em
    // carteira. Antes filtrava so por createdBy -- colaborador nao via doc
    // de empresa atribuida via carteira quando outro colega importou (mesmo
    // padrao corrigido no #120 pra empresas).
    if (filters.empresaId) constraints.push(where('empresaId', '==', filters.empresaId));
    // Vários ids (matriz + filiais da mesma raiz): `in` aceita até 30 valores.
    // Sem isto, a tela caía na leitura da coleção INTEIRA e o teto de 20.000
    // docs cortava justamente as notas procuradas (caso GUARANI 27/07).
    else if (filters.empresaIds && filters.empresaIds.length > 0) {
        constraints.push(where('empresaId', 'in', filters.empresaIds.slice(0, 30)));
    }
    // Competência exata vai ao SERVIDOR: corta a busca de dezenas de milhares
    // de docs para o mês pedido (igualdade simples — não exige índice composto;
    // range competenciaInicio/Fim continua no cliente via applyDocumentosFilters).
    if (filters.competencia) constraints.push(where('competencia', '==', filters.competencia));
    // NÃO usamos orderBy aqui: Firestore exclui docs que não têm o campo.
    // Ordenação fica em memória com fallbacks (ver abaixo).
    // Paginação via cursor (fetchAllDocs) substitui o antigo fbLimit(500) que
    // truncava o dashboard silenciosamente quando a base passava de 500 XMLs.

    let docs: DocumentoFiscal[] = [];
    try {
        // documentos_fiscais permite limit <=5000 nas rules; usa pagina maior.
        const pageMeta = { truncated: false, count: 0, maxDocs: 0 };
        const snaps = await fetchAllDocs(COLLECTIONS.DOCUMENTOS, constraints, { batchSize: 2000, meta: pageMeta });
        if (meta) meta.truncado = pageMeta.truncated;
        docs = snaps.map(d => ({ id: d.id, ...(d.data() as any) } as DocumentoFiscal));

        // Documento capturado server-side (autXML, ZIP, cofre, SAE) muitas
        // vezes tem só `empresaCnpj`, sem `empresaId` — a consulta acima o
        // deixaria de fora. Por isso a tela filtrava a EMPRESA em memória,
        // e aí precisava ler o MÊS INTEIRO: em competência cheia batia no
        // teto e o recorte saía incompleto ("limite de leitura atingido",
        // relato de 04/08). Buscar pelos dois campos no SERVIDOR resolve os
        // dois problemas: nada é descartado e a leitura fica do tamanho da
        // empresa, não do mês.
        const cnpjFiltro = String(filters.empresaCnpj || '').replace(/\D/g, '');
        if (cnpjFiltro.length === 14 && (filters.empresaId || filters.empresaIds?.length)) {
            const porCnpj: QueryConstraint[] = [where('empresaCnpj', '==', cnpjFiltro)];
            if (filters.competencia) porCnpj.push(where('competencia', '==', filters.competencia));
            const metaCnpj = { truncated: false, count: 0, maxDocs: 0 };
            const snapsCnpj = await fetchAllDocs(COLLECTIONS.DOCUMENTOS, porCnpj, { batchSize: 2000, meta: metaCnpj });
            if (meta && metaCnpj.truncated) meta.truncado = true;
            const vistos = new Set(docs.map(d => d.id));
            for (const d of snapsCnpj) {
                if (vistos.has(d.id)) continue;
                vistos.add(d.id);
                docs.push({ id: d.id, ...(d.data() as any) } as DocumentoFiscal);
            }
        }

        if (scope) docs = docs.filter(d => podeVerDocumentoPorCarteira(d, scope));
    } catch (err: any) {
        console.warn('listDocumentos:', err?.message);
        // Leitura falhou (rules/rede/índice) — sinaliza incompletude pra o caller
        // não tratar [] como "base vazia legítima" (ex.: export/agregação).
        if (meta) meta.truncado = true;
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

    return applyDocumentosFilters(docs, filters);
}

// applyDocumentosFilters vive em ./xmlDocumentosFilter (módulo PURO, sem
// firebase) pra ser testável em jest — firebaseConfig usa import.meta.env, que
// quebra no ts-jest. Re-exportado aqui pra manter o import dos consumidores
// (XmlDocumentosList importa de xmlFiscalService).
export { applyDocumentosFilters };

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
        // 🚨 SEGUNDA CÓPIA DA RÉGUA DO VALOR — e ela divergia do dono em dois
        // pontos: não conhecia `valores.total`/`vNF` (as formas do import pelo
        // NAVEGADOR) e usava `valores.liquido`, que o dono EXCLUI de propósito
        // — na NFS-e ele é o líquido de RETENÇÕES, não o bruto do documento.
        // Duas respostas para "quanto vale este documento" é o defeito que
        // este projeto mais paga.
        const valor = Number(valorDoDocumento(d)) || 0;
        const tipoKey = d.tipoDoc || d.tipo || 'desconhecido';
        const t = out.porTipoDoc[tipoKey] ||= { quantidade: 0, valor: 0 };
        t.quantidade++;
        t.valor += valor;
        out.valorTotal += valor;
        // 🚨 A DIREÇÃO PELA RÉGUA: a compra de produtor rural (art. 136) fica
        // gravada como 'saida' e entrava aqui como SAÍDA, inflando o
        // faturamento do painel — que é o número que a equipe compara com o
        // livro e com o SPED, ambos já corrigidos.
        const dirDoc = direcaoDoDocumento(d);
        if (dirDoc === 'entrada') { out.entradas++; out.valorEntradas += valor; }
        else if (dirDoc === 'saida') { out.saidas++; out.valorSaidas += valor; }

        if (d.chave) {
            if (seenChaves.has(d.chave)) out.duplicados++;
            else seenChaves.add(d.chave);
        }

        const comp = getCompetenciaDocumento(d) || 'sem-competencia';
        const c = out.porCompetencia[comp] ||= { entradas: 0, saidas: 0, valorEntradas: 0, valorSaidas: 0 };
        const dirComp = direcaoDoDocumento(d);
        if (dirComp === 'entrada') { c.entradas++; c.valorEntradas += valor; }
        else if (dirComp === 'saida') { c.saidas++; c.valorSaidas += valor; }

        // Top Empresas: fallback CNPJ formatado quando empresaNome vier vazio
        // (docs antigos importados antes do importer popular empresaNome, OU
        // empresas auto-cadastradas pelo cron NFSe SP em nfsesp_empresas_descobertas
        // sem CNPJ linkado). Sem isso o painel mostra linhas em branco.
        const eid = d.empresaId || d.empresaCnpj || 'sem-empresa';
        const nomeFallback = d.empresaNome || formatCnpjCpf(d.empresaCnpj || '') || '(sem identificação)';
        if (!out.porEmpresa[eid]) {
            out.porEmpresa[eid] = { nome: nomeFallback, total: 0, valorTotal: 0 };
        } else if (d.empresaNome && out.porEmpresa[eid].nome !== d.empresaNome) {
            // Se um doc posterior trouxe o nome real, sobrescreve o fallback
            out.porEmpresa[eid].nome = d.empresaNome;
        }
        const e = out.porEmpresa[eid];
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

/**
 * Dados fiscais de UMA empresa (natureza da atividade + overrides de CFOP).
 *
 * A exportação IOB/SAGE precisa deles para correlacionar o CFOP: o que a
 * equipe configura na tela Correlação CFOP não estava chegando ao arquivo —
 * tudo caía na inversão mecânica, ignorando a configuração (Paulo, 29/07).
 */
// '', '0', '000…' → null (não é inscrição). A régua mora em
// empresaDadosFiscaisSanitize (soZerosComoVazio) — a cópia local daqui foi a
// razão de a régua de pendências não conhecer a regra (21/08, os 8 zeros).
const soZeros = soZerosComoVazio;

export async function getDadosFiscaisEmpresa(
    fonte: 'simples' | 'lucro',
    empresaId: string,
): Promise<{
    naturezaAtividade?: string | null;
    cfopOverrides?: Record<string, string> | null;
    codigoParticipanteConsumidor?: string | null;
    codCliente?: string | null;
    /** Município IBGE — decide a praça do ISS (SP capital = 3550308). */
    codMunIBGE?: string | null;
    indAtividade?: string | null;
    /**
     * CCM de SP capital (e a inscrição municipal genérica dos demais
     * municípios). Cadastro CANÔNICO é `dadosFiscais.ccmSp`, mas o dado LEGADO
     * mora no topo do doc — é assim que a rota de status lê (#311). Ler só o
     * canônico faz a empresa antiga aparecer SEM CCM, e o botão de testar o WS
     * da Prefeitura nasce desabilitado sem dizer por quê (caso CLINICA MANTOAN,
     * 06/08).
     */
    ccmSp?: string | null;
    inscricaoMunicipal?: string | null;
    /**
     * Config de ISS da empresa (Lucro: `issPadraoConfig`). Vem do TOPO do doc,
     * não de dadosFiscais — é o que diz se a empresa é ISS FIXO (sociedade
     * uniprofissional), caso em que a guia não sai do faturamento.
     */
    issConfig?: import('../types').IssConfig | null;
} | null> {
    if (!isFirebaseConfigured || !db || !empresaId) return null;
    try {
        const colecao = fonte === 'simples' ? 'simples_empresas' : 'lucro_empresas';
        const snap = await getDoc(doc(db, colecao, empresaId));
        if (!snap.exists()) return null;
        const doc0 = (snap.data() as any) || {};
        const df = doc0.dadosFiscais || {};
        // CUIDADO (lição da whitelist #382, do lado do cliente): esta lista é
        // EXPLÍCITA — campo novo que não entrar aqui é lido como vazio e a tela
        // se comporta como se nunca tivesse sido cadastrado.
        return {
            naturezaAtividade: df.naturezaAtividade ?? null,
            cfopOverrides: df.cfopOverrides ?? null,
            codigoParticipanteConsumidor: df.codigoParticipanteConsumidor ?? null,
            codCliente: df.codCliente ?? null,
            codMunIBGE: df.codMunIBGE ?? doc0.codMunIBGE ?? null,
            indAtividade: df.indAtividade ?? null,
            // CCM só-zeros é contorno antigo da equipe pra campo que parecia
            // obrigatório: vale como VAZIO (#311), nunca como inscrição.
            ccmSp: soZeros(df.ccmSp) ?? soZeros(doc0.ccmSp) ?? null,
            inscricaoMunicipal: soZeros(df.inscricaoMunicipal) ?? soZeros(doc0.inscricaoMunicipal) ?? null,
            issConfig: doc0.issPadraoConfig ?? df.issConfig ?? null,
        };
    } catch {
        return null;
    }
}
