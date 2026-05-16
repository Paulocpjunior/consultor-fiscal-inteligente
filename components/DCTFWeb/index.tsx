/**
 * components/DCTFWeb/index.tsx
 *
 * Dashboard principal DCTFWeb — lista declaracoes pendentes/transmitidas
 * com filtros, acoes (sincronizar/transmitir/gerar DARF) e abertura de modais.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { User, DctfwebDeclaracao, DctfwebResumo, DctfwebCategoria } from '../../types';
import { DCTFWEB_CATEGORIA_LABELS } from '../../types';
import {
    getResumo,
    listarDeclaracoes,
    sincronizarEmpresa as apiSincronizar,
    transmitirDeclaracao as apiTransmitir,
    formatPaLabel,
    situacaoLabel,
    situacaoColorClass,
} from '../../services/dctfwebService';
import DetalheDeclaracao from './DetalheDeclaracao';
import MitApuracao from './MitApuracao';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const DCTFWebDashboard: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [resumo, setResumo] = useState<DctfwebResumo | null>(null);
    const [declaracoes, setDeclaracoes] = useState<DctfwebDeclaracao[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // filtros
    const hoje = new Date();
    const [anoFiltro, setAnoFiltro] = useState<number>(hoje.getFullYear());
    const [mesFiltro, setMesFiltro] = useState<number | ''>('');
    const [situacaoFiltro, setSituacaoFiltro] = useState<'' | 'EM_ANDAMENTO' | 'ATIVA'>('');
    const [empresaCnpjFiltro, setEmpresaCnpjFiltro] = useState('');

    // modais
    const [detalheAberto, setDetalheAberto] = useState<DctfwebDeclaracao | null>(null);
    const [mitAberto, setMitAberto] = useState<DctfwebDeclaracao | null>(null);

    // sync individual em andamento
    const [syncingEmpresa, setSyncingEmpresa] = useState<string | null>(null);
    const [transmitindo, setTransmitindo] = useState<string | null>(null);

    const carregar = useCallback(async () => {
        if (!currentUser) return;
        setLoading(true);
        setError(null);
        try {
            const [r, lista] = await Promise.all([
                getResumo(currentUser),
                listarDeclaracoes(currentUser, {
                    empresaCnpj: empresaCnpjFiltro || undefined,
                    situacao: situacaoFiltro || undefined,
                    anoPA: anoFiltro || undefined,
                    mesPA: mesFiltro || undefined,
                }),
            ]);
            setResumo(r);
            setDeclaracoes(lista);
        } catch (err: any) {
            setError(err.message || 'Erro ao carregar dados');
        } finally {
            setLoading(false);
        }
    }, [currentUser, anoFiltro, mesFiltro, situacaoFiltro, empresaCnpjFiltro]);

    useEffect(() => { carregar(); }, [carregar]);

    const handleSincronizar = async (decl: DctfwebDeclaracao) => {
        if (!currentUser) return;
        setSyncingEmpresa(decl.empresaCnpj);
        try {
            await apiSincronizar(currentUser, {
                empresaId: decl.empresaId || '',
                empresaCnpj: decl.empresaCnpj,
                anoPA: decl.anoPA,
                mesPA: decl.mesPA,
                categoria: decl.categoria,
            });
            onShowToast?.('Declaração sincronizada com SERPRO.');
            await carregar();
        } catch (err: any) {
            onShowToast?.(`Erro: ${err.message}`);
        } finally {
            setSyncingEmpresa(null);
        }
    };

    const handleTransmitir = async (decl: DctfwebDeclaracao) => {
        if (!currentUser) return;
        if (!confirm(`Transmitir DCTFWeb ${formatPaLabel(decl.anoPA, decl.mesPA)} para ${decl.empresaCnpj}?\n\nCusto SERPRO: ~R$ 0,75`)) return;
        setTransmitindo(decl.id);
        try {
            const r = await apiTransmitir(currentUser, {
                empresaId: decl.empresaId || '',
                empresaCnpj: decl.empresaCnpj,
                anoPA: decl.anoPA,
                mesPA: decl.mesPA,
                categoria: decl.categoria,
            });
            onShowToast?.(`DCTFWeb transmitida${r.numeroRecibo ? ` (recibo ${r.numeroRecibo})` : ''}.`);
            await carregar();
        } catch (err: any) {
            onShowToast?.(`Erro ao transmitir: ${err.message}`);
        } finally {
            setTransmitindo(null);
        }
    };

    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    return (
        <div className="p-6 space-y-6">
            {/* Cabeçalho */}
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-2xl font-semibold text-slate-800">DCTFWeb</h2>
                    <p className="text-sm text-slate-500 mt-1">
                        Declaração de Débitos e Créditos Tributários Federais — empresas Lucro Presumido/Real.
                    </p>
                </div>
                {resumo && (
                    <span className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600">
                        modo: <strong>{resumo.mode}</strong>
                    </span>
                )}
            </div>

            {/* KPIs */}
            {resumo && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white border rounded-lg p-4">
                        <p className="text-xs text-slate-500">Total declarações</p>
                        <p className="text-2xl font-semibold text-slate-800 mt-1">{resumo.totalDeclaracoes}</p>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                        <p className="text-xs text-amber-700">Pendentes</p>
                        <p className="text-2xl font-semibold text-amber-800 mt-1">{resumo.pendentes}</p>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                        <p className="text-xs text-emerald-700">Transmitidas</p>
                        <p className="text-2xl font-semibold text-emerald-800 mt-1">{resumo.transmitidas}</p>
                    </div>
                    <div className="bg-white border rounded-lg p-4">
                        <p className="text-xs text-slate-500">Empresas c/ pendência</p>
                        <p className="text-2xl font-semibold text-slate-800 mt-1">{resumo.empresasComPendente}</p>
                    </div>
                </div>
            )}

            {/* Filtros */}
            <div className="bg-white border rounded-lg p-4 flex flex-wrap gap-3 items-end">
                <div>
                    <label className="block text-xs text-slate-500 mb-1">Ano</label>
                    <select
                        value={anoFiltro}
                        onChange={e => setAnoFiltro(Number(e.target.value))}
                        className="border rounded px-2 py-1 text-sm"
                    >
                        {[hoje.getFullYear(), hoje.getFullYear() - 1, hoje.getFullYear() - 2].map(a => (
                            <option key={a} value={a}>{a}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-xs text-slate-500 mb-1">Mês</label>
                    <select
                        value={mesFiltro}
                        onChange={e => setMesFiltro(e.target.value ? Number(e.target.value) : '')}
                        className="border rounded px-2 py-1 text-sm"
                    >
                        <option value="">Todos</option>
                        {meses.map((m, i) => (
                            <option key={i} value={i + 1}>{m}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-xs text-slate-500 mb-1">Situação</label>
                    <select
                        value={situacaoFiltro}
                        onChange={e => setSituacaoFiltro(e.target.value as any)}
                        className="border rounded px-2 py-1 text-sm"
                    >
                        <option value="">Todas</option>
                        <option value="EM_ANDAMENTO">Em andamento</option>
                        <option value="ATIVA">Transmitida</option>
                    </select>
                </div>
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs text-slate-500 mb-1">CNPJ</label>
                    <input
                        type="text"
                        placeholder="Filtrar por CNPJ"
                        value={empresaCnpjFiltro}
                        onChange={e => setEmpresaCnpjFiltro(e.target.value)}
                        className="w-full border rounded px-2 py-1 text-sm"
                    />
                </div>
                <button
                    onClick={carregar}
                    disabled={loading}
                    className="px-4 py-1.5 bg-sky-600 text-white rounded text-sm hover:bg-sky-700 disabled:opacity-50"
                >
                    {loading ? 'Carregando...' : 'Recarregar'}
                </button>
            </div>

            {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded p-3 text-sm">
                    {error}
                </div>
            )}

            {/* Tabela */}
            <div className="bg-white border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                        <tr>
                            <th className="px-4 py-2 text-left">CNPJ</th>
                            <th className="px-4 py-2 text-left">Competência</th>
                            <th className="px-4 py-2 text-left">Categoria</th>
                            <th className="px-4 py-2 text-left">Situação</th>
                            <th className="px-4 py-2 text-right">Valor</th>
                            <th className="px-4 py-2 text-center">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {declaracoes.length === 0 && !loading && (
                            <tr><td colSpan={6} className="text-center text-slate-500 py-6">
                                Nenhuma declaração encontrada. Use "Sincronizar todas Lucro" no menu lateral ou ajuste filtros.
                            </td></tr>
                        )}
                        {declaracoes.map(d => (
                            <tr key={d.id} className="hover:bg-slate-50">
                                <td className="px-4 py-2 font-mono text-xs">{d.empresaCnpj}</td>
                                <td className="px-4 py-2">{formatPaLabel(d.anoPA, d.mesPA)}</td>
                                <td className="px-4 py-2 text-xs">{DCTFWEB_CATEGORIA_LABELS[d.categoria] || d.categoria}</td>
                                <td className="px-4 py-2">
                                    <span className={`text-xs px-2 py-0.5 rounded ${situacaoColorClass(d.situacao)}`}>
                                        {situacaoLabel(d.situacao)}
                                    </span>
                                    {d._erro && (
                                        <span className="ml-1 text-xs text-rose-600" title={d._erro}>⚠</span>
                                    )}
                                </td>
                                <td className="px-4 py-2 text-right">
                                    {d.valorTotal != null ? `R$ ${d.valorTotal.toFixed(2)}` : '—'}
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <div className="flex gap-1 justify-center">
                                        <button
                                            onClick={() => setDetalheAberto(d)}
                                            className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded"
                                            title="Ver detalhe (PDF + recibo + DARF)"
                                        >
                                            Detalhe
                                        </button>
                                        {d.situacao === 'EM_ANDAMENTO' && (
                                            <button
                                                onClick={() => handleTransmitir(d)}
                                                disabled={transmitindo === d.id}
                                                className="text-xs px-2 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                                                title="Transmitir declaração (R$ 0,75)"
                                            >
                                                {transmitindo === d.id ? '...' : 'Transmitir'}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleSincronizar(d)}
                                            disabled={syncingEmpresa === d.empresaCnpj}
                                            className="text-xs px-2 py-1 bg-sky-100 hover:bg-sky-200 rounded"
                                            title="Re-sincronizar com SERPRO"
                                        >
                                            {syncingEmpresa === d.empresaCnpj ? '...' : 'Sync'}
                                        </button>
                                        <button
                                            onClick={() => setMitAberto(d)}
                                            className="text-xs px-2 py-1 bg-violet-100 hover:bg-violet-200 rounded"
                                            title="Apuração MIT"
                                        >
                                            MIT
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Modais */}
            {detalheAberto && (
                <DetalheDeclaracao
                    declaracao={detalheAberto}
                    user={currentUser}
                    onClose={() => setDetalheAberto(null)}
                    onShowToast={onShowToast}
                />
            )}
            {mitAberto && (
                <MitApuracao
                    declaracao={mitAberto}
                    user={currentUser}
                    onClose={() => setMitAberto(null)}
                    onShowToast={onShowToast}
                />
            )}
        </div>
    );
};

export default DCTFWebDashboard;
