/**
 * services/nfseSpCapturadasService.ts
 *
 * Lista NFSe SP capturadas via cron noturno (CSV portal nfe.prefeitura.sp.gov.br)
 * direto do Firestore. Filtros: empresa, período, direção (emitidas/recebidas),
 * busca por número/prestador/tomador.
 */

import {
    collection, getDocs, query, where, orderBy, limit as fbLimit,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebaseConfig';

export interface NfseSpCapturada {
    id: string;
    numero: string;
    codigoVerificacao?: string;
    dhEmi?: string;
    competencia?: string;
    direcao: 'entrada' | 'saida';
    status: string;
    situacao?: string;
    prestadorCnpj?: string;
    prestadorNome?: string;
    prestadorCcm?: string;
    tomadorCnpj?: string;
    tomadorNome?: string;
    valorServicos?: number;
    valorTotal?: number;
    issDevido?: number;
    codigoServico?: string;
    descricao?: string;
    fonte?: string;
    importadoEm?: any;
}

export interface NfseSpFiltros {
    empresaCnpj?: string;     // CNPJ do escritório/empresa
    direcao?: 'entrada' | 'saida' | 'todas';
    dataInicio?: string;       // 'YYYY-MM-DD'
    dataFim?: string;
    limite?: number;
}

export async function listarNfseSpCapturadas(filtros: NfseSpFiltros = {}): Promise<NfseSpCapturada[]> {
    if (!isFirebaseConfigured || !db) return [];
    const lim = filtros.limite || 500;
    const constraints: any[] = [
        where('tipoDoc', '==', 'NFSe'),
        where('fonte', '==', 'csv-portal-sp'),
    ];
    if (filtros.empresaCnpj && filtros.empresaCnpj.length === 14) {
        constraints.push(where('empresaCnpj', '==', filtros.empresaCnpj));
    }
    if (filtros.direcao && filtros.direcao !== 'todas') {
        constraints.push(where('direcao', '==', filtros.direcao));
    }
    if (filtros.dataInicio) {
        constraints.push(where('dhEmi', '>=', `${filtros.dataInicio}T00:00:00`));
    }
    if (filtros.dataFim) {
        constraints.push(where('dhEmi', '<=', `${filtros.dataFim}T23:59:59`));
    }
    constraints.push(orderBy('dhEmi', 'desc'));
    constraints.push(fbLimit(lim));

    try {
        const q = query(collection(db, 'documentos_fiscais'), ...constraints);
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as NfseSpCapturada));
    } catch (e: any) {
        // Provavelmente índice composto faltando — degrade pra query mais simples
        console.warn('[nfseSpCapturadasService] query falhou, tentando sem orderBy:', e?.message);
        const fallback: any[] = [
            where('tipoDoc', '==', 'NFSe'),
            where('fonte', '==', 'csv-portal-sp'),
            fbLimit(lim),
        ];
        const q2 = query(collection(db, 'documentos_fiscais'), ...fallback);
        const snap = await getDocs(q2);
        const docs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as NfseSpCapturada));
        // Filtro/sort em memória
        return docs
            .filter(d => {
                if (filtros.empresaCnpj && filtros.empresaCnpj.length === 14 && d.tomadorCnpj !== filtros.empresaCnpj && d.prestadorCnpj !== filtros.empresaCnpj) return false;
                if (filtros.direcao && filtros.direcao !== 'todas' && d.direcao !== filtros.direcao) return false;
                if (filtros.dataInicio && d.dhEmi && d.dhEmi < `${filtros.dataInicio}T00:00:00`) return false;
                if (filtros.dataFim && d.dhEmi && d.dhEmi > `${filtros.dataFim}T23:59:59`) return false;
                return true;
            })
            .sort((a, b) => (b.dhEmi || '').localeCompare(a.dhEmi || ''));
    }
}

export async function resumoNfseSpCapturadas(): Promise<{
    total: number;
    emitidas: number;
    recebidas: number;
    valorEmitidasTotal: number;
    valorRecebidasTotal: number;
    empresasUnicas: number;
    ultimaCaptura?: string;
}> {
    if (!isFirebaseConfigured || !db) {
        return { total: 0, emitidas: 0, recebidas: 0, valorEmitidasTotal: 0, valorRecebidasTotal: 0, empresasUnicas: 0 };
    }
    try {
        const q = query(
            collection(db, 'documentos_fiscais'),
            where('tipoDoc', '==', 'NFSe'),
            where('fonte', '==', 'csv-portal-sp'),
            fbLimit(5000),
        );
        const snap = await getDocs(q);
        const empresas = new Set<string>();
        let emitidas = 0, recebidas = 0, valE = 0, valR = 0;
        let ultima = '';
        snap.docs.forEach(d => {
            const x = d.data() as any;
            const cnpjP = x.prestadorCnpj || '';
            const cnpjT = x.tomadorCnpj || '';
            if (cnpjP) empresas.add(cnpjP);
            if (cnpjT) empresas.add(cnpjT);
            if (x.direcao === 'saida') { emitidas++; valE += x.valorServicos || 0; }
            if (x.direcao === 'entrada') { recebidas++; valR += x.valorServicos || 0; }
            if (x.dhEmi && x.dhEmi > ultima) ultima = x.dhEmi;
        });
        return {
            total: snap.size,
            emitidas, recebidas,
            valorEmitidasTotal: +valE.toFixed(2),
            valorRecebidasTotal: +valR.toFixed(2),
            empresasUnicas: empresas.size,
            ultimaCaptura: ultima || undefined,
        };
    } catch (e: any) {
        console.warn('[nfseSpCapturadasService] resumo falhou:', e?.message);
        return { total: 0, emitidas: 0, recebidas: 0, valorEmitidasTotal: 0, valorRecebidasTotal: 0, empresasUnicas: 0 };
    }
}
