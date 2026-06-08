/**
 * components/CalendarioFiscal/index.tsx
 * Calendario de Obrigacoes Fiscais — visao executiva mensal.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User, CalendarioResponse, ObrigacaoFiscal } from '../../types';
import { getCalendario, tipoIcon, tipoCor, diasAteVencimento } from '../../services/calendarioService';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const CalendarioFiscal: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const hoje = new Date();
    const [ano, setAno] = useState(hoje.getFullYear());
    const [mes, setMes] = useState(hoje.getMonth() + 1);
    const [data, setData] = useState<CalendarioResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [filtroTipo, setFiltroTipo] = useState<string>('all');
    const [filtroEmpresa, setFiltroEmpresa] = useState<string>('');

    const carregar = async () => {
        setLoading(true);
        try {
            const r = await getCalendario(currentUser, ano, mes);
            setData(r);
        } catch (e: any) {
            onShowToast?.(`Erro: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, [ano, mes]);

    const obrigacoesFiltradas = useMemo(() => {
        if (!data) return [];
        let lista = data.obrigacoes;
        if (filtroTipo !== 'all') lista = lista.filter(o => o.tipo === filtroTipo);
        if (filtroEmpresa) {
            const q = filtroEmpresa.toLowerCase();
            lista = lista.filter(o =>
                (o.empresaNome || '').toLowerCase().includes(q) ||
                (o.empresaCnpj || '').includes(q)
            );
        }
        return lista;
    }, [data, filtroTipo, filtroEmpresa]);

    // Agrupa por data
    const agrupadasPorData = useMemo(() => {
        const grupos: Record<string, ObrigacaoFiscal[]> = {};
        obrigacoesFiltradas.forEach(o => {
            if (!grupos[o.vencimento]) grupos[o.vencimento] = [];
            grupos[o.vencimento].push(o);
        });
        return Object.entries(grupos).sort((a, b) => a[0].localeCompare(b[0]));
    }, [obrigacoesFiltradas]);

    const navegarMes = (delta: number) => {
        let novoMes = mes + delta;
        let novoAno = ano;
        if (novoMes > 12) { novoMes = 1; novoAno++; }
        if (novoMes < 1) { novoMes = 12; novoAno--; }
        setMes(novoMes);
        setAno(novoAno);
    };

    const mesNome = new Date(ano, mes - 1, 1).toLocaleString('pt-BR', { month: 'long' });
    const tiposDisponiveis = data ? Object.keys(data.stats.porTipo).sort() : [];

    const formatDataLong = (iso: string) => {
        const d = new Date(iso + 'T00:00:00');
        return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    };

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">📅 Calendário Fiscal</h2>
                    <p className="text-sm text-slate-500 mt-1">
                        Vencimentos de obrigações por empresa, calculados a partir do regime e folha
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => navegarMes(-1)} className="btn-press px-3 py-1.5 bg-slate-100 dark:bg-slate-700 rounded">←</button>
                    <span className="text-lg font-bold capitalize min-w-32 text-center">{mesNome}/{ano}</span>
                    <button onClick={() => navegarMes(1)} className="btn-press px-3 py-1.5 bg-slate-100 dark:bg-slate-700 rounded">→</button>
                    <button
                        onClick={() => { setMes(hoje.getMonth() + 1); setAno(hoje.getFullYear()); }}
                        className="btn-press text-xs px-2 py-1.5 bg-sky-100 text-sky-700 rounded ml-2"
                    >
                        Hoje
                    </button>
                </div>
            </div>

            {/* Stats */}
            {data && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                        <div className="text-xs text-slate-500">Total no mês</div>
                        <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{data.stats.total}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-red-200 dark:border-red-700">
                        <div className="text-xs text-slate-500">Vencidas</div>
                        <div className="text-2xl font-bold text-red-600">{data.stats.vencidas}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-amber-200 dark:border-amber-700">
                        <div className="text-xs text-slate-500">Próximos 7 dias</div>
                        <div className="text-2xl font-bold text-amber-600">{data.stats.proximas7Dias}</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                        <div className="text-xs text-slate-500">Tipos diferentes</div>
                        <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{Object.keys(data.stats.porTipo).length}</div>
                    </div>
                </div>
            )}

            {/* Filtros */}
            {data && (
                <div className="flex items-center gap-3 flex-wrap bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                    <input
                        type="text"
                        placeholder="🔍 Buscar empresa por nome ou CNPJ..."
                        value={filtroEmpresa}
                        onChange={e => setFiltroEmpresa(e.target.value)}
                        className="flex-1 min-w-48 px-3 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                    />
                    <div className="flex gap-1 flex-wrap">
                        <button
                            onClick={() => setFiltroTipo('all')}
                            className={`text-xs px-2.5 py-1 rounded ${filtroTipo === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}
                        >
                            Todos ({data.stats.total})
                        </button>
                        {tiposDisponiveis.map(t => (
                            <button
                                key={t}
                                onClick={() => setFiltroTipo(t)}
                                className={`text-xs px-2.5 py-1 rounded font-bold ${filtroTipo === t ? 'bg-sky-600 text-white' : tipoCor(t)}`}
                            >
                                {tipoIcon(t)} {t} ({data.stats.porTipo[t]})
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Limitacoes */}
            {data?.limitacoes && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 text-xs text-amber-700 dark:text-amber-400">
                    ⚠️ <strong>Limitação:</strong> {data.limitacoes}
                </div>
            )}

            {/* Lista agrupada por data */}
            <div className="space-y-3">
                {loading && <div className="text-center text-slate-500 py-8">Carregando...</div>}
                {!loading && agrupadasPorData.length === 0 && (
                    <div className="text-center text-slate-500 py-8">Nenhuma obrigação para esses filtros.</div>
                )}
                {agrupadasPorData.map(([dataVenc, lista]) => {
                    const dias = diasAteVencimento(dataVenc);
                    const corHeader =
                        dias < 0 ? 'bg-red-50 dark:bg-red-900/20 border-red-300' :
                        dias === 0 ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-400' :
                        dias <= 7 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300' :
                        'bg-slate-50 dark:bg-slate-800 border-slate-200';
                    return (
                        <div key={dataVenc} className={`rounded-lg border-2 ${corHeader}`}>
                            <div className="px-4 py-2 flex items-center justify-between flex-wrap gap-2">
                                <div className="font-bold capitalize">
                                    {formatDataLong(dataVenc)}
                                </div>
                                <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                                    dias < 0 ? 'bg-red-600 text-white' :
                                    dias === 0 ? 'bg-amber-600 text-white' :
                                    dias <= 7 ? 'bg-amber-100 text-amber-800' :
                                    'bg-slate-200 text-slate-700'
                                }`}>
                                    {dias < 0 ? `Vencida há ${Math.abs(dias)}d` :
                                     dias === 0 ? 'HOJE' :
                                     `Em ${dias}d`}
                                </span>
                            </div>
                            <div className="bg-white dark:bg-slate-800 divide-y divide-slate-100 dark:divide-slate-700">
                                {lista.map((o, i) => (
                                    <div key={`${o.empresaCnpj || ''}-${o.tipo}-${o.vencimento || i}`} className="p-3 flex items-start gap-3">
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${tipoCor(o.tipo)} flex-shrink-0`}>
                                            {tipoIcon(o.tipo)} {o.tipo}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                                                {o.empresaNome}
                                            </div>
                                            <div className="text-xs text-slate-500">{o.descricao}</div>
                                        </div>
                                        <span className="text-xs text-slate-400 flex-shrink-0">{o.regime}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default CalendarioFiscal;
