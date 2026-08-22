/**
 * components/TaxEmission/index.tsx
 * Central de Emissões — visão unificada de guias DAS + DARF.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type {
    User, EmissaoResumoConsolidado, DarfEmitido, DarfStatusPagamento,
    LucroPresumidoEmpresa,
} from '../../types';
import { DARF_TRIBUTO_LABELS } from '../../types';
import {
    getResumoConsolidado, formatBRL, statusBadgeClass, statusLabel,
} from '../../services/taxEmissionService';
import { listarDarfs, marcarDarfPago } from '../../services/darfService';
import { getEmpresas as getEmpresasLucro } from '../../services/lucroPresumidoService';
import DarfModal from './DarfModal';
import EmissaoGuardBanner from './EmissaoGuardBanner';
import EmpresaSearchSelect from '../xml/EmpresaSearchSelect';
import { paraEmpresaOptions } from '../../services/empresaOption';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const formatBarras = (barras: string): string => {
    if (!barras || barras.length !== 44) return barras;
    return `${barras.slice(0,11)} ${barras.slice(11,22)} ${barras.slice(22,33)} ${barras.slice(33,44)}`;
};

const TaxEmissionDashboard: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [resumo, setResumo] = useState<EmissaoResumoConsolidado | null>(null);
    const [darfs, setDarfs] = useState<DarfEmitido[]>([]);
    const [empresas, setEmpresas] = useState<LucroPresumidoEmpresa[]>([]);
    const [loading, setLoading] = useState(false);
    const [filtroStatus, setFiltroStatus] = useState<DarfStatusPagamento | ''>('');
    const [filtroEmpresa, setFiltroEmpresa] = useState('');
    // Escolha PENDENTE: trocar de empresa não busca nada. Só o ⚡ Ativar move
    // pro `filtroEmpresa`, que é quem dispara resumo + lista + carteira.
    const [empresaEscolhida, setEmpresaEscolhida] = useState('');
    const [filtroTributo, setFiltroTributo] = useState('');
    const [selecionado, setSelecionado] = useState<DarfEmitido | null>(null);
    const [mostrarModalEmitir, setMostrarModalEmitir] = useState(false);

    const carregar = async () => {
        setLoading(true);
        try {
            const [r, d, e] = await Promise.all([
                getResumoConsolidado(currentUser),
                listarDarfs(currentUser, {
                    status: filtroStatus || undefined,
                    empresaId: filtroEmpresa || undefined,
                    tributo: (filtroTributo as any) || undefined,
                }),
                getEmpresasLucro(currentUser),
            ]);
            setResumo(r);
            setDarfs(d);
            setEmpresas(e);
        } catch (err: any) {
            onShowToast?.(`Erro: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, [filtroStatus, filtroEmpresa, filtroTributo]);

    const handleMarcarPago = async (doc: DarfEmitido) => {
        try {
            await marcarDarfPago(currentUser, doc.id);
            await carregar();
            setSelecionado(null);
            onShowToast?.('DARF marcada como paga');
        } catch (e: any) {
            onShowToast?.(`Erro: ${e.message}`);
        }
    };

    const cards = useMemo(() => {
        if (!resumo) return [];
        return [
            { label: 'Total Guias', valor: resumo.totalGuias, cor: 'bg-slate-100 dark:bg-slate-700', clave: '' as const },
            { label: 'Pendentes',   valor: resumo.pendentes,  valorBRL: resumo.valorPendente, cor: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',          clave: 'pendente' as DarfStatusPagamento },
            { label: 'Vencidos',    valor: resumo.vencidos,   valorBRL: resumo.valorVencido,  valorExtra: (resumo.valorMultaEstimada && resumo.valorMultaEstimada > 0) ? `+ ${formatBRL(resumo.valorMultaEstimada)} mora` : undefined,  cor: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',          clave: 'vencido'  as DarfStatusPagamento },
            { label: 'Pagas',       valor: resumo.pagos,      valorBRL: resumo.valorPago,     cor: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300', clave: 'pago'     as DarfStatusPagamento },
        ];
    }, [resumo]);

    const copiarBarras = (b: string) => {
        navigator.clipboard?.writeText(b).then(
            () => onShowToast?.('Código de barras copiado'),
            () => onShowToast?.('Falha ao copiar')
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                        🧾 Central de Emissões
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Emissão e controle unificado de DAS, DARF e guias federais
                        {resumo && (
                            <>
                                <span className={`ml-2 px-2 py-0.5 rounded text-xs font-bold ${resumo.modes.das === 'mock' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                    DAS {resumo.modes.das === 'mock' ? 'TESTE' : 'PROD'}
                                </span>
                                <span className={`ml-2 px-2 py-0.5 rounded text-xs font-bold ${resumo.modes.darf === 'mock' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                    DARF {resumo.modes.darf === 'mock' ? 'TESTE' : 'PROD'}
                                </span>
                            </>
                        )}
                    </p>
                </div>
                <button
                    onClick={() => setMostrarModalEmitir(true)}
                    className="btn-press px-4 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700"
                >
                    + Emitir DARF
                </button>
            </div>

            {/* O freio de emissão — antes só se via abrindo o Cloud Run. */}
            <EmissaoGuardBanner currentUser={currentUser} />

            {/* Cards consolidados */}
            {resumo && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {cards.map(c => (
                        <button
                            key={c.label}
                            onClick={() => setFiltroStatus(filtroStatus === c.clave ? '' : (c.clave as DarfStatusPagamento))}
                            className={`text-left p-4 rounded-lg border-2 transition-all ${
                                c.clave && filtroStatus === c.clave
                                    ? 'border-sky-500 ' + c.cor
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-sky-300'
                            }`}
                        >
                            <div className="text-3xl font-bold">{c.valor}</div>
                            <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">{c.label}</div>
                            {c.valorBRL !== undefined && (
                                <div className="text-xs text-slate-500 mt-0.5">{formatBRL(c.valorBRL)}</div>
                            )}
                            {(c as any).valorExtra && (
                                <div className="text-[10px] text-red-600 dark:text-red-400 mt-0.5" title="Multa de mora + juros SELIC estimados — confirme no SERPRO antes de pagar.">
                                    {(c as any).valorExtra}
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            )}

            {/* Breakdown por origem */}
            {resumo && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">DAS Simples Nacional</h3>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-400">
                            <div><div className="text-lg font-bold text-slate-800 dark:text-slate-100">{resumo.breakdown.das.total}</div>Total</div>
                            <div><div className="text-lg font-bold text-sky-700 dark:text-sky-300">{resumo.breakdown.das.pendentes}</div>Pendentes</div>
                            <div><div className="text-lg font-bold text-red-700 dark:text-red-300">{resumo.breakdown.das.vencidos}</div>Vencidos</div>
                        </div>
                        <div className="mt-2 text-xs text-slate-500">{formatBRL(resumo.breakdown.das.valorTotal)} total</div>
                    </div>
                    <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">DARF Presumido/Real</h3>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-400">
                            <div><div className="text-lg font-bold text-slate-800 dark:text-slate-100">{resumo.breakdown.darf.total}</div>Total</div>
                            <div><div className="text-lg font-bold text-sky-700 dark:text-sky-300">{resumo.breakdown.darf.pendentes}</div>Pendentes</div>
                            <div><div className="text-lg font-bold text-red-700 dark:text-red-300">{resumo.breakdown.darf.vencidos}</div>Vencidos</div>
                        </div>
                        <div className="mt-2 text-xs text-slate-500">{formatBRL(resumo.breakdown.darf.valorTotal)} total</div>
                        {Object.keys(resumo.breakdown.darf.porTributo || {}).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                                {Object.entries(resumo.breakdown.darf.porTributo).map(([t, v]) => (
                                    <span key={t} className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">
                                        {t}: {v.qtd}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[320px] flex-1">
                    <EmpresaSearchSelect
                        empresas={paraEmpresaOptions(empresas, 'lucro')}
                        value={empresaEscolhida}
                        onChange={setEmpresaEscolhida}
                        onAtivar={(id) => setFiltroEmpresa(id)}
                        permitirLimpar
                        rotuloVazio="Todas as empresas"
                    />
                </div>
                <select
                    value={filtroTributo}
                    onChange={e => setFiltroTributo(e.target.value)}
                    className="px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                >
                    <option value="">Todos os tributos</option>
                    {Object.entries(DARF_TRIBUTO_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                    ))}
                </select>
                {(filtroStatus || filtroEmpresa || filtroTributo) && (
                    <button
                        onClick={() => { setFiltroStatus(''); setFiltroEmpresa(''); setFiltroTributo(''); setEmpresaEscolhida(''); }}
                        className="text-xs text-slate-500 hover:text-slate-700 underline"
                    >
                        Limpar filtros ✕
                    </button>
                )}
            </div>

            {/* Tabela DARFs */}
            <div>
                <h3 className="font-bold text-slate-700 dark:text-slate-200 mb-2">DARFs emitidas</h3>
                {loading ? (
                    <div className="text-center py-12 text-slate-500">Carregando...</div>
                ) : darfs.length === 0 ? (
                    <div className="text-center py-12 text-slate-500 bg-white dark:bg-slate-800 rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
                        Nenhuma DARF encontrada. Clique em "Emitir DARF" pra começar.
                    </div>
                ) : (
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-900/50 text-left">
                                <tr>
                                    <th className="px-4 py-2 font-medium">Empresa</th>
                                    <th className="px-4 py-2 font-medium">Tributo</th>
                                    <th className="px-4 py-2 font-medium">Regime</th>
                                    <th className="px-4 py-2 font-medium">Competência</th>
                                    <th className="px-4 py-2 font-medium">Código</th>
                                    <th className="px-4 py-2 font-medium text-right">Valor</th>
                                    <th className="px-4 py-2 font-medium">Vencimento</th>
                                    <th className="px-4 py-2 font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {darfs.map(d => (
                                    <tr
                                        key={d.id}
                                        onClick={() => setSelecionado(d)}
                                        className="border-t border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50"
                                    >
                                        <td className="px-4 py-2">{d.empresaNome}</td>
                                        <td className="px-4 py-2 font-medium">{DARF_TRIBUTO_LABELS[d.tributo] || d.tributo}</td>
                                        <td className="px-4 py-2 text-xs text-slate-500">{d.regime}</td>
                                        <td className="px-4 py-2 font-mono text-xs">{d.competencia}</td>
                                        <td className="px-4 py-2 font-mono text-xs">{d.codigoReceita}</td>
                                        <td className="px-4 py-2 text-right font-mono">
                                            {formatBRL(d.valor)}
                                            {d.statusPagamento === 'vencido' && d.multaEstimada && (
                                                <div
                                                    className="text-[10px] text-red-600 dark:text-red-400 mt-0.5"
                                                    title={`Multa ${d.multaEstimada.multaPct.toFixed(2)}% + juros SELIC ${d.multaEstimada.jurosPct.toFixed(2)}% (${d.multaEstimada.dias} dias). Estimativa — confirme no SERPRO antes de pagar.`}
                                                >
                                                    +{formatBRL(d.multaEstimada.multaValor + d.multaEstimada.jurosValor)} mora ⓘ
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-2 font-mono text-xs">{d.vencimento}</td>
                                        <td className="px-4 py-2">
                                            <span className={`px-2 py-0.5 rounded text-xs ${statusBadgeClass(d.statusPagamento)}`}>
                                                {statusLabel(d.statusPagamento)}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal emissão */}
            {mostrarModalEmitir && (
                <DarfModal
                    currentUser={currentUser}
                    empresas={empresas}
                    onClose={() => setMostrarModalEmitir(false)}
                    onEmitido={carregar}
                    onShowToast={onShowToast}
                />
            )}

            {/* Modal detalhe */}
            {selecionado && (
                <div
                    className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-[70] overflow-y-auto"
                    onClick={() => setSelecionado(null)}
                >
                    <div
                        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl my-auto"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                            <div className="flex items-center justify-between mb-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${statusBadgeClass(selecionado.statusPagamento)}`}>
                                    {statusLabel(selecionado.statusPagamento)}
                                </span>
                                <span className="text-xs text-slate-500">
                                    {DARF_TRIBUTO_LABELS[selecionado.tributo]} {selecionado.regime}
                                </span>
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                                {selecionado.empresaNome}
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                CNPJ {selecionado.empresaCnpj} | Competência {selecionado.competencia}
                            </p>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-3 gap-4 text-sm">
                                <div>
                                    <div className="text-xs text-slate-500">Principal</div>
                                    <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{formatBRL(selecionado.valorPrincipal)}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-500">Multa + Juros</div>
                                    <div className="text-lg font-bold text-amber-700 dark:text-amber-400">
                                        {formatBRL((selecionado.multa || 0) + (selecionado.juros || 0))}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-500">Total</div>
                                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{formatBRL(selecionado.valor)}</div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <div className="text-xs text-slate-500">Vencimento</div>
                                    <div className="font-mono">{selecionado.vencimento}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-500">Código Receita</div>
                                    <div className="font-mono">{selecionado.codigoReceita}</div>
                                </div>
                            </div>

                            <div>
                                <div className="text-xs text-slate-500 mb-1">Número do documento</div>
                                <div className="font-mono text-xs bg-slate-50 dark:bg-slate-900/40 px-3 py-2 rounded break-all">
                                    {selecionado.numeroDocumento}
                                </div>
                            </div>

                            <div>
                                <div className="text-xs text-slate-500 mb-1">Código de barras (clique pra copiar)</div>
                                <button
                                    onClick={() => copiarBarras(selecionado.codigoBarras)}
                                    className="w-full font-mono text-xs bg-slate-50 dark:bg-slate-900/40 px-3 py-2 rounded text-left hover:bg-slate-100 dark:hover:bg-slate-700 break-all"
                                >
                                    {formatBarras(selecionado.codigoBarras)}
                                </button>
                            </div>

                            {selecionado.observacao && (
                                <div>
                                    <div className="text-xs text-slate-500 mb-1">Observação</div>
                                    <div className="text-sm">{selecionado.observacao}</div>
                                </div>
                            )}

                            {selecionado.modeUsado === 'mock' && (
                                <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
                                    ⓘ DARF gerada em modo TESTE — código de barras fictício, não pague no banco.
                                    Para produção real, contrate o produto DARF do Integra Contador SERPRO e
                                    ative DARF_MODE=serpro.
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                            <button
                                onClick={() => setSelecionado(null)}
                                className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                                Fechar
                            </button>
                            {selecionado.statusPagamento !== 'pago' && (
                                <button
                                    onClick={() => handleMarcarPago(selecionado)}
                                    className="btn-press px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700"
                                >
                                    ✓ Marcar como paga
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TaxEmissionDashboard;
