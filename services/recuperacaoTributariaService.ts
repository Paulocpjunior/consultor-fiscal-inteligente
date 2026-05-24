import { auth } from './firebaseConfig';

const API_BASE = '/api/admin/recuperacao';

async function headers() {
    const token = await auth?.currentUser?.getIdToken();
    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

let _teseCatalog: any[] | null = null;

export async function getTeses() {
    const res = await fetch(`${API_BASE}/teses`, { headers: await headers() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
    const data = await res.json();
    _teseCatalog = data.teses || [];
    return data;
}

function enrichTeses(resultado: any) {
    if (!resultado?.teses || !_teseCatalog) return resultado;
    resultado.teses = resultado.teses.map((t: any) => {
        if (t.tese) return t;
        const catalog = _teseCatalog!.find((c: any) => c.id === t.teseId);
        return {
            tese: catalog || { id: t.teseId, nome: t.teseId, descricao: '', fundamentoLegal: '', regimesAplicaveis: [], prazoDecadencial: 5 },
            oportunidade: t.status === 'oportunidade',
            valorEstimado: t.valorEstimado || 0,
            itens: t.itens || [],
            observacoes: t.observacoes,
        };
    });
    return resultado;
}

export async function analisarEmpresa(empresaId: string, regime: 'simples' | 'lucro') {
    if (!_teseCatalog) await getTeses();
    const res = await fetch(`${API_BASE}/analisar/${empresaId}?regime=${regime}`, { headers: await headers() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
    return enrichTeses(await res.json());
}

export async function analisarTodas() {
    if (!_teseCatalog) await getTeses();
    const res = await fetch(`${API_BASE}/analisar-todas`, { headers: await headers() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
    const data = await res.json();
    if (data.resultados) {
        data.resultados = data.resultados.map((r: any) => enrichTeses(r));
    }
    return data;
}

export async function gerarParecerIa(empresaNome: string, tese: any, itens: any[]) {
    const res = await fetch(`${API_BASE}/parecer-ia`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({ empresaNome, tese, itens }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
    return res.json();
}
