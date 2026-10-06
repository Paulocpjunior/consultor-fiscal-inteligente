import { doc, getDoc, getDocs, collection, query, where, limit, documentId, type QueryConstraint } from 'firebase/firestore';
import { auth, db } from './firebaseConfig';

export async function carteiraApi(path: string, method: string, body?: unknown): Promise<any> {
    const user = auth?.currentUser;
    if (!user) throw new Error('Sessão expirada. Entre novamente.');
    const response = await fetch(`/api/admin/carteira${path}`, {
        method, headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
}

const protegidas = new Set(['simples_empresas', 'lucro_empresas', 'documentos_fiscais', 'simples_notas', 'nfp_analises', 'carteiras']);

/** Queries limitadas ANTES de ler dados. O banco continua sendo a fronteira. */
export async function restricoesDeCarteira(colecao: string, empresasSelecionadas?: readonly string[]): Promise<QueryConstraint[][]> {
    if (!protegidas.has(colecao)) return [[]];
    const user = auth?.currentUser;
    if (!user || !db) throw new Error('Usuário não autenticado');
    const perfil = await getDoc(doc(db, 'users', user.uid));
    if (perfil.data()?.role === 'admin') {
        if (empresasSelecionadas && ['documentos_fiscais', 'simples_notas', 'nfp_analises'].includes(colecao)) {
            return [...new Set(empresasSelecionadas)].map(id => [where('empresaId', '==', id)]);
        }
        return [[]];
    }
    if (colecao === 'carteiras') return [[where('colaboradorUid', '==', user.uid)]];
    const acl = await getDoc(doc(db, 'carteira_acessos', user.uid));
    const ids = new Set<string>((acl.data()?.empresaIds || []).filter((id: unknown) => typeof id === 'string'));
    const empresas = colecao === 'simples_empresas' || colecao === 'lucro_empresas';
    if (!empresas) {
        for (const nome of ['simples_empresas', 'lucro_empresas']) {
            const owned = await getDocs(query(collection(db, nome), where('createdBy', '==', user.uid), limit(500)));
            for (const d of owned.docs) ids.add(d.id);
            if (owned.size === 500) throw new Error('Carteira própria excedeu o limite de leitura. Contate o administrador.');
        }
    }
    // Um filtro de empresa da tela não pode ser combinado com IDs de outras
    // empresas: as rules rejeitam esse AND contraditório, mesmo sem resultados.
    if (empresasSelecionadas && !empresas) {
        const selecionadas = new Set(empresasSelecionadas);
        if ([...selecionadas].some(id => !ids.has(id))) throw new Error('Empresa fora da sua carteira. Solicite ao administrador a revisão do vínculo.');
        for (const id of ids) if (!selecionadas.has(id)) ids.delete(id);
    }
    const filtros: QueryConstraint[][] = [...ids].map(id => [where(empresas ? documentId() : 'empresaId', '==', id)]);
    if (empresas) filtros.push([where('createdBy', '==', user.uid)]);
    if (colecao === 'nfp_analises') filtros.push([where('analisadoPorUid', '==', user.uid)]);
    return filtros;
}
