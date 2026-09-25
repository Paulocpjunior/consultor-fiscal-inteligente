/**
 * services/nfseSpCapturadasService.ts
 *
 * Lista NFSe SP capturadas via cron noturno (CSV portal nfe.prefeitura.sp.gov.br)
 * direto do Firestore. Filtros: empresa, período, direção (emitidas/recebidas),
 * busca por número/prestador/tomador.
 */

import {
    collection, getDocs, query, where, orderBy,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebaseConfig';
import { fetchAllDocs, type FetchAllMeta } from './firestorePaginate';
import { LIMITE_DOCS_NFSE_SP } from './nfseSpListaJanela';

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

export interface NfseSpLista {
    notas: NfseSpCapturada[];
    /** O teto de leitura foi atingido: PODE haver mais notas não lidas. */
    truncado: boolean;
    limite: number;
}

/**
 * 🧊 25/09: esta função pedia `limite` (5000) e o paginador o IGNORAVA — o
 * `fbLimit(lim)` entrava nas restrições base e o `fetchAllDocs` acrescentava o
 * `limit(500)` de página por cima (o último vence), descendo até o teto de
 * 20.000 documentos inteiros. Com 20.000 linhas desenhadas, "Esta página não
 * está respondendo". Agora o teto é `maxDocs: lim`, o resultado DIZ se foi
 * atingido, e o período entra na consulta (não só na memória) quando há CNPJ.
 */
export async function listarNfseSpCapturadas(filtros: NfseSpFiltros = {}): Promise<NfseSpLista> {
    const lim = Math.min(filtros.limite || LIMITE_DOCS_NFSE_SP, LIMITE_DOCS_NFSE_SP);
    if (!isFirebaseConfigured || !db) return { notas: [], truncado: false, limite: lim };
    const cnpjFiltro = (filtros.empresaCnpj || '').replace(/\D/g, '');
    const constraints: any[] = [
        where('tipoDoc', '==', 'NFSe'),
        where('fonte', '==', 'csv-portal-sp'),
    ];
    const periodo: any[] = [];
    if (filtros.dataInicio) periodo.push(where('dhEmi', '>=', `${filtros.dataInicio}T00:00:00`));
    if (filtros.dataFim) periodo.push(where('dhEmi', '<=', `${filtros.dataFim}T23:59:59`));
    // Se filtra por CNPJ específico, busca onde esse CNPJ é prestador OU tomador.
    // Filtro por direção é feito em MEMÓRIA depois, comparando o cnpjFiltro
    // com prestadorCnpj/tomadorCnpj — direção é POSIÇÃO RELATIVA, não fixa.
    if (cnpjFiltro.length === 14) {
        // Firestore não permite OR — fazemos 2 queries paralelas e juntamos.
        const baseConstraints = [
            where('tipoDoc', '==', 'NFSe'),
            where('fonte', '==', 'csv-portal-sp'),
        ];
        // O período vai NA CONSULTA (índices tipoDoc+fonte+prestadorCnpj+dhEmi e
        // …+tomadorCnpj+dhEmi). Se o índice ainda não existir (colaborador com
        // escopo de carteira, ou índice em construção), a consulta cai para a
        // forma antiga — SEM período — mas com o teto respeitado; o período
        // então é aplicado em memória, como sempre foi.
        const lerPorCnpj = async (comPeriodo: boolean) => {
            const metaP: FetchAllMeta = { truncated: false, count: 0, maxDocs: lim };
            const metaT: FetchAllMeta = { truncated: false, count: 0, maxDocs: lim };
            const extra = comPeriodo ? periodo : [];
            const [snapP, snapT] = await Promise.all([
                fetchAllDocs('documentos_fiscais', [...baseConstraints, where('prestadorCnpj', '==', cnpjFiltro), ...extra], { maxDocs: lim, meta: metaP }),
                fetchAllDocs('documentos_fiscais', [...baseConstraints, where('tomadorCnpj', '==', cnpjFiltro), ...extra], { maxDocs: lim, meta: metaT }),
            ]);
            return { snapP, snapT, truncado: metaP.truncated || metaT.truncated };
        };
        try {
            let lido;
            try {
                lido = await lerPorCnpj(periodo.length > 0);
            } catch (e: any) {
                if (periodo.length === 0) throw e;
                console.warn('[nfseSpCapturadasService] consulta por CNPJ com período falhou (índice?), refazendo sem período:', e?.message);
                lido = await lerPorCnpj(false);
            }
            const { snapP, snapT, truncado } = lido;
            const mapa = new Map<string, NfseSpCapturada>();
            [...snapP, ...snapT].forEach(d => {
                mapa.set(d.id, { id: d.id, ...(d.data() as any) } as NfseSpCapturada);
            });
            let lista = Array.from(mapa.values());
            // Filtro por direção EFETIVA baseado no CNPJ do filtro
            if (filtros.direcao && filtros.direcao !== 'todas') {
                lista = lista.filter(n => {
                    const isPrestador = (n.prestadorCnpj || '').replace(/\D/g, '') === cnpjFiltro;
                    const direcaoEfetiva = isPrestador ? 'saida' : 'entrada';
                    return direcaoEfetiva === filtros.direcao;
                });
            }
            if (filtros.dataInicio) {
                lista = lista.filter(n => !n.dhEmi || n.dhEmi >= `${filtros.dataInicio}T00:00:00`);
            }
            if (filtros.dataFim) {
                lista = lista.filter(n => !n.dhEmi || n.dhEmi <= `${filtros.dataFim}T23:59:59`);
            }
            return { notas: lista.sort((a, b) => (b.dhEmi || '').localeCompare(a.dhEmi || '')), truncado, limite: lim };
        } catch (e: any) {
            // 🚨 Com CNPJ informado, NUNCA cair na leitura sem CNPJ: ela traria o
            // acervo inteiro — o que travou o navegador. Erro é resposta.
            throw new Error(`Não consegui ler as NFS-e deste CNPJ: ${e?.message || 'erro desconhecido'}`);
        }
    }
    // Sem CNPJ específico: usa direção fixa do doc (já corrigida)
    if (filtros.direcao && filtros.direcao !== 'todas') {
        constraints.push(where('direcao', '==', filtros.direcao));
    }
    constraints.push(...periodo);
    constraints.push(orderBy('dhEmi', 'desc'));

    const meta: FetchAllMeta = { truncated: false, count: 0, maxDocs: lim };
    try {
        const snaps = await fetchAllDocs('documentos_fiscais', constraints, { maxDocs: lim, meta });
        return { notas: snaps.map(d => ({ id: d.id, ...(d.data() as any) } as NfseSpCapturada)), truncado: meta.truncated, limite: lim };
    } catch (e: any) {
        console.warn('[nfseSpCapturadasService] query falhou, fallback simples:', e?.message);
        const fallback: any[] = [
            where('tipoDoc', '==', 'NFSe'),
            where('fonte', '==', 'csv-portal-sp'),
        ];
        const snaps = await fetchAllDocs('documentos_fiscais', fallback, { maxDocs: lim, meta });
        const notas = snaps
            .map(d => ({ id: d.id, ...(d.data() as any) } as NfseSpCapturada))
            .filter(d => !filtros.direcao || filtros.direcao === 'todas' || d.direcao === filtros.direcao)
            .filter(n => !filtros.dataInicio || !n.dhEmi || n.dhEmi >= `${filtros.dataInicio}T00:00:00`)
            .filter(n => !filtros.dataFim || !n.dhEmi || n.dhEmi <= `${filtros.dataFim}T23:59:59`)
            .sort((a, b) => (b.dhEmi || '').localeCompare(a.dhEmi || ''));
        return { notas, truncado: meta.truncated, limite: lim };
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
        const snaps = await fetchAllDocs('documentos_fiscais', [
            where('tipoDoc', '==', 'NFSe'),
            where('fonte', '==', 'csv-portal-sp'),
        ], { batchSize: 2000 });
        const empresas = new Set<string>();
        let emitidas = 0, recebidas = 0, valE = 0, valR = 0;
        let ultima = '';
        snaps.forEach(d => {
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
            total: snaps.length,
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
