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
    TransmissaoBloqueada,
    formatPaLabel,
    situacaoLabel,
    situacaoColorClass,
    listarEmpresasDctfweb,
    type DctfwebEmpresaOption,
} from '../../services/dctfwebService';
import DetalheDeclaracao from './DetalheDeclaracao';
import MitApuracao from './MitApuracao';
import { buildDctfwebEmpresaOptions, normalizarCnpjDctfweb } from './dctfwebEmpresaOptions';

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

    // Empresas Lucro Presumido/Real disponiveis para sincronizacao DCTFWeb.
    const [empresas, setEmpresas] = useState<DctfwebEmpresaOption[]>([]);
    const [empresasErro, setEmpresasErro] = useState<string | null>(null);
    const [empresaNovaSyncId, setEmpresaNovaSyncId] = useState<string>('');

    useEffect(() => {
        let ativo = true;
        if (!currentUser) {
            setEmpresas([]);
            setEmpresasErro(null);
            return;
        }
        listarEmpresasDctfweb(currentUser)
            .then(list => {
                if (!ativo) return;
                setEmpresas(list || []);
                setEmpresasErro(null);
            })
            .catch((err: any) => {
                if (!ativo) return;
                setEmpresas([]);
                setEmpresasErro(err?.message || 'Falha ao carregar empresas');
            });
        return () => { ativo = false; };
    }, [currentUser]);

    const empresasDctfwebOptions = useMemo(
        () => buildDctfwebEmpresaOptions(empresas, declaracoes),
        [empresas, declaracoes],
    );

    // sincroniza uma empresa escolhida no dropdown, usando ano/mes dos filtros
    const handleSincronizarNova = async () => {
        if (!currentUser) return;
        const emp = empresasDctfwebOptions.find(e => e.id === empresaNovaSyncId || normalizarCnpjDctfweb(e.cnpj) === empresaNovaSyncId);
        if (!emp) { onShowToast?.('Selecione uma empresa.'); return; }
        if (!mesFiltro) { onShowToast?.('Selecione o mes nos filtros para sincronizar.'); return; }
        const cnpjLimpo = normalizarCnpjDctfweb(emp.cnpj);
        setSyncingEmpresa(cnpjLimpo);
        try {
            await apiSincronizar(currentUser, {
                empresaId: emp.id,
                empresaCnpj: cnpjLimpo,
                anoPA: anoFiltro,
                mesPA: mesFiltro,
            });
            onShowToast?.(`DCTFWeb de ${emp.nome} sincronizada.`);
            await carregar();
        } catch (err: any) {
            onShowToast?.(`Erro: ${err.message}`);
        } finally {
            setSyncingEmpresa(null);
        }
    };

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

    /**
     * Transmitir (ou RETIFICAR) a DCTFWeb.
     *
     * Este é o único ato que FECHA a competência para os outros departamentos —
     * daí as travas: dono fiscal (T1), semáforo (T2), justificativa gravada
     * quando falta insumo (T3) e motivo na retificadora (T5). Emitir GUIA não
     * passa por nada disso: o DARF sai com a declaração em andamento.
     */
    const handleTransmitir = async (decl: DctfwebDeclaracao, retificar = false) => {
        if (!currentUser) return;
        const rotulo = formatPaLabel(decl.anoPA, decl.mesPA);

        let motivo = '';
        if (retificar) {
            motivo = (window.prompt(
                `RETIFICADORA da DCTFWeb ${rotulo}.\n\n`
                + 'Por que esta competência precisa ser retificada?\n'
                + '(ex.: "eSocial fechou dia 18, depois da transmissão dia 12")\n\n'
                + 'O motivo fica na auditoria com o seu nome.',
            ) || '').trim();
            if (!motivo) return;
        } else if (!confirm(`Transmitir DCTFWeb ${rotulo} para ${decl.empresaCnpj}?\n\nCusto SERPRO: ~R$ 0,75`)) {
            return;
        }

        setTransmitindo(decl.id);
        const enviar = async (extra: Record<string, unknown> = {}) => apiTransmitir(currentUser, {
            empresaId: decl.empresaId || '',
            empresaCnpj: decl.empresaCnpj,
            anoPA: decl.anoPA,
            mesPA: decl.mesPA,
            categoria: decl.categoria,
            ...(retificar ? { retificadora: true, motivo } : {}),
            ...extra,
        });

        try {
            let r;
            try {
                r = await enviar();
            } catch (e: any) {
                // T3 — insumo pendente: a trava vira PERGUNTA com os nomes de
                // quem falta, e seguir exige justificativa escrita.
                if (e instanceof TransmissaoBloqueada && e.status === 409 && e.dados?.bloqueado) {
                    const pendentes = (e.dados.pendentes || []).join(', ') || 'outro departamento';
                    const just = (window.prompt(
                        `Falta insumo: ${pendentes}.\n\n`
                        + 'Transmitir agora fecha a competência a menos e vai exigir retificadora depois.\n'
                        + 'Se a guia é o que você precisa, ela sai SEM transmitir (Gerar DARF em andamento).\n\n'
                        + 'Para seguir mesmo assim, escreva por quê (fica na auditoria com o seu nome):',
                    ) || '').trim();
                    if (!just) { setTransmitindo(null); return; }
                    r = await enviar({ confirmarInsumosPendentes: true, justificativa: just });
                } else {
                    throw e;
                }
            }
            const cmp = (r as any).comparacao;
            onShowToast?.(
                `DCTFWeb ${retificar ? 'RETIFICADA' : 'transmitida'}${r.numeroRecibo ? ` (recibo ${r.numeroRecibo})` : ''}.`
                // Retificadora que não mudou nada precisa aparecer: o insumo
                // pode não ter chegado na Receita ainda.
                + (retificar && cmp?.semEfeito ? ' ⚠️ Nenhum débito mudou — confira se o insumo já chegou na Receita.' : '')
                + (retificar && cmp && !cmp.semEfeito ? ` Débitos: ${cmp.linhas.length} alteração(ões).` : ''),
            );
            await carregar();
        } catch (err: any) {
            if (err instanceof TransmissaoBloqueada && err.status === 403) {
                // T1 — não é o dono. A recusa carrega o caminho (a guia).
                onShowToast?.(`${err.message} ${err.dados?.acao || ''}`);
            } else if (err instanceof TransmissaoBloqueada && err.dados?.jaTransmitida) {
                onShowToast?.(err.message);
            } else {
                onShowToast?.(`Erro ao transmitir: ${err.message}`);
            }
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
                    <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">DCTFWeb</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Declaração de Débitos e Créditos Tributários Federais — empresas Lucro Presumido/Real.
                    </p>
                </div>
                {resumo && (
                    <span className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        modo: <strong>{resumo.mode}</strong>
                    </span>
                )}
            </div>

            {/* KPIs */}
            {resumo && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-4">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Total declarações</p>
                        <p className="text-2xl font-semibold text-slate-800 dark:text-slate-100 mt-1">{resumo.totalDeclaracoes}</p>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4">
                        <p className="text-xs text-amber-700 dark:text-amber-300">Pendentes</p>
                        <p className="text-2xl font-semibold text-amber-800 dark:text-amber-300 mt-1">{resumo.pendentes}</p>
                    </div>
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-lg p-4">
                        <p className="text-xs text-emerald-700 dark:text-emerald-300">Transmitidas</p>
                        <p className="text-2xl font-semibold text-emerald-800 dark:text-emerald-300 mt-1">{resumo.transmitidas}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-4">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Empresas c/ pendência</p>
                        <p className="text-2xl font-semibold text-slate-800 dark:text-slate-100 mt-1">{resumo.empresasComPendente}</p>
                    </div>
                </div>
            )}

            {/* Filtros */}
            <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-4 flex flex-wrap gap-3 items-end">
                <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Ano</label>
                    <select
                        value={anoFiltro}
                        onChange={e => setAnoFiltro(Number(e.target.value))}
                        className="border dark:border-slate-600 rounded px-2 py-1 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                    >
                        {[hoje.getFullYear(), hoje.getFullYear() - 1, hoje.getFullYear() - 2].map(a => (
                            <option key={a} value={a}>{a}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Mês</label>
                    <select
                        value={mesFiltro}
                        onChange={e => setMesFiltro(e.target.value ? Number(e.target.value) : '')}
                        className="border dark:border-slate-600 rounded px-2 py-1 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                    >
                        <option value="">Todos</option>
                        {meses.map((m, i) => (
                            <option key={i} value={i + 1}>{m}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Situação</label>
                    <select
                        value={situacaoFiltro}
                        onChange={e => setSituacaoFiltro(e.target.value as any)}
                        className="border dark:border-slate-600 rounded px-2 py-1 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                    >
                        <option value="">Todas</option>
                        <option value="EM_ANDAMENTO">Em andamento</option>
                        <option value="ATIVA">Transmitida</option>
                    </select>
                </div>
                <div className="flex-1 min-w-[220px]">
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Empresa</label>
                    <select
                        value={empresaCnpjFiltro}
                        onChange={e => setEmpresaCnpjFiltro(e.target.value)}
                        className="w-full border dark:border-slate-600 rounded px-2 py-1 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                    >
                        <option value="">Todas as empresas</option>
                        {empresasDctfwebOptions.map(emp => (
                            <option key={emp.id} value={normalizarCnpjDctfweb(emp.cnpj)}>
                                {emp.nome}
                            </option>
                        ))}
                    </select>
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
                <div className="bg-rose-50 border dark:border-slate-700 border-rose-200 text-rose-800 rounded p-3 text-sm">
                    {error}
                </div>
            )}

            {/* Tabela */}
            <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-600 dark:text-slate-300">
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
                            <tr><td colSpan={6} className="text-center text-slate-500 dark:text-slate-400 py-6">
                                Nenhuma declaração encontrada. Use "Sincronizar todas Lucro" no menu lateral ou ajuste filtros.
                            </td></tr>
                        )}
                        {declaracoes.map(d => (
                            <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
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
                                    {!d._erro && d._info && (
                                        <span className="ml-1 text-xs text-sky-600 dark:text-sky-400 cursor-help" title={d._info}>ℹ</span>
                                    )}
                                </td>
                                <td className="px-4 py-2 text-right">
                                    {d.valorTotal != null ? `R$ ${d.valorTotal.toFixed(2)}` : '—'}
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <div className="flex gap-1 justify-center">
                                        <button
                                            onClick={() => setDetalheAberto(d)}
                                            className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded"
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
                                        {/* T5 — RETIFICAR. Só aparece no que já
                                            foi transmitido: retificadora de
                                            declaração não entregue não existe.
                                            Exige motivo escrito, e a auditoria
                                            guarda os débitos antes e depois. */}
                                        {d.situacao === 'ATIVA' && (
                                            <button
                                                onClick={() => handleTransmitir(d, true)}
                                                disabled={transmitindo === d.id}
                                                className="text-xs px-2 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
                                                title="Transmitir RETIFICADORA desta competência (exige motivo)"
                                            >
                                                {transmitindo === d.id ? '...' : '↻ Retificar'}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleSincronizar(d)}
                                            disabled={syncingEmpresa === d.empresaCnpj}
                                            className="text-xs px-2 py-1 bg-sky-100 dark:bg-sky-900/30 hover:bg-sky-200 rounded"
                                            title="Re-sincronizar com SERPRO"
                                        >
                                            {syncingEmpresa === d.empresaCnpj ? '...' : 'Sync'}
                                        </button>
                                        <button
                                            onClick={() => setMitAberto(d)}
                                            className="text-xs px-2 py-1 bg-violet-100 dark:bg-violet-900/30 hover:bg-violet-200 rounded"
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

            {/* Sincronizar DCTFWeb de uma empresa nova (acao esporadica — fica ao fim,
                fora do fluxo principal de visualizar/transmitir declaracoes). */}
            <details className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg">
                <summary className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    + Sincronizar DCTFWeb de uma empresa especifica
                </summary>
                <div className="p-4 flex flex-wrap gap-3 items-end border-t">
                    <div className="flex-1 min-w-[260px]">
                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                            Empresa
                        </label>
                        <select
                            value={empresaNovaSyncId}
                            onChange={e => setEmpresaNovaSyncId(e.target.value)}
                            className="w-full border dark:border-slate-600 rounded px-2 py-1 text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                        >
                            <option value="">Selecione a empresa...</option>
                            {empresasDctfwebOptions.map(emp => (
                                <option key={emp.id} value={emp.id}>{emp.nome}</option>
                            ))}
                            {empresasDctfwebOptions.length === 0 && (
                                <option value="" disabled>Nenhuma empresa de Lucro disponivel</option>
                            )}
                        </select>
                    </div>
                    <button
                        onClick={handleSincronizarNova}
                        disabled={!empresaNovaSyncId || !!syncingEmpresa || empresasDctfwebOptions.length === 0}
                        className="px-4 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
                    >
                        {syncingEmpresa ? 'Sincronizando...' : 'Sincronizar DCTFWeb'}
                    </button>
                    {empresasErro && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 w-full">
                            Cadastro completo indisponivel; exibindo empresas ja sincronizadas.
                        </p>
                    )}
                    <p className="text-xs text-slate-400 dark:text-slate-500 w-full">
                        Usa o Ano e o Mes selecionados nos filtros acima.
                    </p>
                </div>
            </details>

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
