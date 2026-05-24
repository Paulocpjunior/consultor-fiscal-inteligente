/**
 * components/RecuperacaoTributaria/index.tsx
 * Recuperacao Tributaria — identifica impostos pagos a maior e oportunidades
 * de restituicao/compensacao por empresa.
 */
import React, { useEffect, useState, useMemo } from 'react';
import type { User } from '../../types';
import {
    getTeses,
    analisarTodas,
    gerarParecerIa,
} from '../../services/recuperacaoTributariaService';
import LoadingSpinner from '../LoadingSpinner';
import { FormattedText } from '../FormattedText';
import {
    Search,
    FileText,
    DollarSign,
    AlertTriangle,
    CheckCircle,
    ChevronDown,
    ChevronUp,
    Sparkles,
    Building2,
    Scale,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types (local — API shapes)                                         */
/* ------------------------------------------------------------------ */

interface Tese {
    id: string;
    nome: string;
    descricao: string;
    fundamentoLegal: string;
    regimes: string[];
    tributos: string[];
}

interface ItemRecuperacao {
    competencia: string;
    descricao: string;
    valorOriginal: number;
    valorRecuperavel: number;
}

interface TeseResultado {
    tese: Tese;
    oportunidade: boolean;
    valorEstimado: number;
    itens: ItemRecuperacao[];
}

interface EmpresaResultado {
    empresaId: string;
    empresaNome: string;
    empresaCnpj: string;
    regime: string;
    totalRecuperavel: number;
    teses: TeseResultado[];
}

interface AnaliseGlobal {
    geradoEm: string;
    totalEmpresas: number;
    empresasComOportunidade: number;
    totalRecuperavel: number;
    resultados: EmpresaResultado[];
}

interface ParecerIa {
    parecer: string;
    modelo: string;
    geradoEm: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatBRL = (v: number): string =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const RecuperacaoTributaria: React.FC<Props> = ({ currentUser, onShowToast }) => {
    // Catalog of theses (shown before analysis)
    const [tesesCatalog, setTesesCatalog] = useState<Tese[]>([]);
    const [loadingTeses, setLoadingTeses] = useState(false);

    // Analysis results
    const [data, setData] = useState<AnaliseGlobal | null>(null);
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    // Per-empresa expanded state
    const [expandedEmpresa, setExpandedEmpresa] = useState<string | null>(null);

    // Per-tese AI parecer state (key = `${empresaId}__${teseId}`)
    const [parecerLoading, setParecerLoading] = useState<string | null>(null);
    const [pareceres, setPareceres] = useState<Record<string, ParecerIa>>({});

    // Filter
    const [filtro, setFiltro] = useState('');

    /* ---------- Load teses catalog on mount ---------- */
    useEffect(() => {
        const load = async () => {
            setLoadingTeses(true);
            try {
                const r = await getTeses();
                setTesesCatalog(r.teses ?? r ?? []);
            } catch {
                // silently fail — catalog is informational
            } finally {
                setLoadingTeses(false);
            }
        };
        load();
    }, []);

    /* ---------- Global analysis ---------- */
    const handleAnalisarTodas = async () => {
        setLoading(true);
        setErro(null);
        try {
            const r = await analisarTodas();
            setData(r);
            if (r.empresasComOportunidade === 0) {
                onShowToast?.('Nenhuma oportunidade de recuperacao encontrada.');
            }
        } catch (e: any) {
            setErro(e?.message || 'Erro ao analisar');
            onShowToast?.(`Erro: ${e?.message || 'falha na analise'}`);
        } finally {
            setLoading(false);
        }
    };

    /* ---------- AI Parecer ---------- */
    const handleGerarParecer = async (empresa: EmpresaResultado, tr: TeseResultado) => {
        const key = `${empresa.empresaId}__${tr.tese.id}`;
        if (pareceres[key]) return; // already generated

        setParecerLoading(key);
        try {
            const r = await gerarParecerIa(empresa.empresaNome, tr.tese, tr.itens);
            setPareceres(prev => ({ ...prev, [key]: r }));
        } catch (e: any) {
            onShowToast?.(`Erro IA: ${e?.message || 'falha ao gerar parecer'}`);
        } finally {
            setParecerLoading(null);
        }
    };

    /* ---------- Derived ---------- */
    const resultadosOrdenados = useMemo(() => {
        if (!data) return [];
        let list = [...data.resultados].sort((a, b) => b.totalRecuperavel - a.totalRecuperavel);
        if (filtro.trim()) {
            const q = filtro.toLowerCase();
            list = list.filter(
                r =>
                    r.empresaNome.toLowerCase().includes(q) ||
                    r.empresaCnpj.includes(q)
            );
        }
        return list;
    }, [data, filtro]);

    const summaryCards = useMemo(() => {
        if (!data) return null;
        return {
            totalRecuperavel: data.totalRecuperavel,
            empresasComOportunidade: data.empresasComOportunidade,
            tesesComOportunidade: new Set(
                data.resultados.flatMap(r => r.teses.filter(t => t.oportunidade).map(t => t.tese.id))
            ).size,
        };
    }, [data]);

    /* ---------- Render ---------- */
    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Scale className="w-6 h-6" style={{ color: 'var(--accent)' }} />
                        Recuperacao Tributaria
                    </h2>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                        Identifica impostos pagos a maior e oportunidades de restituicao ou compensacao
                        por empresa, com base em teses tributarias consolidadas.
                    </p>
                </div>
                <button
                    onClick={handleAnalisarTodas}
                    disabled={loading}
                    className="btn-press px-5 py-2.5 text-white font-bold rounded-lg disabled:opacity-50 flex items-center gap-2 transition-colors"
                    style={{ background: 'var(--accent)' }}
                >
                    {loading ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Analisando...
                        </>
                    ) : (
                        <>
                            <Search className="w-4 h-4" />
                            Analisar Todas as Empresas
                        </>
                    )}
                </button>
            </div>

            {/* Error */}
            {erro && (
                <div
                    className="rounded-lg p-4 text-sm flex items-start gap-2"
                    style={{
                        background: 'var(--danger)',
                        color: '#fff',
                        opacity: 0.9,
                    }}
                >
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <span>{erro}</span>
                </div>
            )}

            {/* Loading spinner */}
            {loading && (
                <div className="py-12">
                    <LoadingSpinner />
                    <p className="text-center text-sm mt-3" style={{ color: 'var(--text-muted)' }}>
                        Analisando todas as empresas... isso pode levar alguns segundos.
                    </p>
                </div>
            )}

            {/* Summary Cards */}
            {summaryCards && !loading && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div
                        className="rounded-lg p-4"
                        style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--success)',
                        }}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <DollarSign className="w-4 h-4" style={{ color: 'var(--success)' }} />
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                Total estimado recuperavel
                            </span>
                        </div>
                        <div className="text-2xl font-bold" style={{ color: 'var(--success)' }}>
                            {formatBRL(summaryCards.totalRecuperavel)}
                        </div>
                    </div>
                    <div
                        className="rounded-lg p-4"
                        style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-subtle)',
                        }}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <Building2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                Empresas com oportunidade
                            </span>
                        </div>
                        <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                            {summaryCards.empresasComOportunidade}
                        </div>
                    </div>
                    <div
                        className="rounded-lg p-4"
                        style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-subtle)',
                        }}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <FileText className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                Teses com oportunidade
                            </span>
                        </div>
                        <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                            {summaryCards.tesesComOportunidade}
                        </div>
                    </div>
                </div>
            )}

            {/* Filter (only when we have data) */}
            {data && !loading && data.resultados.length > 0 && (
                <div className="relative">
                    <Search
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                        style={{ color: 'var(--text-muted)' }}
                    />
                    <input
                        type="text"
                        value={filtro}
                        onChange={e => setFiltro(e.target.value)}
                        placeholder="Filtrar por nome ou CNPJ..."
                        className="w-full pl-9 pr-4 py-2 rounded-lg text-sm outline-none"
                        style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-default)',
                            color: 'var(--text-primary)',
                        }}
                    />
                </div>
            )}

            {/* Empty state: no analysis yet — show tese catalog */}
            {!data && !loading && (
                <div className="space-y-4">
                    <div
                        className="text-center py-10 rounded-lg"
                        style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-subtle)',
                        }}
                    >
                        <Scale className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--accent)' }} />
                        <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                            Nenhuma analise realizada ainda
                        </h3>
                        <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
                            Clique em "Analisar Todas as Empresas" para identificar oportunidades de
                            recuperacao tributaria em sua carteira de clientes.
                        </p>
                    </div>

                    {/* Tese catalog cards */}
                    {tesesCatalog.length > 0 && (
                        <div>
                            <h3 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
                                Teses Tributarias Analisadas
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {tesesCatalog.map(t => (
                                    <div
                                        key={t.id}
                                        className="rounded-lg p-4 space-y-2"
                                        style={{
                                            background: 'var(--bg-elevated)',
                                            border: '1px solid var(--border-subtle)',
                                        }}
                                    >
                                        <div className="flex items-start gap-2">
                                            <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
                                            <h4 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                                                {t.nome}
                                            </h4>
                                        </div>
                                        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                            {t.descricao}
                                        </p>
                                        <div className="flex flex-wrap gap-1">
                                            {t.regimes.map(r => (
                                                <span
                                                    key={r}
                                                    className="px-2 py-0.5 rounded text-[10px] font-medium"
                                                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                                                >
                                                    {r}
                                                </span>
                                            ))}
                                            {t.tributos.map(tr => (
                                                <span
                                                    key={tr}
                                                    className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-700"
                                                    style={{ color: 'var(--text-muted)' }}
                                                >
                                                    {tr}
                                                </span>
                                            ))}
                                        </div>
                                        <p className="text-[10px] italic" style={{ color: 'var(--text-muted)' }}>
                                            {t.fundamentoLegal}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {loadingTeses && (
                        <div className="py-4">
                            <LoadingSpinner small />
                        </div>
                    )}
                </div>
            )}

            {/* No opportunities found */}
            {data && !loading && data.empresasComOportunidade === 0 && (
                <div
                    className="text-center py-12 rounded-lg"
                    style={{
                        background: 'var(--accent-soft)',
                        border: '1px solid var(--success)',
                    }}
                >
                    <CheckCircle className="w-10 h-10 mx-auto mb-2" style={{ color: 'var(--success)' }} />
                    <h3 className="text-lg font-bold" style={{ color: 'var(--success)' }}>
                        Nenhuma oportunidade identificada
                    </h3>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                        Todas as empresas da carteira estao com a tributacao correta para as teses analisadas.
                    </p>
                </div>
            )}

            {/* Results table */}
            {data && !loading && resultadosOrdenados.length > 0 && (
                <div className="space-y-2">
                    {resultadosOrdenados.map(emp => {
                        const isExpanded = expandedEmpresa === emp.empresaId;
                        const temOportunidade = emp.totalRecuperavel > 0;

                        return (
                            <div
                                key={emp.empresaId}
                                className="rounded-lg overflow-hidden transition-all"
                                style={{
                                    background: 'var(--bg-elevated)',
                                    border: `1px solid ${temOportunidade ? 'var(--success)' : 'var(--border-subtle)'}`,
                                }}
                            >
                                {/* Empresa header row */}
                                <button
                                    onClick={() => setExpandedEmpresa(isExpanded ? null : emp.empresaId)}
                                    className="w-full text-left p-4 flex items-center justify-between gap-3 hover:opacity-90 transition-opacity"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Building2
                                            className="w-5 h-5 flex-shrink-0"
                                            style={{ color: temOportunidade ? 'var(--success)' : 'var(--text-muted)' }}
                                        />
                                        <div className="min-w-0">
                                            <div className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                                                {emp.empresaNome}
                                            </div>
                                            <div className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                                                <span>{emp.empresaCnpj}</span>
                                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-700">
                                                    {emp.regime}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4 flex-shrink-0">
                                        {/* Tese status badges */}
                                        <div className="hidden sm:flex gap-1">
                                            {emp.teses.map(tr => (
                                                <span
                                                    key={tr.tese.id}
                                                    title={tr.tese.nome}
                                                    className="w-2.5 h-2.5 rounded-full"
                                                    style={{
                                                        background: tr.oportunidade
                                                            ? 'var(--success)'
                                                            : 'var(--border-default)',
                                                    }}
                                                />
                                            ))}
                                        </div>

                                        <div className="text-right">
                                            <div
                                                className="text-sm font-bold"
                                                style={{
                                                    color: temOportunidade ? 'var(--success)' : 'var(--text-muted)',
                                                }}
                                            >
                                                {temOportunidade ? formatBRL(emp.totalRecuperavel) : 'Sem oportunidade'}
                                            </div>
                                        </div>

                                        {isExpanded ? (
                                            <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                                        ) : (
                                            <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                                        )}
                                    </div>
                                </button>

                                {/* Expanded detail */}
                                {isExpanded && (
                                    <div
                                        className="px-4 pb-4 space-y-3"
                                        style={{ borderTop: '1px solid var(--border-subtle)' }}
                                    >
                                        {emp.teses.map(tr => {
                                            const parecerKey = `${emp.empresaId}__${tr.tese.id}`;
                                            const parecer = pareceres[parecerKey];
                                            const isParecerLoading = parecerLoading === parecerKey;

                                            return (
                                                <div
                                                    key={tr.tese.id}
                                                    className="rounded-lg p-4 mt-3"
                                                    style={{
                                                        background: tr.oportunidade
                                                            ? 'rgba(16,185,129,0.05)'
                                                            : 'transparent',
                                                        border: `1px solid ${tr.oportunidade ? 'var(--success)' : 'var(--border-subtle)'}`,
                                                    }}
                                                >
                                                    {/* Tese header */}
                                                    <div className="flex items-start justify-between gap-3 mb-2">
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                {tr.oportunidade ? (
                                                                    <CheckCircle
                                                                        className="w-4 h-4 flex-shrink-0"
                                                                        style={{ color: 'var(--success)' }}
                                                                    />
                                                                ) : (
                                                                    <div
                                                                        className="w-4 h-4 rounded-full flex-shrink-0"
                                                                        style={{ background: 'var(--border-default)' }}
                                                                    />
                                                                )}
                                                                <h4 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                                                                    {tr.tese.nome}
                                                                </h4>
                                                            </div>
                                                            <p className="text-xs mt-0.5 ml-6" style={{ color: 'var(--text-muted)' }}>
                                                                {tr.tese.fundamentoLegal}
                                                            </p>
                                                        </div>
                                                        {tr.oportunidade && (
                                                            <span
                                                                className="text-sm font-bold flex-shrink-0"
                                                                style={{ color: 'var(--success)' }}
                                                            >
                                                                {formatBRL(tr.valorEstimado)}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Items table */}
                                                    {tr.oportunidade && tr.itens.length > 0 && (
                                                        <div className="overflow-x-auto mt-3">
                                                            <table className="w-full text-xs">
                                                                <thead>
                                                                    <tr style={{ color: 'var(--text-muted)' }}>
                                                                        <th className="text-left py-1.5 px-2 font-medium">Competencia</th>
                                                                        <th className="text-left py-1.5 px-2 font-medium">Descricao</th>
                                                                        <th className="text-right py-1.5 px-2 font-medium">Valor Original</th>
                                                                        <th className="text-right py-1.5 px-2 font-medium">Recuperavel</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {tr.itens.map((item, i) => (
                                                                        <tr
                                                                            key={i}
                                                                            style={{
                                                                                borderTop: '1px solid var(--border-subtle)',
                                                                                color: 'var(--text-secondary)',
                                                                            }}
                                                                        >
                                                                            <td className="py-1.5 px-2 font-mono">{item.competencia}</td>
                                                                            <td className="py-1.5 px-2">{item.descricao}</td>
                                                                            <td className="py-1.5 px-2 text-right font-mono">
                                                                                {formatBRL(item.valorOriginal)}
                                                                            </td>
                                                                            <td
                                                                                className="py-1.5 px-2 text-right font-mono font-bold"
                                                                                style={{ color: 'var(--success)' }}
                                                                            >
                                                                                {formatBRL(item.valorRecuperavel)}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}

                                                    {/* AI Parecer button & result */}
                                                    {tr.oportunidade && (
                                                        <div className="mt-3 ml-6">
                                                            {!parecer && (
                                                                <button
                                                                    onClick={() => handleGerarParecer(emp, tr)}
                                                                    disabled={isParecerLoading}
                                                                    className="btn-press px-3 py-1.5 text-xs font-bold rounded-lg disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                                                                    style={{
                                                                        background: 'var(--accent-soft)',
                                                                        color: 'var(--accent)',
                                                                    }}
                                                                >
                                                                    {isParecerLoading ? (
                                                                        <>
                                                                            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                                                            Gerando parecer...
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <Sparkles className="w-3 h-3" />
                                                                            Gerar Parecer IA
                                                                        </>
                                                                    )}
                                                                </button>
                                                            )}

                                                            {parecer && (
                                                                <div
                                                                    className="mt-3 rounded-lg p-4"
                                                                    style={{
                                                                        background: 'var(--accent-soft)',
                                                                        border: '1px solid var(--accent)',
                                                                    }}
                                                                >
                                                                    <div className="flex items-center gap-2 mb-2">
                                                                        <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                                                                        <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>
                                                                            Parecer IA
                                                                        </span>
                                                                    </div>
                                                                    <FormattedText text={parecer.parecer} />
                                                                    <div className="text-[10px] mt-2 italic" style={{ color: 'var(--text-muted)' }}>
                                                                        {parecer.modelo} &bull;{' '}
                                                                        {new Date(parecer.geradoEm).toLocaleString('pt-BR')}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* No opportunity */}
                                                    {!tr.oportunidade && (
                                                        <p className="text-xs ml-6 italic" style={{ color: 'var(--text-muted)' }}>
                                                            Sem oportunidade identificada para esta tese.
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Timestamp footer */}
            {data && !loading && (
                <div className="text-center text-[10px] py-2" style={{ color: 'var(--text-muted)' }}>
                    Analise gerada em {new Date(data.geradoEm).toLocaleString('pt-BR')} &bull;{' '}
                    {data.totalEmpresas} empresa{data.totalEmpresas !== 1 ? 's' : ''} analisada{data.totalEmpresas !== 1 ? 's' : ''}
                </div>
            )}
        </div>
    );
};

export default RecuperacaoTributaria;
