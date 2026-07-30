/**
 * CofreChecklistPanel — checklist de migração da SAÍDA (mod 55).
 * v2 (30/07): reconhece os DOIS trilhos automáticos — cofre de e-mail E
 * autXML. Antes só olhava o cofre: empresa com 60 saídas chegando NO DIA via
 * autXML aparecia "🔴 Falta migrar" (caso Eduardo Guerra). Farol honesto:
 * migrada é migrada, por qualquer trilho.
 *   🔴 falta-migrar → tem saída e NUNCA recebeu por trilho automático
 *   🟠 parado       → recebia (cofre/autXML) e parou (config caiu?)
 *   ✅ ativo        → migrada — o selo diz por qual trilho
 */
import React, { useEffect, useMemo, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { instrucoesMigracaoCofre } from '../../services/cofreInstrucoes';

interface Linha {
    empresaId: string; cnpj: string; nome: string; regime: string;
    totalSaidas55: number; viaCofre: number; viaAutXml: number; viaAuto: number;
    ultimaSaidaMs: number | null; ultimaSaidaCofreMs: number | null;
    ultimaSaidaAutXmlMs: number | null; ultimaAutoMs: number | null;
    status: 'ativo' | 'parado' | 'falta-migrar' | 'sem-saida-55';
    trilho: 'cofre' | 'autxml' | 'ambos' | null;
}
interface Resposta {
    resumo: {
        totalEmpresas: number; comSaida55: number;
        ativos: number; ativosCofre: number; ativosAutXml: number;
        parados: number; faltaMigrar: number; semSaida55: number;
        docsSemEmpresa: number; inatividadeDias: number;
    };
    linhas: Linha[];
    geradoEm: string;
}

const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtQuando = (ms: number | null) => {
    if (!ms) return 'nunca';
    const d = Math.floor((Date.now() - ms) / (24 * 3600 * 1000));
    if (d < 1) return 'hoje';
    return `há ${d}d`;
};
const nomeTrilho = (t: Linha['trilho']) =>
    t === 'ambos' ? 'cofre + autXML' : t === 'autxml' ? 'autXML' : t === 'cofre' ? 'cofre' : '—';

// Texto pronto pra mandar ao cliente/emissor — fonte ÚNICA em
// services/cofreInstrucoes.ts (compartilhada com o card do Diagnóstico).
const instrucoesMigracao = instrucoesMigracaoCofre;

const BADGES: Record<Linha['status'], { cls: string; label: string }> = {
    'falta-migrar': { cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', label: '🔴 Falta migrar' },
    'parado': { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', label: '🟠 Parado' },
    'ativo': { cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', label: '✅ Ativo' },
    'sem-saida-55': { cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400', label: 'Sem saída 55' },
};

type Filtro = 'acao' | Linha['status'] | 'todas';

const CofreChecklistPanel: React.FC = () => {
    const [data, setData] = useState<Resposta | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<Filtro>('acao');
    const [copiado, setCopiado] = useState<string | null>(null);

    const carregar = async () => {
        setLoading(true); setErro(null);
        try {
            const u = getAuth().currentUser;
            if (!u) throw new Error('Sessão expirada');
            const token = await u.getIdToken();
            const res = await fetch('/api/admin/sefaz/cofre-checklist', {
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

    const linhas = useMemo(() => {
        if (!data) return [];
        if (filtro === 'todas') return data.linhas;
        if (filtro === 'acao') return data.linhas.filter(l => l.status === 'falta-migrar' || l.status === 'parado');
        return data.linhas.filter(l => l.status === filtro);
    }, [data, filtro]);

    const exportarCsv = () => {
        if (!data) return;
        const rows = [
            ['CNPJ', 'Empresa', 'Regime', 'Status', 'Trilho', 'Saídas 55', 'Via cofre', 'Via autXML', 'Última saída', 'Última automática'].join(';'),
            ...linhas.map(l => [
                fmtCnpj(l.cnpj), `"${l.nome.replace(/"/g, '""')}"`, l.regime,
                BADGES[l.status].label.replace(/^\S+ /, ''), nomeTrilho(l.trilho),
                l.totalSaidas55, l.viaCofre, l.viaAutXml,
                l.ultimaSaidaMs ? new Date(l.ultimaSaidaMs).toLocaleDateString('pt-BR') : 'nunca',
                l.ultimaAutoMs ? new Date(l.ultimaAutoMs).toLocaleDateString('pt-BR') : 'nunca',
            ].join(';')),
        ].join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + rows], { type: 'text/csv;charset=utf-8' }));
        a.download = 'checklist-migracao-saida.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
            <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    ✅ Checklist de migração da saída (mod 55) — cofre + autXML
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Quem já recebe saída por um trilho automático — cofre (<b>xml@spassessoriacontabil.com.br</b>)
                    ou <b>autXML</b> (CNPJ 44.388.152/0001-89 na nota) — × quem ainda depende da SIEG.
                    <b> Falta migrar</b> = tem saída histórica e nunca chegou nada sozinho: configure
                    UMA das duas ligações no emissor do cliente.
                </p>
            </div>

            {data && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                    <div className="rounded-lg border border-red-200 dark:border-red-800 p-2">
                        <div className="text-xl font-bold text-red-600 dark:text-red-400">{data.resumo.faltaMigrar}</div>
                        <div className="text-[10px] uppercase text-slate-500">Falta migrar</div>
                    </div>
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 p-2">
                        <div className="text-xl font-bold text-amber-600 dark:text-amber-400">{data.resumo.parados}</div>
                        <div className="text-[10px] uppercase text-slate-500">Parado</div>
                    </div>
                    <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 p-2">
                        <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{data.resumo.ativos}</div>
                        <div className="text-[10px] uppercase text-slate-500">
                            Ativo · {data.resumo.ativosCofre} cofre / {data.resumo.ativosAutXml} autXML
                        </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                        <div className="text-xl font-bold text-slate-600 dark:text-slate-300">{data.resumo.semSaida55}</div>
                        <div className="text-[10px] uppercase text-slate-500">Sem saída 55</div>
                    </div>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <select
                    value={filtro} onChange={e => setFiltro(e.target.value as Filtro)}
                    className="px-2 py-1 text-xs border rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-slate-600"
                >
                    <option value="acao">🚨 Precisam de ação (migrar + parado)</option>
                    <option value="falta-migrar">🔴 Falta migrar</option>
                    <option value="parado">🟠 Parado</option>
                    <option value="ativo">✅ Ativo (cofre/autXML)</option>
                    <option value="sem-saida-55">Sem saída 55</option>
                    <option value="todas">Todas</option>
                </select>
                <span className="text-xs text-slate-500">{linhas.length} empresa(s)</span>
                <div className="ml-auto flex gap-2">
                    <button onClick={exportarCsv} disabled={!data || linhas.length === 0}
                        className="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
                        ⬇ CSV
                    </button>
                    <button onClick={carregar} disabled={loading}
                        className="px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-800 dark:text-gray-100 rounded">
                        ↻ Atualizar
                    </button>
                </div>
            </div>

            {erro && <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-800 px-2 py-1 text-xs text-red-800 dark:text-red-300">{erro}</div>}
            {loading && <p className="text-xs text-center text-slate-400 py-3">Carregando…</p>}

            {!loading && data && linhas.length === 0 && (
                <p className="text-xs text-center text-slate-400 py-3">Nenhuma empresa nesse filtro. 🎉</p>
            )}

            {!loading && linhas.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-[10px] uppercase text-slate-500">
                                <th className="py-1 pr-2">Empresa</th>
                                <th className="py-1 pr-2">Status</th>
                                <th className="py-1 pr-2 text-right">Saídas 55</th>
                                <th className="py-1 pr-2 text-right">Cofre</th>
                                <th className="py-1 pr-2 text-right">autXML</th>
                                <th className="py-1 pr-2">Última saída</th>
                                <th className="py-1">Última automática</th>
                                <th className="py-1"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {linhas.map(l => (
                                <tr key={l.cnpj} className="border-t border-slate-100 dark:border-slate-700">
                                    <td className="py-1.5 pr-2">
                                        <div className="font-medium text-slate-800 dark:text-slate-100">{l.nome}</div>
                                        <div className="font-mono text-[10px] text-slate-400">{fmtCnpj(l.cnpj)} · {l.regime}</div>
                                    </td>
                                    <td className="py-1.5 pr-2">
                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${BADGES[l.status].cls}`}>
                                            {BADGES[l.status].label}{(l.status === 'ativo' || l.status === 'parado') && l.trilho ? ` · ${nomeTrilho(l.trilho)}` : ''}
                                        </span>
                                    </td>
                                    <td className="py-1.5 pr-2 text-right font-mono">{l.totalSaidas55}</td>
                                    <td className="py-1.5 pr-2 text-right font-mono">{l.viaCofre}</td>
                                    <td className="py-1.5 pr-2 text-right font-mono">{l.viaAutXml}</td>
                                    <td className="py-1.5 pr-2">{fmtQuando(l.ultimaSaidaMs)}</td>
                                    <td className="py-1.5">{fmtQuando(l.ultimaAutoMs)}</td>
                                    <td className="py-1.5">
                                        {(l.status === 'falta-migrar' || l.status === 'parado') && (
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(instrucoesMigracao(l.nome));
                                                    setCopiado(l.cnpj);
                                                    setTimeout(() => setCopiado(c => (c === l.cnpj ? null : c)), 2500);
                                                }}
                                                className="text-[10px] px-2 py-0.5 bg-sky-600 text-white rounded hover:bg-sky-700"
                                                title="Copia o texto pronto pra enviar ao cliente (as duas opções de ligação: cofre de e-mail ou autXML)"
                                            >
                                                {copiado === l.cnpj ? '✓ copiado!' : '📋 Instruções'}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default CofreChecklistPanel;
