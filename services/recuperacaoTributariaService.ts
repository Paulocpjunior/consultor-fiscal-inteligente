import { auth } from './firebaseConfig';

const API_BASE = '/api/admin/recuperacao';

async function headers() {
    const token = await auth?.currentUser?.getIdToken();
    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

export async function getTeses() {
    const res = await fetch(`${API_BASE}/teses`, { headers: await headers() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
    return res.json();
}

export async function analisarEmpresa(empresaId: string, regime: 'simples' | 'lucro') {
    const res = await fetch(`${API_BASE}/analisar/${empresaId}?regime=${regime}`, { headers: await headers() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
    return res.json();
}

export async function analisarTodas() {
    const res = await fetch(`${API_BASE}/analisar-todas`, { headers: await headers() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
    return res.json();
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
