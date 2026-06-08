/**
 * invoicesManuaisService — invoices lancadas manualmente, por empresa+periodo.
 *
 * Para o caso de invoices que NAO vieram no PDF do E-Fiscal mas que precisam
 * entrar na analise de credito (ex: invoices de fornecedores estrangeiros).
 *
 * Doc na colecao `invoices_manuais`:
 *   { empresaId, periodo, emissao, numero, serie, cnpjCpf, razaoSocial,
 *     valorNf, baseCalculo, aliquota, valorIss, issRetido, criadoPor, criadoEm }
 *
 * `periodo` e normalizado para "MM/AAAA" (ex: "04/2026") — isso garante que
 * uma invoice lancada em abril/2026 aparece em qualquer PDF do mesmo mes,
 * independente do intervalo de datas escolhido no relatorio.
 *
 * Regras Firestore: leitura e escrita para qualquer usuario logado.
 */
import {
    collection,
    addDoc,
    deleteDoc,
    doc,
    getDocs,
    query,
    where,
    serverTimestamp,
    updateDoc,
    limit as fbLimit,
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebaseConfig';

const COLLECTION = 'invoices_manuais';

export interface InvoiceManual {
    id: string;
    empresaId: string;
    periodo: string;        // "MM/AAAA"
    emissao: string;
    numero: string;
    serie: string;
    cnpjCpf: string;
    razaoSocial: string;
    valorNf: number;
    baseCalculo: number;
    aliquota: number;
    valorIss: number;
    issRetido: number;
    /**
     * Categoria fixada para ESTA invoice individualmente (override por id,
     * nao por CNPJ). Quando preenchida, sobrepoe a classificacao automatica
     * (pela razao social) e ignora os overrides por CNPJ.
     *
     * Caso de uso primario: invoices estrangeiras (CNPJ 00000000000000)
     * onde o CNPJ-zero agruparia varias empresas distintas (Twilio, OpenAI,
     * Atlassian etc), e cada uma precisa de classificacao independente.
     *
     * Quando vazia/undefined: cai na classificacao automatica.
     */
    categoria?: string;
    criadoPor: string | null;
}

export interface NovaInvoice {
    empresaId: string;
    periodo: string;
    emissao: string;
    numero: string;
    serie?: string;
    cnpjCpf: string;
    razaoSocial: string;
    valorNf: number;
    baseCalculo: number;
    aliquota?: number;
    valorIss?: number;
    issRetido?: number;
}

/**
 * Normaliza qualquer formato de periodo para "MM/AAAA".
 * Aceita "01/04/2026 a 30/04/2026", "04/2026", "abril/2026", etc.
 */
export function normalizarPeriodo(periodo: string): string {
    if (!periodo) return '';
    // Tenta achar dd/mm/aaaa ou mm/aaaa
    const m = periodo.match(/(\d{1,2})\/(\d{4})/);
    if (m) {
        const mes = (m[1] || '').padStart(2, '0');
        return `${mes}/${m[2] || ''}`;
    }
    // Tenta dd/mm/aaaa a dd/mm/aaaa — pega o primeiro mes
    const m2 = periodo.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m2) {
        const mes = (m2[2] || '').padStart(2, '0');
        return `${mes}/${m2[3] || ''}`;
    }
    return periodo;
}

/**
 * Lista as invoices manuais de uma empresa+periodo.
 */
export async function listarInvoicesManuais(
    empresaId: string,
    periodo: string,
): Promise<InvoiceManual[]> {
    if (!isFirebaseConfigured || !empresaId) return [];
    const p = normalizarPeriodo(periodo);
    try {
        const snap = await getDocs(query(
            collection(db, COLLECTION),
            where('empresaId', '==', empresaId),
            where('periodo', '==', p),
            fbLimit(500),
        ));
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<InvoiceManual, 'id'>) }));
    } catch (e) {
        console.error('[invoicesManuais] listar:', e);
        return [];
    }
}

/**
 * Adiciona uma nova invoice manual.
 */
export async function adicionarInvoice(
    nova: NovaInvoice,
): Promise<{ ok: boolean; id?: string; error?: string }> {
    if (!isFirebaseConfigured) return { ok: false, error: 'Firebase nao configurado' };
    if (!nova.empresaId || !nova.periodo) {
        return { ok: false, error: 'empresaId e periodo obrigatorios' };
    }
    try {
        const ref = await addDoc(collection(db, COLLECTION), {
            empresaId: nova.empresaId,
            periodo: normalizarPeriodo(nova.periodo),
            emissao: nova.emissao || '',
            numero: nova.numero || '',
            serie: nova.serie || '',
            cnpjCpf: nova.cnpjCpf,
            razaoSocial: nova.razaoSocial,
            valorNf: Number(nova.valorNf) || 0,
            baseCalculo: Number(nova.baseCalculo) || 0,
            aliquota: Number(nova.aliquota) || 0,
            valorIss: Number(nova.valorIss) || 0,
            issRetido: Number(nova.issRetido) || 0,
            criadoPor: auth?.currentUser?.uid || null,
            criadoEm: serverTimestamp(),
        });
        return { ok: true, id: ref.id };
    } catch (e) {
        console.error('[invoicesManuais] adicionar:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}

/**
 * Remove uma invoice manual pelo ID.
 */
export async function removerInvoice(invoiceId: string): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured || !invoiceId) {
        return { ok: false, error: 'invoiceId obrigatorio' };
    }
    try {
        await deleteDoc(doc(db, COLLECTION, invoiceId));
        return { ok: true };
    } catch (e) {
        console.error('[invoicesManuais] remover:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}

/**
 * Define (ou limpa) a categoria fixada de UMA invoice individualmente.
 *
 * Diferente de salvarRegra() (categorias_fornecedor) que casa por CNPJ:
 * essa funcao salva o campo `categoria` direto no doc da invoice. Necessario
 * pra invoices com CNPJ 00000000000000 (estrangeiras), que de outro modo
 * compartilhariam o mesmo override por CNPJ.
 *
 * @param invoiceId  id do doc em invoices_manuais
 * @param categoria  string da categoria, ou null/'' para LIMPAR (volta a
 *                   classificacao automatica pela razao social)
 */
export async function atualizarCategoriaInvoice(
    invoiceId: string,
    categoria: string | null,
): Promise<{ ok: boolean; error?: string }> {
    if (!isFirebaseConfigured || !invoiceId) {
        return { ok: false, error: 'invoiceId obrigatorio' };
    }
    try {
        // String vazia ou null: armazena como '' pra desfazer (mais simples que deleteField).
        await updateDoc(doc(db, COLLECTION, invoiceId), {
            categoria: categoria || '',
        });
        return { ok: true };
    } catch (e) {
        console.error('[invoicesManuais] atualizarCategoriaInvoice:', e);
        return { ok: false, error: e instanceof Error ? e.message : 'erro' };
    }
}
