/**
 * components/CaixaPostal/index.tsx
 * Dashboard global de Caixa Postal e-CAC.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User, CaixaPostalMensagem, CaixaPostalResumo, CaixaPostalCategoria } from '../../types';
import {
    getResumo, listarMensagens, sincronizarTodas, marcarComoLida,
    categoriaLabel, categoriaColor, isCritica,
} from '../../services/caixaPostalService';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const CaixaPostalDashboard: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [resumo, setResumo] = useState<CaixaPostalResumo | null>(null);
    const [mensagens, setMensagens] = useState<CaixaPostalMensagem[]>([]);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [filtroCategoria, setFiltroCategoria] = useState<CaixaPostalCategoria | ''>('');
    const [soNaoLidas, setSoNaoLidas] = useState(true);
    const [selecionada, setSelecionada] = useState<CaixaPostalMensagem | null>(null);
    const [erro, setErro] = useState<string | null>(null);

    const carregar = async () => {
        setLoading(true);
        setErro(null);
        try {
            const [r, m] = await Promise.all([
                getResumo(currentUser),
                listarMensagens(currentUser, {
                    categoria: filtroCategoria || undefined,
                    naoLidas: soNaoLidas,
                }),
            ]);
            setResumo(r);
            setMensagens(m);
        } catch (e: any) {
            setErro(e?.message || 'Erro ao carregar caixa postal');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, [filtroCategoria, soNaoLidas]);

    const handleSincronizar = async () => {
        setSyncing(true);
        try {
            const r = await sincronizarTodas(currentUser);
            onShowToast?.(`Sincronizado: ${r.sucesso} empresas (${r.falha} falhas)`);
            await carregar();
        } catch (e: any) {
            onShowToast?.(`Erro: ${e.message}`);
        } finally {
            setSyncing(false);
        }
    };

    const handleMarcarLida = async (msg: CaixaPostalMensagem) => {
        try {
            await marcarComoLida(currentUser, msg.id);
            await carregar();
            setSelecionada(null);
            onShowToast?.('Mensagem marcada como lida');
        } catch (e: any) {
            onShowToast?.(`Erro: ${e.message}`);
        }
    };

    const cards = useMemo(() => {
        if (!resumo) return [];
        const cats: CaixaPostalCategoria[] = ['intimacao', 'malha', 'exclusao', 'informativo'];
        return cats.map(c => ({
            categoria: c,
            qtd: resumo.naoLidasPorCategoria[c] || 0,
            ativo: filtroCategoria === c,
        }));
    }, [resumo, filtroCategoria]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">📬 Caixa Postal e-CAC</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Mensagens da Receita Federal por empresa
                        {resumo && (
                            <span className={`ml-2 px-2 py-0.5 rounded text-xs font-bold ${resumo.mode === 'mock' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {resumo.mode === 'mock' ? 'MODO TESTE' : 'PRODUÇÃO'}
                            </span>
                        )}
                    </p>
                </div>
                <button
                    onClick={handleSincronizar}
                    disabled={syncing}
                    className="btn-press flex items-center gap-2 px-4 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 disabled:opacity-50"
                >
                    {syncing ? '⏳ Sincronizando...' : '🔄 Sincronizar Todas'}
                </button>
            </div>

            {/* Cards de resumo */}
            {resumo && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {cards.map(card => (
                        <button
                            key={card.categoria}
                            onClick={() => setFiltroCategoria(card.ativo ? '' : card.categoria)}
                            className={`text-left p-4 rounded-lg border-2 transition-all ${
                                card.ativo
                                    ? 'border-sky-500 ' + categoriaColor(card.categoria)
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-sky-300'
                            }`}
                        >
                            <div className="text-3xl font-bold">{card.qtd}</div>
                            <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                {categoriaLabel(card.categoria)}
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {resumo && resumo.empresasComCriticas > 0 && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <p className="text-red-700 dark:text-red-300 font-bold">
                        ⚠️ {resumo.empresasComCriticas} empresa(s) com pendências críticas (intimação, malha ou exclusão)
                    </p>
                </div>
            )}

            {/* Filtros */}
            <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={soNaoLidas}
                        onChange={e => setSoNaoLidas(e.target.checked)}
                        className="rounded"
                    />
                    Apenas não lidas
                </label>
                {filtroCategoria && (
                    <button
                        onClick={() => setFiltroCategoria('')}
                        className="text-xs text-slate-500 hover:text-slate-700 underline"
                    >
                        Limpar filtro: {categoriaLabel(filtroCategoria)} ✕
                    </button>
                )}
            </div>

            {/* Lista de mensagens */}
            {loading ? (
                <div className="text-center py-12 text-slate-500">Carregando...</div>
            ) : erro ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{erro}</div>
            ) : mensagens.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                    {soNaoLidas ? 'Nenhuma mensagem não lida.' : 'Nenhuma mensagem encontrada.'}
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-900/50 text-left">
                            <tr>
                                <th className="px-4 py-2 font-medium">Status</th>
                                <th className="px-4 py-2 font-medium">Data</th>
                                <th className="px-4 py-2 font-medium">Empresa</th>
                                <th className="px-4 py-2 font-medium">Categoria</th>
                                <th className="px-4 py-2 font-medium">Assunto</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mensagens.map(m => (
                                <tr
                                    key={m.id}
                                    onClick={() => setSelecionada(m)}
                                    className={`border-t border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 ${
                                        !m.dataLeitura ? 'font-semibold' : 'text-slate-500'
                                    }`}
                                >
                                    <td className="px-4 py-2">
                                        {!m.dataLeitura ? <span className="inline-block w-2 h-2 bg-sky-500 rounded-full"></span> : ''}
                                    </td>
                                    <td className="px-4 py-2 font-mono text-xs">
                                        {m.dataEnvio ? m.dataEnvio.slice(0, 10) : '-'}
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className="text-sm">{m.empresaNome || '—'}</div>
                                        <div className="font-mono text-xs text-slate-500">{m.empresaCnpj}</div>
                                    </td>
                                    <td className="px-4 py-2">
                                        <span className={`px-2 py-0.5 rounded text-xs ${categoriaColor(m.categoria)}`}>
                                            {categoriaLabel(m.categoria)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2">{m.assunto}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Modal de detalhe */}
            {selecionada && (
                <div
                    className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[70]"
                    onClick={() => setSelecionada(null)}
                >
                    <div
                        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                            <div className="flex items-center justify-between mb-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${categoriaColor(selecionada.categoria)}`}>
                                    {categoriaLabel(selecionada.categoria)}
                                </span>
                                {isCritica(selecionada.categoria) && (
                                    <span className="text-xs text-red-600 font-bold">⚠️ AÇÃO NECESSÁRIA</span>
                                )}
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                                {selecionada.assunto}
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                                {selecionada.remetente} | {selecionada.dataEnvio?.slice(0, 10)} | {selecionada.empresaNome ? `${selecionada.empresaNome} (${selecionada.empresaCnpj})` : `CNPJ ${selecionada.empresaCnpj}`}
                            </p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                            {selecionada.corpo}
                        </div>
                        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                            <button
                                onClick={() => setSelecionada(null)}
                                className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                                Fechar
                            </button>
                            {!selecionada.dataLeitura && (
                                <button
                                    onClick={() => handleMarcarLida(selecionada)}
                                    className="btn-press px-4 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700"
                                >
                                    Marcar como lida
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CaixaPostalDashboard;
