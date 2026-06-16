import {
    SimplesNacionalAnexo, SimplesNacionalEmpresa, SimplesNacionalNota,
    SimplesNacionalResumo, SimplesHistoricoCalculo, SimplesCalculoMensal,
    SimplesNacionalImportResult, SimplesNacionalAtividade, DetalhamentoAnexo,
    SimplesItemCalculo, User, SimplesDetalheItem
} from '../types';
import { extractDocumentData, extractPgdasDataFromPdf } from './geminiService';
import { parsePgdasExtrato } from './pgdasPdfParser';
import { db, isFirebaseConfigured, auth } from './firebaseConfig';
import { fetchAllDocs } from './firestorePaginate';
import { verificarCnpjDuplicado, mensagemCnpjDuplicado } from './empresaUniquenessService';
import { validarCnpj } from './validadorDocumento';
import {
    collection, getDocs, doc, setDoc, getDoc,
    query, where, deleteDoc, limit as fbLimit
} from 'firebase/firestore';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STORAGE_KEY_EMPRESAS  = 'simples_nacional_empresas';
const STORAGE_KEY_NOTAS     = 'simples_nacional_notas';
const MASTER_ADMIN_EMAIL    = 'junior@spassessoriacontabil.com.br';

// ─── TABELAS (tipadas - LC 123/2006 com LC 155/2016 e LC 192/2022) ────────────

/** Chave de anexo do Simples Nacional. */
export type AnexoKey = 'I' | 'II' | 'III' | 'IV' | 'V';

/** Faixa de receita do Anexo (limite, aliquota nominal, parcela a deduzir). */
export interface FaixaSimples {
    limite: number;     // teto de RBT12 em R$
    aliquota: number;   // em %
    parcela: number;    // parcela a deduzir em R$
}

/**
 * Reparticao percentual dos tributos dentro do DAS por anexo e faixa.
 * Soma 100% por faixa (descontando tributos que nao se aplicam ao anexo).
 *
 * Chaves de tributo:
 *   IRPJ, CSLL, COFINS, PIS, CPP - todas as faixas/anexos
 *   ICMS    - apenas Anexos I e II (mercadoria)
 *   IPI     - apenas Anexo II (industria)
 *   ISS     - apenas Anexos III, IV, V (servico)
 */
export type TributoSimples = 'IRPJ' | 'CSLL' | 'COFINS' | 'PIS' | 'CPP' | 'ICMS' | 'IPI' | 'ISS';
export type ReparticaoFaixa = Partial<Record<TributoSimples, number>>;
export type FaixaIndex = 0 | 1 | 2 | 3 | 4 | 5;

export const ANEXOS_TABELAS: Record<AnexoKey, FaixaSimples[]> = {
    "I":  [{ limite: 180000,  aliquota: 4,    parcela: 0      }, { limite: 360000,  aliquota: 7.3,  parcela: 5940   }, { limite: 720000,  aliquota: 9.5,  parcela: 13860  }, { limite: 1800000, aliquota: 10.7, parcela: 22500  }, { limite: 3600000, aliquota: 14.3, parcela: 87300  }, { limite: 4800000, aliquota: 19,   parcela: 378000 }],
    "II": [{ limite: 180000,  aliquota: 4.5,  parcela: 0      }, { limite: 360000,  aliquota: 7.8,  parcela: 5940   }, { limite: 720000,  aliquota: 10,   parcela: 13860  }, { limite: 1800000, aliquota: 11.2, parcela: 22500  }, { limite: 3600000, aliquota: 14.7, parcela: 85500  }, { limite: 4800000, aliquota: 30,   parcela: 720000 }],
    "III":[{ limite: 180000,  aliquota: 6,    parcela: 0      }, { limite: 360000,  aliquota: 11.2, parcela: 9360   }, { limite: 720000,  aliquota: 13.5, parcela: 17640  }, { limite: 1800000, aliquota: 16,   parcela: 35640  }, { limite: 3600000, aliquota: 21,   parcela: 125640 }, { limite: 4800000, aliquota: 33,   parcela: 648000 }],
    "IV": [{ limite: 180000,  aliquota: 4.5,  parcela: 0      }, { limite: 360000,  aliquota: 9,    parcela: 8100   }, { limite: 720000,  aliquota: 10.2, parcela: 12420  }, { limite: 1800000, aliquota: 14,   parcela: 39780  }, { limite: 3600000, aliquota: 22,   parcela: 183780 }, { limite: 4800000, aliquota: 33,   parcela: 828000 }],
    "V":  [{ limite: 180000,  aliquota: 15.5, parcela: 0      }, { limite: 360000,  aliquota: 18,   parcela: 4500   }, { limite: 720000,  aliquota: 19.5, parcela: 9900   }, { limite: 1800000, aliquota: 20.5, parcela: 17100  }, { limite: 3600000, aliquota: 23,   parcela: 62100  }, { limite: 4800000, aliquota: 30.5, parcela: 540000 }]
};

export const REPARTICAO_IMPOSTOS: Record<AnexoKey, Record<FaixaIndex, ReparticaoFaixa>> = {
    "I": {
        0: { IRPJ: 5.50,  CSLL: 3.50,  COFINS: 12.74, PIS: 2.76, CPP: 41.50, ICMS: 34.00 },
        1: { IRPJ: 5.50,  CSLL: 3.50,  COFINS: 12.74, PIS: 2.76, CPP: 41.50, ICMS: 34.00 },
        2: { IRPJ: 5.50,  CSLL: 3.50,  COFINS: 12.74, PIS: 2.76, CPP: 42.00, ICMS: 33.50 },
        3: { IRPJ: 5.50,  CSLL: 3.50,  COFINS: 12.74, PIS: 2.76, CPP: 42.00, ICMS: 33.50 },
        4: { IRPJ: 5.50,  CSLL: 3.50,  COFINS: 12.74, PIS: 2.76, CPP: 42.00, ICMS: 33.50 },
        5: { IRPJ: 13.50, CSLL: 10.00, COFINS: 28.27, PIS: 6.13, CPP: 42.10, ICMS: 0.00  }
    },
    "II": {
        0: { IRPJ: 5.50,  CSLL: 3.50,  COFINS: 11.51, PIS: 2.49, CPP: 37.50, IPI: 7.50, ICMS: 32.00 },
        1: { IRPJ: 5.50,  CSLL: 3.50,  COFINS: 11.51, PIS: 2.49, CPP: 37.50, IPI: 7.50, ICMS: 32.00 },
        2: { IRPJ: 5.50,  CSLL: 3.50,  COFINS: 11.51, PIS: 2.49, CPP: 37.50, IPI: 7.50, ICMS: 32.00 },
        3: { IRPJ: 5.50,  CSLL: 3.50,  COFINS: 11.51, PIS: 2.49, CPP: 37.50, IPI: 7.50, ICMS: 32.00 },
        4: { IRPJ: 5.50,  CSLL: 3.50,  COFINS: 11.51, PIS: 2.49, CPP: 37.50, IPI: 7.50, ICMS: 32.00 },
        5: { IRPJ: 8.50,  CSLL: 7.50,  COFINS: 20.96, PIS: 4.54, CPP: 23.50, IPI: 35.00, ICMS: 0.00 }
    },
    "III": {
        0: { IRPJ: 4.00,  CSLL: 3.50, COFINS: 12.82, PIS: 2.78, CPP: 43.40, ISS: 33.50 },
        1: { IRPJ: 4.00,  CSLL: 3.50, COFINS: 14.05, PIS: 3.05, CPP: 43.40, ISS: 32.00 },
        2: { IRPJ: 4.00,  CSLL: 3.50, COFINS: 13.64, PIS: 2.96, CPP: 43.40, ISS: 32.50 },
        3: { IRPJ: 4.00,  CSLL: 3.50, COFINS: 13.64, PIS: 2.96, CPP: 43.40, ISS: 32.50 },
        4: { IRPJ: 4.00,  CSLL: 3.50, COFINS: 12.82, PIS: 2.78, CPP: 43.40, ISS: 33.50 },
        5: { IRPJ: 35.00, CSLL: 15.00, COFINS: 16.03, PIS: 3.47, CPP: 30.50, ISS: 0.00 }
    },
    "IV": {
        0: { IRPJ: 18.80, CSLL: 15.20, COFINS: 17.67, PIS: 3.83, ISS: 44.50, CPP: 0.00 },
        1: { IRPJ: 19.80, CSLL: 15.20, COFINS: 20.55, PIS: 4.45, ISS: 40.00, CPP: 0.00 },
        2: { IRPJ: 20.80, CSLL: 15.20, COFINS: 19.73, PIS: 4.27, ISS: 40.00, CPP: 0.00 },
        3: { IRPJ: 17.80, CSLL: 19.20, COFINS: 18.90, PIS: 4.10, ISS: 40.00, CPP: 0.00 },
        4: { IRPJ: 18.80, CSLL: 19.20, COFINS: 18.08, PIS: 3.92, ISS: 40.00, CPP: 0.00 },
        5: { IRPJ: 53.50, CSLL: 21.50, COFINS: 20.55, PIS: 4.45, ISS:  0.00, CPP: 0.00 }
    },
    "V": {
        0: { IRPJ: 4.00, CSLL: 3.50, COFINS: 12.82, PIS: 2.78, CPP: 28.85, ISS: 48.05 },
        1: { IRPJ: 4.00, CSLL: 3.50, COFINS: 14.05, PIS: 3.05, CPP: 27.85, ISS: 47.55 },
        2: { IRPJ: 4.00, CSLL: 3.50, COFINS: 13.64, PIS: 2.96, CPP: 23.85, ISS: 52.05 },
        3: { IRPJ: 4.00, CSLL: 3.50, COFINS: 13.64, PIS: 2.96, CPP: 23.85, ISS: 52.05 },
        4: { IRPJ: 4.00, CSLL: 3.50, COFINS: 12.82, PIS: 2.78, CPP: 23.85, ISS: 53.05 },
        5: { IRPJ: 6.25, CSLL: 7.50, COFINS: 24.20, PIS: 5.25, CPP: 42.10, ISS: 14.70 }
    }
};

// ─── UTILS ────────────────────────────────────────────────────────────────────
const generateUUID = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).substr(2);

const sanitizePayload = (obj: any) => JSON.parse(JSON.stringify(obj));

const normalizarPeriodoPgdas = (periodo: unknown): string | null => {
    const raw = String(periodo ?? '').trim();
    if (!raw) return null;

    const br = raw.match(/^(\d{1,2})\s*\/\s*(\d{4})$/);
    if (br?.[1] && br[2]) {
        const mes = br[1].padStart(2, '0');
        if (Number(mes) >= 1 && Number(mes) <= 12) return `${br[2]}-${mes}`;
    }

    const iso = raw.match(/^(\d{4})-(\d{1,2})$/);
    if (iso?.[1] && iso[2]) {
        const mes = iso[2].padStart(2, '0');
        if (Number(mes) >= 1 && Number(mes) <= 12) return `${iso[1]}-${mes}`;
    }

    return null;
};

const normalizarValorPgdas = (valor: unknown): number | null => {
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
    if (typeof valor !== 'string') return null;

    const compactado = valor
        .replace(/\s/g, '')
        .replace(/^R\$/i, '');
    const dotCount = (compactado.match(/\./g) || []).length;
    const normalizado = compactado.includes(',')
        ? compactado.replace(/\./g, '').replace(',', '.')
        : dotCount > 1 || /^\d{1,3}\.\d{3}$/.test(compactado)
            ? compactado.replace(/\./g, '')
            : compactado;
    const parsed = Number(normalizado);
    return Number.isFinite(parsed) ? parsed : null;
};

const getLocalEmpresas = (): SimplesNacionalEmpresa[] => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_EMPRESAS) || '[]'); }
    catch { return []; }
};
const saveLocalEmpresas = (e: SimplesNacionalEmpresa[]) =>
    localStorage.setItem(STORAGE_KEY_EMPRESAS, JSON.stringify(e));

// ─── EMPRESAS ─────────────────────────────────────────────────────────────────
export const getEmpresas = async (user?: User | null): Promise<SimplesNacionalEmpresa[]> => {
    if (!user) return [];

    let cloudEmpresas: SimplesNacionalEmpresa[] = [];

    if (isFirebaseConfigured && db && auth?.currentUser) {
        try {
            const snaps = await fetchAllDocs('simples_empresas', []);
            cloudEmpresas = snaps
                .filter(d => !(d.data() as any)._merged_into)
                .map(d => ({ id: d.id, ...d.data() } as SimplesNacionalEmpresa));
            console.info('[Simples] cloud retornou', cloudEmpresas.length, 'empresas');
        } catch (err: any) {
            // Visivel pro admin DevTools -- antes era console.debug invisivel.
            console.error('[Simples] erro buscando empresas no Firestore:', err?.code, err?.message);
        }
    }

    // SEMPRE faz merge cloud + local pra nunca sumir empresa do cache.
    const local = getLocalEmpresas();
    const merged = [...cloudEmpresas];
    local.forEach(l => { if (!merged.find(c => c.id === l.id)) merged.push(l); });
    saveLocalEmpresas(merged);
    return merged;
};

export const saveEmpresa = async (
    nome: string, cnpj: string, cnae: string, anexo: string,
    atividadesSecundarias: any[], userId: string, dataAbertura?: string
): Promise<SimplesNacionalEmpresa> => {
    // Valida DV do CNPJ (suporta alfanumerico - IN RFB 2.229/2024).
    if (!validarCnpj(cnpj)) {
        throw new Error(`CNPJ invalido: "${cnpj}". Verifique os digitos.`);
    }

    // Trava de unicidade — bloqueia cadastro de CNPJ ja existente em
    // simples_empresas OU lucro_empresas (regra: unicidade global entre regimes).
    const check = await verificarCnpjDuplicado(cnpj);
    if (check.duplicado) {
        throw new Error(mensagemCnpjDuplicado(cnpj, check));
    }

    const finalAnexo = anexo === 'auto' ? sugerirAnexoPorCnae(cnae) : anexo;

    const newEmpresa: any = {
        id: generateUUID(), nome, cnpj, cnae, anexo: finalAnexo,
        atividadesSecundarias: atividadesSecundarias || [],
        folha12: 0, faturamentoManual: {}, faturamentoMensalDetalhado: {},
        historicoCalculos: [], createdBy: userId,
        createdByEmail: auth?.currentUser?.email || undefined,
        dataAbertura: dataAbertura || undefined,
        capturarSefaz: true  // Default: nova empresa ativa pra cron SEFAZ
    };

    // ── Cloud-first ──
    if (isFirebaseConfigured && db && auth?.currentUser) {
        try {
            newEmpresa.createdBy      = auth.currentUser.uid;
            newEmpresa.createdByEmail = auth.currentUser.email || undefined;
            await setDoc(doc(db, 'simples_empresas', newEmpresa.id), sanitizePayload(newEmpresa));
        } catch (e: any) { console.debug('saveEmpresa cloud error:', e.message); }
    }

    // ── Local cache ──
    const local = getLocalEmpresas();
    local.push(newEmpresa);
    saveLocalEmpresas(local);

    return newEmpresa;
};

export const updateEmpresa = async (
    id: string, data: Partial<SimplesNacionalEmpresa>
): Promise<SimplesNacionalEmpresa | null> => {
    // ── Cloud-first ──
    if (isFirebaseConfigured && db && auth?.currentUser) {
        try {
            const { id: _, createdBy: __, createdByEmail: ___, ...safeData } = data as any;
            await setDoc(doc(db, 'simples_empresas', id), sanitizePayload({
                ...safeData,
                createdBy: auth.currentUser.uid,
                createdByEmail: auth.currentUser.email
            }), { merge: true });
        } catch (e: any) { console.debug('updateEmpresa cloud error:', e.message); }
    }

    // ── Local cache ──
    const local = getLocalEmpresas();
    const idx = local.findIndex(e => e.id === id);
    const existente = idx !== -1 ? local[idx] : null;
    if (existente) {
        const atualizada = { ...existente, ...data };
        local[idx] = atualizada;
        saveLocalEmpresas(local);
        return atualizada;
    }
    return null;
};

/**
 * Deleta uma empresa do Simples. Firestore eh fonte da verdade — se a
 * delecao na nuvem falhar (permission-denied, network, etc), o erro
 * propaga e o cache local NAO eh modificado. Isso evita o anti-pattern
 * antigo de "some da tela mas volta no proximo refresh".
 *
 * Regra Firestore (firestore.rules):
 *   allow delete: if isOwnerOrAdmin(resource.data.createdBy);
 * Ou seja: o dono OU qualquer admin pode deletar.
 */
export const deleteEmpresa = async (id: string): Promise<void> => {
    if (!isFirebaseConfigured || !db) {
        throw new Error('Firebase nao configurado — nao foi possivel deletar a empresa.');
    }
    // 1. Deleta da nuvem (fonte da verdade). Se falhar, throw — nao toca no local.
    await deleteDoc(doc(db, 'simples_empresas', id));

    // 2. Atualiza local cache so depois do sucesso na nuvem
    const local = getLocalEmpresas();
    saveLocalEmpresas(local.filter(e => e.id !== id));
};

// ─── NOTAS ────────────────────────────────────────────────────────────────────
export const getAllNotas = async (
    user?: User | null
): Promise<Record<string, SimplesNacionalNota[]>> => {
    const isMaster = user?.role === 'admin' ||
        user?.email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase();
    let cloudNotas: SimplesNacionalNota[] = [];

    // ── Cloud-first ──
    if (isFirebaseConfigured && db && auth?.currentUser) {
        try {
            const uid = auth.currentUser.uid;
            // Admin: busca tudo. Colaborador: busca tudo (rules permitem) e
            // filtra no cliente. Ve nota se foi criada por ele OU se eh de
            // empresa atribuida a ele via carteira (mesmo bug das empresas
            // que arrumamos no PR #120 -- antes filtrava so por createdBy).
            const snaps = await fetchAllDocs('simples_notas', []);
            cloudNotas = snaps.map(d =>
                ({ id: d.id, ...d.data() } as SimplesNacionalNota));
            // VISIBILIDADE ABERTA: todos veem todas as notas. Decisao temporaria.
        } catch { /* silent */ }
    }

    // Merge com local (para dados ainda não sincronizados)
    const stored = localStorage.getItem(STORAGE_KEY_NOTAS);
    const localMap = stored ? JSON.parse(stored) : {};
    const noteMap = new Map<string, SimplesNacionalNota>();
    Object.values(localMap).forEach((arr: any) => arr.forEach((n: any) => noteMap.set(n.id, n)));
    cloudNotas.forEach(n => noteMap.set(n.id, n)); // cloud sobrepõe local

    const result: Record<string, SimplesNacionalNota[]> = {};
    noteMap.forEach(note => {
        const arr = result[note.empresaId] || (result[note.empresaId] = []);
        arr.push(note);
    });
    return result;
};

// ─── PARSER XML ───────────────────────────────────────────────────────────────
const parseXmlNfe = (xmlContent: string): any[] => {
    try {
        const xmlDoc = new DOMParser().parseFromString(xmlContent, 'text/xml');
        if (xmlDoc.getElementsByTagName('parsererror').length > 0) return [];
        const notes: any[] = [];
        const nfeNodes = xmlDoc.getElementsByTagName('infNFe');
        for (let i = 0; i < nfeNodes.length; i++) {
            const n    = nfeNodes[i];
            if (!n) continue;
            const dhEmi = n.getElementsByTagName('dhEmi')[0]?.textContent ||
                          n.getElementsByTagName('dEmi')[0]?.textContent;
            const vNF   = n.getElementsByTagName('vNF')[0]?.textContent;
            const xNome = n.getElementsByTagName('emit')[0]
                           ?.getElementsByTagName('xNome')[0]?.textContent;
            if (dhEmi && vNF)
                notes.push({ data: dhEmi.split('T')[0], valor: parseFloat(vNF),
                             descricao: 'NFe Importada (XML)', origem: xNome || 'XML' });
        }
        return notes;
    } catch (e) { console.warn('parseXmlNfe fallback:', e); return []; }
};

// ─── IMPORT NOTAS ─────────────────────────────────────────────────────────────
export const parseAndSaveNotas = async (
    empresaId: string, file: File
): Promise<SimplesNacionalImportResult> => {
    const buffer   = await file.arrayBuffer();
    const fileType = file.name.toLowerCase();
    let extractedData: any[] = [];

    try {
        if (fileType.endsWith('.pdf')) {
            // ── Fluxo PGDAS-D: parser deterministico primeiro, Gemini fallback ──
            //
            // O parser le o PDF via pdfjs e extrai a secao "2.2 Receitas Brutas
            // Anteriores" com regex. Soma Mercado Interno + Externo por mes.
            // Validacao: soma dos 12 meses bate (+/- R$1) com o RBT12 declarado
            // no cabecalho 2.1. Se bater, usa parsed.
            //
            // Se NAO bater (PDF formato diferente, layout antigo), cai pra Gemini
            // com prompt corrigido. O Gemini ANTERIORMENTE pedia "RBT12" e
            // retornava o ACUMULADO 12m em cada mes (bug que motivou esse fix).
            let pgdasHistory: { periodo: string; valor: number }[] = [];

            const parsed = await parsePgdasExtrato(file).catch(() => null);
            if (parsed && parsed.bate && parsed.historico.length > 0) {
                console.info('[pgdas-import] parser deterministico ok:',
                    parsed.historico.length, 'meses, RBT12',
                    parsed.rbt12Calculado.toFixed(2), '~', parsed.rbt12Declarado?.toFixed(2));
                pgdasHistory = parsed.historico;
            } else {
                console.warn('[pgdas-import] parser nao validou — fallback Gemini.',
                    parsed ? `RBT12 declarado=${parsed.rbt12Declarado} calculado=${parsed.rbt12Calculado.toFixed(2)}` : '(falha)');
                const base64 = btoa(new Uint8Array(buffer)
                    .reduce((d, b) => d + String.fromCharCode(b), ''));
                pgdasHistory = await extractPgdasDataFromPdf(base64) || [];
            }

            if (pgdasHistory?.length > 0) {
                const empresas = await getEmpresas(
                    { id: 'temp', role: 'admin', name: '', email: '' } as any);
                const emp = empresas.find(e => e.id === empresaId);
                if (emp) {
                    const hist = { ...(emp.faturamentoManual || {}) };
                    let cnt = 0;
                    pgdasHistory.forEach((item: any) => {
                        const k = normalizarPeriodoPgdas(item.periodo);
                        const valor = normalizarValorPgdas(item.valor);
                        if (k && valor !== null) {
                            hist[k] = valor; cnt++;
                        }
                    });
                    if (cnt > 0) {
                        await updateEmpresa(empresaId, { faturamentoManual: hist });
                        return { successCount: cnt, failCount: 0,
                                 errors: [`PGDAS processado! ${cnt} meses atualizados.`],
                                 faturamentoManual: hist };
                    }
                }
            }
            const base64 = btoa(new Uint8Array(buffer)
                .reduce((d, b) => d + String.fromCharCode(b), ''));
            extractedData = await extractDocumentData(base64, 'application/pdf');

        } else if (fileType.endsWith('.xml')) {
            const xml = new TextDecoder('utf-8').decode(buffer);
            extractedData = parseXmlNfe(xml);
            if (extractedData.length === 0)
                extractedData = await extractDocumentData(
                    btoa(unescape(encodeURIComponent(xml))), 'text/xml');

        } else if (fileType.endsWith('.xlsx') || fileType.endsWith('.xls')) {
            const base64 = btoa(new Uint8Array(buffer)
                .reduce((d, b) => d + String.fromCharCode(b), ''));
            extractedData = await extractDocumentData(base64,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        } else {
            throw new Error('Formato de arquivo não suportado.');
        }
    } catch (e: any) {
        throw new Error('Erro no processamento: ' + e.message);
    }

    if (!extractedData?.length)
        return { successCount: 0, failCount: 0,
                 errors: ['Nenhum dado válido encontrado.'] };

    const uid = auth?.currentUser?.uid;
    const newNotes: SimplesNacionalNota[] = [];
    let success = 0;

    extractedData.forEach(item => {
        if (item.data && item.valor != null) {
            let dateVal = new Date(item.data).getTime();
            if (isNaN(dateVal) && typeof item.data === 'string') {
                const parts = item.data.split(/[\/\-]/);
                if (parts.length === 3)
                    dateVal = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`).getTime();
            }
            if (!isNaN(dateVal)) {
                newNotes.push({
                    id: generateUUID(), empresaId, data: dateVal,
                    valor: typeof item.valor === 'string'
                        ? parseFloat(item.valor.replace('R$','').replace('.','').replace(',','.'))
                        : item.valor,
                    descricao: item.descricao || 'Importado via IA',
                    origem: item.origem || fileType.toUpperCase().replace('.','') + ' Import'
                });
                success++;
            }
        }
    });

    // ── Cloud-first ──
    if (isFirebaseConfigured && db && uid) {
        const dbRef = db;  // narrow Firestore (não-null) escapa pra dentro da arrow
        await Promise.allSettled(newNotes.map(note =>
            setDoc(doc(dbRef, 'simples_notas', note.id), sanitizePayload({ ...note, createdBy: uid }))));
    }

    // ── Local cache ──
    const stored  = localStorage.getItem(STORAGE_KEY_NOTAS);
    const notasMap = stored ? JSON.parse(stored) : {};
    if (!notasMap[empresaId]) notasMap[empresaId] = [];
    notasMap[empresaId].push(...newNotes);
    localStorage.setItem(STORAGE_KEY_NOTAS, JSON.stringify(notasMap));

    return { successCount: success, failCount: extractedData.length - success, errors: [] };
};

// ─── FATURAMENTO / FOLHA ──────────────────────────────────────────────────────
export const updateFolha12 = (empresaId: string, value: number) =>
    updateEmpresa(empresaId, { folha12: value });

export const saveFaturamentoManual = (
    empresaId: string, faturamento: any, faturamentoDetalhado?: any
) => {
    const data: Partial<SimplesNacionalEmpresa> = { faturamentoManual: faturamento };
    if (faturamentoDetalhado) data.faturamentoMensalDetalhado = faturamentoDetalhado;
    return updateEmpresa(empresaId, data);
};

export const saveHistoricoCalculo = async (
    empresaId: string, resumo: SimplesNacionalResumo, mesRefDate: Date
) => {
    const mesStr = mesRefDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    const novoCalculo: SimplesHistoricoCalculo = {
        id: generateUUID(), dataCalculo: Date.now(), mesReferencia: mesStr,
        rbt12: resumo.rbt12, aliq_eff: resumo.aliq_eff, fator_r: resumo.fator_r,
        das_mensal: resumo.das_mensal, anexo_efetivo: resumo.anexo_efetivo
    };
    const empresas = await getEmpresas({ id: 'temp', role: 'admin', name: '', email: '' } as any);
    const emp = empresas.find(e => e.id === empresaId);
    return updateEmpresa(empresaId, {
        historicoCalculos: [...(emp?.historicoCalculos || []), novoCalculo]
    });
};

// ─── SUGESTÃO DE ANEXO ────────────────────────────────────────────────────────
export const sugerirAnexoPorCnae = (cnae: string): any => {
    const code = cnae.replace(/[^0-9]/g, '');
    if (code.startsWith('47')) return 'I';
    if (code.startsWith('10')) return 'II';
    if (code.startsWith('62')) return 'V';
    return 'III';
};

// ─── CÁLCULO (lógica fiscal inalterada) ───────────────────────────────────────
export const calcularResumoEmpresa = (
    empresa: SimplesNacionalEmpresa, notas: SimplesNacionalNota[],
    mesReferencia: Date, options?: any
): SimplesNacionalResumo => {
    const mesChave = `${mesReferencia.getFullYear()}-${(mesReferencia.getMonth()+1).toString().padStart(2,'0')}`;
    let rbt12Global = 0, rbt12Interno = 0, rbt12Externo = 0;
    const mensal: any          = empresa.faturamentoManual || {};
    const detalhadoHistorico   = empresa.faturamentoMensalDetalhado || {};
    const historico_simulado: SimplesCalculoMensal[] = [];

    const dataInicioRBT12 = new Date(mesReferencia.getFullYear(), mesReferencia.getMonth() - 12, 1);
    for (let i = 0; i < 12; i++) {
        const d = new Date(dataInicioRBT12.getFullYear(), dataInicioRBT12.getMonth() + i, 1);
        const k = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}`;
        const valTotalMes = mensal[k] || 0;
        rbt12Global += valTotalMes;

        if (detalhadoHistorico[k]) {
            let mesInterno = 0, mesExterno = 0;
            Object.values(detalhadoHistorico[k]).forEach((item: any) => {
                const valorItem = typeof item === 'number' ? item : item.valor;
                const isExt = typeof item === 'object' && item.isExterior === true;
                if (isExt) mesExterno += valorItem; else mesInterno += valorItem;
            });
            const diff = valTotalMes - (mesInterno + mesExterno);
            if (diff > 0.01) mesInterno += diff;
            rbt12Interno += mesInterno;
            rbt12Externo += mesExterno;
        } else {
            rbt12Interno += valTotalMes;
        }

        historico_simulado.push({
            competencia: k,
            label: d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }),
            faturamento: valTotalMes, rbt12: 0, aliquotaEfetiva: 0,
            fatorR: 0, dasCalculado: 0, anexoAplicado: empresa.anexo
        });
    }

    // ─── RBT12 proporcionalizado para empresa em início de atividade ─────────
    // LC 123/06 art. 18 §2º + Resolução CGSN 140/2018 art. 21:
    //   • 1º mês de atividade: RBT12 = receita do próprio PA × 12
    //   • 2º ao 11º mês:       RBT12 = (Σ receitas anteriores / nº meses) × 12
    //   • A partir do 12º mês: RBT12 normal (12 meses anteriores).
    let inicioAtividade = false;
    let mesesAtividade = 12;
    let rbt12pInterno = rbt12Interno;
    let rbt12pExterno = rbt12Externo;
    let rbt12pGlobal = rbt12Global;

    if (empresa.dataAbertura) {
        const ab = new Date(empresa.dataAbertura + 'T00:00:00');
        if (!isNaN(ab.getTime())) {
            const mesAb = new Date(ab.getFullYear(), ab.getMonth(), 1);
            const mesAntPA = new Date(mesReferencia.getFullYear(), mesReferencia.getMonth() - 1, 1);
            const diff =
                (mesAntPA.getFullYear() - mesAb.getFullYear()) * 12 +
                (mesAntPA.getMonth() - mesAb.getMonth()) + 1;
            if (diff < 12) {
                inicioAtividade = true;
                mesesAtividade = Math.max(diff, 0);
                if (mesesAtividade === 0) {
                    // Primeiro mês: usa receita do próprio PA × 12.
                    const receitaPA = mensal[mesChave] || 0;
                    rbt12pGlobal = receitaPA * 12;
                    rbt12pInterno = receitaPA * 12; // simplificação: assume mercado interno
                    rbt12pExterno = 0;
                } else {
                    rbt12pInterno = (rbt12Interno / mesesAtividade) * 12;
                    rbt12pExterno = (rbt12Externo / mesesAtividade) * 12;
                    rbt12pGlobal = (rbt12Global / mesesAtividade) * 12;
                }
            }
        }
    }

    // Folha dos ultimos 12 meses para Fator R (LC 123/06 art. 18 §5o-M).
    // Preferencia: serie mensal `folhaMensal` (janela movel correta).
    // Fallback: `folha12` (valor unico legado).
    let folha12Calculada = 0;
    if (empresa.folhaMensal && Object.keys(empresa.folhaMensal).length > 0) {
        for (let i = 0; i < 12; i++) {
            const d = new Date(dataInicioRBT12.getFullYear(), dataInicioRBT12.getMonth() + i, 1);
            const k = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            folha12Calculada += empresa.folhaMensal[k] || 0;
        }
    } else {
        folha12Calculada = empresa.folha12 || 0;
    }
    let fator_r = rbt12Global > 0 ? folha12Calculada / rbt12Global : 0;
    if (options?.fatorRManual != null && !isNaN(options.fatorRManual))
        fator_r = options.fatorRManual;

    let itensCalculo: SimplesItemCalculo[] = options?.itensCalculo || [];

    if (itensCalculo.length === 0) {
        const detalheSalvo = empresa.faturamentoMensalDetalhado?.[mesChave] || {};
        const entries = Object.entries(detalheSalvo);
        if (entries.length > 0) {
            entries.forEach(([key, value]) => {
                if (key === 'icms_vendas') return;
                const parts = key.split('::');
                let cnaeCode = '', anexoCode = '';
                if (parts.length >= 4) { cnaeCode = parts[2] || ''; anexoCode = parts[3] || ''; }
                else if (key.startsWith('filial_')) {
                    const tipo = key.split('_')[1] || '';
                    cnaeCode = `Filial ${tipo.charAt(0).toUpperCase()+tipo.slice(1)}`;
                    if (tipo === 'comercio') anexoCode = 'I';
                    else if (tipo === 'industria') anexoCode = 'II';
                    else anexoCode = empresa.anexo === 'III_V'
                        ? (fator_r >= 0.28 ? 'III' : 'V') : empresa.anexo;
                } else {
                    const s = key.split('_');
                    if (s.length >= 2) { cnaeCode = s[0] || ''; anexoCode = s[1] || ''; }
                }
                if (typeof value === 'object' && value !== null) {
                    const item = value as SimplesDetalheItem;
                    itensCalculo.push({ cnae: cnaeCode, anexo: anexoCode as SimplesNacionalAnexo,
                        valor: item.valor, issRetido: item.issRetido, icmsSt: item.icmsSt,
                        isSup: item.isSup, isMonofasico: item.isMonofasico,
                        isImune: item.isImune, isExterior: item.isExterior });
                } else if (typeof value === 'number') {
                    itensCalculo.push({ cnae: cnaeCode, anexo: anexoCode as SimplesNacionalAnexo,
                        valor: value, issRetido: false, icmsSt: false, isSup: false,
                        isMonofasico: false, isImune: false, isExterior: false });
                }
            });
        } else {
            const faturamentoTotalMes = mensal[mesChave] || 0;
            if (faturamentoTotalMes > 0)
                itensCalculo.push({ cnae: empresa.cnae, anexo: empresa.anexo,
                    valor: faturamentoTotalMes, issRetido: false, icmsSt: false,
                    isSup: false, isMonofasico: false, isImune: false, isExterior: false });
        }
    }

    let dasTotal = 0, faturamentoTotalMes = 0,
        totalMercadoInterno = 0, totalMercadoExterno = 0;
    const detalhamentoAnexos: DetalhamentoAnexo[] = [];

    itensCalculo.forEach(item => {
        faturamentoTotalMes += item.valor;
        if (item.isExterior) totalMercadoExterno += item.valor;
        else totalMercadoInterno += item.valor;

        let anexoAplicado = item.anexo;
        const anexoOriginal = item.anexo;
        if (anexoAplicado === 'V' && fator_r >= 0.28) anexoAplicado = 'III';
        else if (anexoAplicado === 'III_V') anexoAplicado = fator_r >= 0.28 ? 'III' : 'V';

        const tabela = ANEXOS_TABELAS[anexoAplicado as AnexoKey];
        if (!tabela) return;

        // Em início de atividade, usa RBT12 proporcionalizado para enquadramento e alíquota.
        const rbtParaEnquadramento = item.isExterior
            ? (inicioAtividade ? rbt12pExterno : rbt12Externo)
            : (inicioAtividade ? rbt12pInterno : rbt12Interno);
        let faixaIndex = tabela.findIndex((f: any) => rbtParaEnquadramento <= f.limite);
        if (faixaIndex === -1 && rbtParaEnquadramento > 0) faixaIndex = tabela.length - 1;
        if (rbtParaEnquadramento === 0) faixaIndex = 0;
        const faixa = tabela[faixaIndex];

        const tabFirst = tabela[0];
        let aliq_eff_item = rbtParaEnquadramento > 0 && faixa
            ? (((rbtParaEnquadramento * faixa.aliquota / 100) - faixa.parcela)
               / rbtParaEnquadramento) * 100
            : (tabFirst ? tabFirst.aliquota : 0);

        let percentualReducao = 0;
        const faixaIdxClamped = Math.max(0, Math.min(faixaIndex, 5)) as FaixaIndex;
        const reparticao = REPARTICAO_IMPOSTOS[anexoAplicado as AnexoKey]?.[faixaIdxClamped];
        if (reparticao) {
            if (item.isImune) {
                if (reparticao.ICMS) percentualReducao += reparticao.ICMS;
                if (reparticao.IPI)  percentualReducao += reparticao.IPI;
            } else if (item.isExterior) {
                (['PIS','COFINS','ISS','ICMS','IPI'] as const).forEach(t => {
                    const v = reparticao[t];
                    if (v) percentualReducao += v;
                });
            } else {
                if (item.issRetido || item.isSup) {
                    percentualReducao += anexoAplicado === 'V' ? 23.5 : (reparticao.ISS || 0);
                }
                if (item.icmsSt     && reparticao.ICMS)   percentualReducao += reparticao.ICMS;
                if (item.isMonofasico) {
                    if (reparticao.PIS)    percentualReducao += reparticao.PIS;
                    if (reparticao.COFINS) percentualReducao += reparticao.COFINS;
                }
            }
        }

        const aliq_final   = Math.max(0, aliq_eff_item * (1 - percentualReducao / 100));
        const valorDasItem = (item.valor * aliq_final) / 100;
        dasTotal += valorDasItem;

        detalhamentoAnexos.push({
            cnae: item.cnae, anexo: anexoAplicado as any,
            anexoOriginal, faturamento: item.valor,
            aliquotaNominal: faixa?.aliquota ?? 0, aliquotaEfetiva: aliq_final,
            valorDas: valorDasItem, issRetido: item.issRetido, icmsSt: item.icmsSt,
            isMonofasico: item.isMonofasico, isImune: item.isImune, isExterior: item.isExterior
        });
    });

    const aliq_eff_global = faturamentoTotalMes > 0
        ? (dasTotal / faturamentoTotalMes) * 100 : 0;

    const tabelaPrincipal = ANEXOS_TABELAS[
        empresa.anexo === 'III_V' ? (fator_r >= 0.28 ? 'III' : 'V') : empresa.anexo];
    const rbtPrincipalParaEnquadramento = inicioAtividade ? rbt12pGlobal : rbt12Global;
    let faixaIndexPrincipal = 0;
    if (tabelaPrincipal) {
        faixaIndexPrincipal = tabelaPrincipal.findIndex((f: any) => rbtPrincipalParaEnquadramento <= f.limite);
        if (faixaIndexPrincipal === -1 && rbtPrincipalParaEnquadramento > 0) faixaIndexPrincipal = 5;
    }

    return {
        rbt12: rbt12Global, rbt12Interno, rbt12Externo,
        inicioAtividade, mesesAtividade,
        rbt12pInterno: inicioAtividade ? rbt12pInterno : undefined,
        rbt12pExterno: inicioAtividade ? rbt12pExterno : undefined,
        aliq_nom: tabelaPrincipal && tabelaPrincipal[faixaIndexPrincipal] ? tabelaPrincipal[faixaIndexPrincipal]!.aliquota : 0,
        aliq_eff: aliq_eff_global, das: dasTotal * 12, das_mensal: dasTotal, mensal,
        historico_simulado, anexo_efetivo: empresa.anexo, fator_r,
        folha_12: folha12Calculada, ultrapassou_sublimite: rbt12Global > 3600000,
        faixa_index: faixaIndexPrincipal, detalhamento_anexos: detalhamentoAnexos,
        totalMercadoInterno, totalMercadoExterno,
        alertas_faturamento: calcularAlertasFaturamento(
            rbt12Global, rbtPrincipalParaEnquadramento, tabelaPrincipal, faixaIndexPrincipal,
        ),
    };
};

// ─── Alertas de faturamento (LC 123/2006) ─────────────────────────────────
// Constantes oficiais. NAO mexer sem cruzar com a LC e a Resolucao CGSN
// vigente — esses numeros determinam vedacao ao Simples e desenquadramento.

/** Sublimite estadual ICMS/ISS — LC 123 art. 13-A. */
const SUBLIMITE_ICMS_ISS = 3_600_000;
/** Limite federal do Simples Nacional — LC 123 art. 3º, II. */
const LIMITE_FEDERAL_SIMPLES = 4_800_000;
/** Excesso > 20% do limite federal — LC 123 art. 30 §1º II (R$ 5.760.000). */
const EXCESSO_20_PCT_LIMITE = LIMITE_FEDERAL_SIMPLES * 1.20;
/** Zona de alerta de aproximação (90% do limite federal). */
const ALERTA_PROXIMO_LIMITE = LIMITE_FEDERAL_SIMPLES * 0.90;
/** Empresa nos últimos 10% da faixa de alíquota atual. */
const ALERTA_PROXIMA_FAIXA_PCT = 0.10;

function calcularAlertasFaturamento(
    rbt12Global: number,
    rbtParaEnquadramento: number,
    tabelaPrincipal: any[],
    faixaIndex: number,
): import('../types').AlertasFaturamentoSimples {
    const ultrapassouLimiteFederal = rbt12Global > LIMITE_FEDERAL_SIMPLES;
    const margemAteLimite = LIMITE_FEDERAL_SIMPLES - rbt12Global;

    let proximaMudancaFaixa: ReturnType<typeof calcularAlertasFaturamento>['proxima_mudanca_faixa'] = null;
    if (!ultrapassouLimiteFederal && tabelaPrincipal && faixaIndex >= 0 && faixaIndex < 5) {
        const limiteFaixaAtual = tabelaPrincipal[faixaIndex].limite;
        const zonaAlerta = limiteFaixaAtual * (1 - ALERTA_PROXIMA_FAIXA_PCT);
        if (rbtParaEnquadramento >= zonaAlerta) {
            proximaMudancaFaixa = {
                aliquota_nominal_proxima: tabelaPrincipal[faixaIndex + 1].aliquota,
                limite_faixa_atual: limiteFaixaAtual,
                margem_ate_proxima_faixa: limiteFaixaAtual - rbtParaEnquadramento,
            };
        }
    }

    return {
        sublimite_icms_iss: {
            atingido: rbt12Global > SUBLIMITE_ICMS_ISS,
            valor_limite: SUBLIMITE_ICMS_ISS,
        },
        limite_federal: {
            atingido: ultrapassouLimiteFederal,
            valor_limite: LIMITE_FEDERAL_SIMPLES,
        },
        excesso_maior_20_pct: {
            atingido: rbt12Global > EXCESSO_20_PCT_LIMITE,
            valor_limite: EXCESSO_20_PCT_LIMITE,
        },
        proximo_limite_federal: {
            atingido: !ultrapassouLimiteFederal && rbt12Global > ALERTA_PROXIMO_LIMITE,
            valor_alerta: ALERTA_PROXIMO_LIMITE,
            margem_ate_limite: margemAteLimite,
        },
        proxima_mudanca_faixa: proximaMudancaFaixa,
    };
}

export const calcularDiscriminacaoImpostos = (
    anexo: string, faixaIndex: number, valorDas: number
) => {
    const faixaClamped = Math.max(0, Math.min(faixaIndex, 5)) as FaixaIndex;
    const dist = REPARTICAO_IMPOSTOS[anexo as AnexoKey]?.[faixaClamped];
    if (!dist || valorDas === 0) return {};
    return Object.fromEntries(
        Object.entries(dist).map(([imp, pct]) => [imp, valorDas * ((pct as number) / 100)])
    );
};
