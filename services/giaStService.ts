/**
 * services/giaStService.ts
 *
 * GIA-ST — Guia Nacional de Informação e Apuração do ICMS-ST (Ajuste SINIEF
 * 04/93). Uma guia por CNPJ × UF favorecida × competência.
 *
 * Numeração dos campos segue o aplicativo GIA-ST 3 da SEFAZ-RS (aba Valores,
 * campos 7-21 + 39). Campos 18/20/21 são CALCULADOS aqui com a mesma regra do
 * aplicativo:
 *   saldo = c13 − c14 − c15 − c16 − c17
 *   saldo ≥ 0 → c18 = saldo, c20 = 0
 *   saldo < 0 → c18 = 0,     c20 = |saldo|  (crédito p/ período seguinte)
 *   c21 (total a recolher) = c18 + c19 + c39
 */

import {
    collection, doc, getDocs, query, setDoc, deleteDoc, serverTimestamp, where,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebaseConfig';
import type { User } from '../types';

function ensureDb() {
    if (!isFirebaseConfigured || !db) throw new Error('Firestore não configurado.');
    return db;
}

export const COL_GIA_ST = 'gia_st_guias';

export const UFS_BRASIL = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const;

export interface GiaStValores {
    /** 7. Valor dos Produtos */
    c7ValorProdutos: number;
    /** 8. Valor do IPI */
    c8ValorIpi: number;
    /** 9. Despesas Acessórias */
    c9DespesasAcessorias: number;
    /** 10. Base de Cálculo do ICMS Próprio */
    c10BcIcmsProprio: number;
    /** 11. ICMS Próprio */
    c11IcmsProprio: number;
    /** 12. Base de Cálculo ICMS-ST */
    c12BcIcmsSt: number;
    /** 13. ICMS Retido por ST */
    c13IcmsRetidoSt: number;
    /** 14. ICMS de Devolução de Mercadoria (Anexo I) */
    c14IcmsDevolucao: number;
    /** 15. ICMS de Ressarcimentos (Anexo II) */
    c15IcmsRessarcimentos: number;
    /** 16. Crédito de Período Anterior */
    c16CreditoPeriodoAnterior: number;
    /** 17. Pagamentos Antecipados */
    c17PagamentosAntecipados: number;
    /** 19. Repasse ICMS Retido por Refinarias/Complementos */
    c19RepasseRefinarias: number;
    /** 39. Repasse ICMS Retido por Outros Contribuintes */
    c39RepasseOutros: number;
}

export interface GiaStCalculada {
    /** 18. ICMS-ST Devido */
    c18IcmsStDevido: number;
    /** 20. Crédito para Período Seguinte */
    c20CreditoPeriodoSeguinte: number;
    /** 21. Total do ICMS-ST a Recolher */
    c21TotalRecolher: number;
}

export interface GiaStGuia extends GiaStValores, GiaStCalculada {
    id: string;                    // `${cnpj}_${uf}_${aaaamm}`
    empresaCnpj: string;           // só dígitos
    empresaNome: string;
    ufFavorecida: string;
    inscricaoEstadualUfFavorecida: string;
    competencia: string;           // AAAA-MM
    semMovimento: boolean;
    retificacao: boolean;
    dataVencimento: string;        // AAAA-MM-DD ou ''
    informacoesComplementares: string;
    /** Valores da UF no relatório Office Fiscal que serviram de base (auditoria). */
    origemRelatorio: {
        saidas?: { valorContabil: number; baseCalculo: number; valorIcms: number; bcIcmsRetido: number; icmsRetidoFonte: number };
        entradas?: { valorContabil: number; baseCalculo: number; valorIcms: number; bcIcmsRetido: number; icmsRetidoFonte: number };
    } | null;
    inconsistencias: string[];
    criadoPor?: string;
    atualizadoEm?: unknown;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcularGiaSt(v: GiaStValores): GiaStCalculada {
    const saldo = round2(
        v.c13IcmsRetidoSt - v.c14IcmsDevolucao - v.c15IcmsRessarcimentos
        - v.c16CreditoPeriodoAnterior - v.c17PagamentosAntecipados,
    );
    const c18IcmsStDevido = saldo >= 0 ? saldo : 0;
    const c20CreditoPeriodoSeguinte = saldo < 0 ? round2(-saldo) : 0;
    const c21TotalRecolher = round2(c18IcmsStDevido + v.c19RepasseRefinarias + v.c39RepasseOutros);
    return { c18IcmsStDevido, c20CreditoPeriodoSeguinte, c21TotalRecolher };
}

/**
 * Validações no espírito da aba "Inconsistências" do aplicativo GIA-ST 3 —
 * a ideia é a guia já chegar lá válida, sem retrabalho.
 */
export function validarGiaSt(g: Omit<GiaStGuia, 'inconsistencias'>): string[] {
    const erros: string[] = [];
    const camposValor: Array<[keyof GiaStValores, string]> = [
        ['c7ValorProdutos', '7. Valor dos Produtos'],
        ['c8ValorIpi', '8. Valor do IPI'],
        ['c9DespesasAcessorias', '9. Despesas Acessórias'],
        ['c10BcIcmsProprio', '10. BC do ICMS Próprio'],
        ['c11IcmsProprio', '11. ICMS Próprio'],
        ['c12BcIcmsSt', '12. BC ICMS-ST'],
        ['c13IcmsRetidoSt', '13. ICMS Retido por ST'],
        ['c14IcmsDevolucao', '14. ICMS de Devolução'],
        ['c15IcmsRessarcimentos', '15. ICMS de Ressarcimentos'],
        ['c16CreditoPeriodoAnterior', '16. Crédito de Período Anterior'],
        ['c17PagamentosAntecipados', '17. Pagamentos Antecipados'],
        ['c19RepasseRefinarias', '19. Repasse Refinarias'],
        ['c39RepasseOutros', '39. Repasse Outros Contribuintes'],
    ];
    for (const [campo, label] of camposValor) {
        const valor = g[campo];
        if (!Number.isFinite(valor) || valor < 0) erros.push(`${label}: valor inválido (${valor}).`);
    }
    if (!UFS_BRASIL.includes(g.ufFavorecida as any)) erros.push(`UF favorecida inválida: "${g.ufFavorecida}".`);
    if (!/^\d{4}-\d{2}$/.test(g.competencia)) erros.push(`Competência inválida: "${g.competencia}" (esperado AAAA-MM).`);
    if (g.empresaCnpj.replace(/\D/g, '').length !== 14) erros.push('CNPJ da empresa inválido.');

    if (g.semMovimento) {
        const temValor = camposValor.some(([campo]) => (g[campo] || 0) > 0);
        if (temValor) erros.push('GIA-ST marcada como "sem movimento" mas há valores preenchidos.');
    } else {
        if (!g.inscricaoEstadualUfFavorecida.trim()) {
            erros.push('Inscrição Estadual na UF favorecida não informada (obrigatória — cadastro de Contribuinte no GIA-ST 3).');
        }
        if (g.c12BcIcmsSt > 0 && g.c13IcmsRetidoSt <= 0) {
            erros.push('12. BC ICMS-ST > 0 mas 13. ICMS Retido por ST = 0 — confira a retenção.');
        }
        if (g.c13IcmsRetidoSt > 0 && g.c12BcIcmsSt <= 0) {
            erros.push('13. ICMS Retido por ST > 0 mas 12. BC ICMS-ST = 0 — confira a base.');
        }
        if (g.c21TotalRecolher > 0 && !g.dataVencimento) {
            erros.push('Total a recolher > 0 sem data de vencimento do ICMS-ST.');
        }
    }
    return erros;
}

export function montarIdGuia(cnpj: string, uf: string, competencia: string): string {
    return `${cnpj.replace(/\D/g, '')}_${uf.toUpperCase()}_${competencia.replace('-', '')}`;
}

export async function salvarGiaSt(guia: GiaStGuia, user: User): Promise<void> {
    const ref = doc(ensureDb(), COL_GIA_ST, guia.id);
    await setDoc(ref, {
        ...guia,
        criadoPor: user.email || user.id || 'desconhecido',
        atualizadoEm: serverTimestamp(),
    }, { merge: true });
}

export async function listarGiaStPorCnpj(cnpj: string): Promise<GiaStGuia[]> {
    const cnpjNum = cnpj.replace(/\D/g, '');
    const q = query(collection(ensureDb(), COL_GIA_ST), where('empresaCnpj', '==', cnpjNum));
    const snap = await getDocs(q);
    const guias = snap.docs.map(d => d.data() as GiaStGuia);
    guias.sort((a, b) => (b.competencia + b.ufFavorecida).localeCompare(a.competencia + a.ufFavorecida));
    return guias;
}

export async function excluirGiaSt(id: string): Promise<void> {
    await deleteDoc(doc(ensureDb(), COL_GIA_ST, id));
}
