/**
 * SistemaBancoPanel — Sistema → Banco de dados (DEV-ONLY).
 *
 * Paulo, 30/07/2026: "controle muito acirrado sobre funcionalidade × banco de
 * dados, algo visível que só eu como desenvolvedor posso ter acesso".
 *
 * Mostra o Firestore por dentro: cada coleção REAL com o dono declarado no
 * catálogo (funcionalidade), a contagem de documentos e o Δ desde o último
 * snapshot diário. Coleção sem dono ("órfã") acende âmbar — banco não cresce
 * no escuro. Acesso: admin; com SISTEMA_DEV_EMAILS definida no Cloud Run, só
 * os e-mails listados.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { getAuth } from 'firebase/auth';

interface LinhaCatalogo {
    colecao: string; grupo: string; funcionalidade: string;
    docs: number | null; delta: number | null;
}
interface Orfa { colecao: string; docs: number | null; delta: number | null }
interface Resposta {
    ok: boolean;
    geradoEm: string;
    snapshotAnterior: string | null;
    totalColecoes: number;
    totalDocs: number;
    totalCatalogadas: number;
    linhas: LinhaCatalogo[];
    orfas: Orfa[];
    catalogadasSemUso: string[];
    error?: string;
}

const fmtN = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR'));
const fmtDelta = (d: number | null) => {
    if (d === null) return '—';
    if (d === 0) return '0';
    return d > 0 ? `+${d.toLocaleString('pt-BR')}` : d.toLocaleString('pt-BR');
};

const SistemaBancoPanel: React.FC = () => {
    const [data, setData] = useState<Resposta | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [busca, setBusca] = useState('');

    const carregar = async () => {
        setLoading(true); setErro(null);
        try {
            const u = getAuth().currentUser;
            if (!u) throw new Error('Sessão expirada');
            const token = await u.getIdToken();
            const res = await fetch('/api/admin/sistema/banco', {
                headers: { Authorization: `Bearer ${token}` },
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
            setData(d);
        } catch (e: any) {
            setErro(e?.message || 'Falha ao carregar');
        } finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, []);

    const grupos = useMemo(() => {
        if (!data) return [];
        const termo = busca.trim().toLowerCase();
        const linhas = data.linhas.filter((l) =>
            !termo || l.colecao.includes(termo) || l.funcionalidade.toLowerCase().includes(termo) || l.grupo.toLowerCase().includes(termo));
        const map = new Map<string, LinhaCatalogo[]>();
        for (const l of linhas) {
            if (!map.has(l.grupo)) map.set(l.grupo, []);
            map.get(l.grupo)!.push(l);
        }
        // Grupo com mais docs primeiro; dentro do grupo, coleção maior primeiro.
        return [...map.entries()]
            .map(([grupo, ls]) => ({ grupo, linhas: ls.sort((a, b) => (b.docs ?? 0) - (a.docs ?? 0)), docs: ls.reduce((a, l) => a + (l.docs ?? 0), 0) }))
            .sort((a, b) => b.docs - a.docs);
    }, [data, busca]);

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
            <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                    <h3 className="font-bold text-slate-800 dark:text-slate-100">🛠 Sistema → Banco de dados (desenvolvedor)</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
                        Cada coleção do Firestore com o DONO (funcionalidade), o tamanho e o crescimento desde o
                        último snapshot. <strong>Coleção órfã</strong> (sem dono no catálogo) acende âmbar — regra:
                        toda feature que criar coleção registra a linha no catálogo no mesmo PR.
                    </p>
                </div>
                <button onClick={carregar} disabled={loading}
                    className="px-3 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-800 dark:text-gray-100 rounded">
                    {loading ? '⏳…' : '↻ Atualizar'}
                </button>
            </div>

            {erro && <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-800 px-3 py-2 text-xs text-red-800 dark:text-red-300">{erro}</div>}
            {loading && !data && <p className="text-xs text-center text-slate-400 py-4">Contando o banco…</p>}

            {data && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                            <div className="text-xl font-bold text-slate-700 dark:text-slate-200">{fmtN(data.totalDocs)}</div>
                            <div className="text-[10px] uppercase text-slate-500">documentos no banco</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                            <div className="text-xl font-bold text-slate-700 dark:text-slate-200">{data.totalColecoes}</div>
                            <div className="text-[10px] uppercase text-slate-500">coleções reais</div>
                        </div>
                        <div className={`rounded-lg border p-2 ${data.orfas.length > 0 ? 'border-amber-300 dark:border-amber-700' : 'border-emerald-200 dark:border-emerald-800'}`}>
                            <div className={`text-xl font-bold ${data.orfas.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{data.orfas.length}</div>
                            <div className="text-[10px] uppercase text-slate-500">órfãs (sem dono)</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                            <div className="text-xl font-bold text-slate-600 dark:text-slate-300">{data.catalogadasSemUso.length}</div>
                            <div className="text-[10px] uppercase text-slate-500">catalogadas sem uso</div>
                        </div>
                    </div>

                    <p className="text-[11px] text-slate-400">
                        Δ = crescimento desde {data.snapshotAnterior ? `o snapshot de ${data.snapshotAnterior}` : 'o primeiro snapshot (aparece amanhã)'}.
                    </p>

                    {data.orfas.length > 0 && (
                        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/10 p-3">
                            <p className="text-xs font-bold text-amber-800 dark:text-amber-300 mb-1">
                                ⚠ Coleções ÓRFÃS — existem no banco e não têm dono no catálogo:
                            </p>
                            <ul className="text-xs font-mono text-amber-700 dark:text-amber-400 space-y-0.5">
                                {data.orfas.map((o) => (
                                    <li key={o.colecao}>{o.colecao} · {fmtN(o.docs)} doc(s) · Δ {fmtDelta(o.delta)}</li>
                                ))}
                            </ul>
                            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                                Ação: identificar a feature que criou e registrar em <code>catalogo-banco.js</code> — ou aposentar.
                            </p>
                        </div>
                    )}

                    <input
                        type="text" value={busca} onChange={(e) => setBusca(e.target.value)}
                        placeholder="Filtrar por coleção, funcionalidade ou grupo…"
                        className="w-full px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200"
                    />

                    <div className="space-y-3">
                        {grupos.map((g) => (
                            <div key={g.grupo}>
                                <p className="text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                                    {g.grupo} · {fmtN(g.docs)} docs
                                </p>
                                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                                    <table className="w-full text-xs">
                                        <tbody>
                                            {g.linhas.map((l) => (
                                                <tr key={l.colecao} className="border-t first:border-t-0 border-slate-100 dark:border-slate-700">
                                                    <td className="py-1.5 px-2 font-mono text-slate-700 dark:text-slate-200 whitespace-nowrap">{l.colecao}</td>
                                                    <td className="py-1.5 px-2 text-slate-500 dark:text-slate-400">{l.funcionalidade}</td>
                                                    <td className="py-1.5 px-2 text-right font-mono font-bold whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtN(l.docs)}</td>
                                                    <td className={`py-1.5 px-2 text-right font-mono whitespace-nowrap ${(l.delta ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>{fmtDelta(l.delta)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ))}
                    </div>

                    {data.catalogadasSemUso.length > 0 && (
                        <details className="text-xs text-slate-500 dark:text-slate-400">
                            <summary className="cursor-pointer">Catalogadas sem uso ({data.catalogadasSemUso.length}) — feature nunca rodou ou candidata a limpeza</summary>
                            <p className="font-mono mt-1">{data.catalogadasSemUso.join(' · ')}</p>
                        </details>
                    )}
                </>
            )}
        </div>
    );
};

export default SistemaBancoPanel;
