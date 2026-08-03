/**
 * spedCiapService.ts — cadastro do CIAP (Bloco G da EFD ICMS/IPI).
 *
 * Coleção `sped_ciap_bens`, doc {empresaId}. Diferente dos ajustes E111, o CIAP
 * NÃO é por competência: o bem atravessa 48 meses e o que muda mês a mês é o
 * número da parcela. Por isso o cadastro é do bem, e a apuração do período é
 * calculada na hora de gerar o arquivo (sped-bloco-g.js, mesma régua).
 */
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, isFirebaseConfigured, auth } from './firebaseConfig';

export interface BemCiap {
    codigo: string;
    descricao: string;
    tipo: 'bem' | 'componente';
    codigoBemPrincipal?: string;
    dataMovimentacao: string;      // YYYY-MM-DD
    tipoMovimentacao: string;      // SI, IM, IA, CI, MC, BA, AT, PE, OT
    creditoIcmsProprio: number;
    creditoIcmsSt: number;
    creditoIcmsFrete: number;
    creditoIcmsDifal: number;
    numeroParcela: number;         // 1..48
    funcao?: string;
}

export interface CiapDoc {
    empresaId: string;
    empresaCnpj?: string;
    bens: BemCiap[];
    saldoInicial: number;
    outrosCreditos: number;
    /** Quando informados, VENCEM as saídas derivadas das notas do período. */
    saidasTributadasManual?: number | null;
    saidasTotaisManual?: number | null;
}

const VAZIO: CiapDoc = {
    empresaId: '', bens: [], saldoInicial: 0, outrosCreditos: 0,
    saidasTributadasManual: null, saidasTotaisManual: null,
};

const n2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

export async function carregarCiap(empresaId: string): Promise<CiapDoc> {
    if (!isFirebaseConfigured || !db || !empresaId) return { ...VAZIO, empresaId };
    const snap = await getDoc(doc(db, 'sped_ciap_bens', empresaId));
    if (!snap.exists()) return { ...VAZIO, empresaId };
    const d = snap.data() as any;
    return {
        empresaId,
        empresaCnpj: d.empresaCnpj || '',
        bens: Array.isArray(d.bens) ? d.bens : [],
        saldoInicial: Number(d.saldoInicial) || 0,
        outrosCreditos: Number(d.outrosCreditos) || 0,
        saidasTributadasManual: d.saidasTributadasManual ?? null,
        saidasTotaisManual: d.saidasTotaisManual ?? null,
    };
}

export async function salvarCiap(p: CiapDoc): Promise<void> {
    if (!isFirebaseConfigured || !db) throw new Error('Firebase não configurado.');
    await setDoc(doc(db, 'sped_ciap_bens', p.empresaId), {
        empresaId: p.empresaId,
        empresaCnpj: String(p.empresaCnpj || '').replace(/\D/g, ''),
        bens: (p.bens || []).map(b => ({
            codigo: String(b.codigo || '').trim(),
            descricao: String(b.descricao || '').trim(),
            tipo: b.tipo === 'componente' ? 'componente' : 'bem',
            codigoBemPrincipal: String(b.codigoBemPrincipal || '').trim(),
            dataMovimentacao: String(b.dataMovimentacao || '').trim(),
            tipoMovimentacao: String(b.tipoMovimentacao || 'SI').trim().toUpperCase(),
            creditoIcmsProprio: n2(b.creditoIcmsProprio),
            creditoIcmsSt: n2(b.creditoIcmsSt),
            creditoIcmsFrete: n2(b.creditoIcmsFrete),
            creditoIcmsDifal: n2(b.creditoIcmsDifal),
            numeroParcela: Math.trunc(Number(b.numeroParcela) || 0),
            funcao: String(b.funcao || '').trim(),
        })),
        saldoInicial: n2(p.saldoInicial),
        outrosCreditos: n2(p.outrosCreditos),
        // null = deriva das notas do período (o normal). Número = a equipe
        // informou à mão e esse valor vence.
        saidasTributadasManual: p.saidasTributadasManual == null ? null : n2(p.saidasTributadasManual),
        saidasTotaisManual: p.saidasTotaisManual == null ? null : n2(p.saidasTotaisManual),
        atualizadoPor: auth?.currentUser?.email || auth?.currentUser?.uid || null,
        atualizadoEm: serverTimestamp(),
    }, { merge: true });
}

/**
 * Avança a parcela de todos os bens ativos em 1 (fim de mês). Bem que chegou
 * na 48ª sai da lista de apropriação — vira baixa (BA), como manda o CIAP.
 */
export function avancarParcelas(bens: BemCiap[]): BemCiap[] {
    return (bens || []).map(b => {
        const parcela = Number(b.numeroParcela) || 0;
        if (parcela >= 48) return { ...b, tipoMovimentacao: 'BA' };
        if (['BA', 'AT', 'PE', 'OT'].includes(String(b.tipoMovimentacao || '').toUpperCase())) return b;
        return { ...b, numeroParcela: parcela + 1 };
    });
}
