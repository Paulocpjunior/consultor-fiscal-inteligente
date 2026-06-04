import React, { useEffect, useMemo, useState } from 'react';
import type { User, DocumentoFiscal } from '../../types';
import { listDocumentos, summarize, getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { formatCurrency, formatCnpjCpf } from '../../services/xmlParserService';

interface Props {
    currentUser: User;
    refreshKey?: number;
}

const Card: React.FC<{ label: string; value: string | number; tone?: string }> = ({ label, value, tone = 'slate' }) => (
    <div className={`bg-${tone}-50 dark:bg-${tone}-900/20 rounded-lg p-3`}>
        <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
        <p className={`text-lg font-bold text-${tone}-700 dark:text-${tone}-300`}>{value}</p>
    </div>
);

const SELECT_CLS = 'bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs';

const XmlDashboard: React.FC<Props> = ({ currentUser, refreshKey }) => {
    const [docs, setDocs] = useState<DocumentoFiscal[]>([]);
    const [loading, setLoading] = useState(true);
    // Cadastro de empresas — usado pra resolver nome a partir do CNPJ quando
    // o doc nao tem empresaNome (Top Empresas mostrava CNPJ cru).
    const [empresasCadastro, setEmpresasCadastro] = useState<EmpresaXmlOption[]>([]);

    // Filtros do dashboard. Aplicados client-side sobre os docs ja carregados,
    // entao todos os cards (summarize) reagem sem refetch.
    const [fDirecao, setFDirecao] = useState('');
    const [fCompetencia, setFCompetencia] = useState('');
    const [fStatus, setFStatus] = useState('');
    const [fEmpresa, setFEmpresa] = useState('');

    useEffect(() => {
        let alive = true;
        setLoading(true);
        listDocumentos(currentUser).then(d => {
            if (alive) { setDocs(d); setLoading(false); }
        });
        getEmpresasDisponiveis(currentUser).then(list => {
            if (alive) setEmpresasCadastro(list);
        }).catch(() => { /* lista opcional — Top Empresas funciona sem ela */ });
        return () => { alive = false; };
    }, [currentUser, refreshKey]);

    // Mapa CNPJ (so digitos) -> nome do cadastro, pra resolver Top Empresas.
    const nomePorCnpj = useMemo(() => {
        const m = new Map<string, string>();
        empresasCadastro.forEach(e => {
            const c = (e.cnpj || '').replace(/\D/g, '');
            if (c && e.nome) m.set(c, e.nome);
        });
        return m;
    }, [empresasCadastro]);

    // Mapa empresaId -> empresaCnpj a partir dos docs. A chave de porEmpresa
    // pode ser um UUID (empresaId), entao precisamos do CNPJ pra cruzar com
    // o cadastro.
    const cnpjPorEmpresaId = useMemo(() => {
        const m = new Map<string, string>();
        docs.forEach(d => {
            const id = d.empresaId || '';
            const cnpj = (d.empresaCnpj || '').replace(/\D/g, '');
            if (id && cnpj && !m.has(id)) m.set(id, cnpj);
        });
        return m;
    }, [docs]);

    // Opcoes dos dropdowns vem do conjunto COMPLETO (nao do filtrado), pra
    // nao sumirem conforme o usuario filtra.
    const competenciasOpts = useMemo(() => {
        const set = new Set<string>();
        docs.forEach(d => set.add(d.competencia || 'sem-competencia'));
        return Array.from(set).sort((a, b) => b.localeCompare(a));
    }, [docs]);
    const statusOpts = useMemo(() => {
        const set = new Set<string>();
        docs.forEach(d => d.status && set.add(d.status));
        return Array.from(set).sort();
    }, [docs]);
    const empresasOpts = useMemo(() => {
        const map = new Map<string, string>();
        docs.forEach(d => { if (d.empresaId) map.set(d.empresaId, d.empresaNome || d.empresaId); });
        return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    }, [docs]);

    const filteredDocs = useMemo(() => docs.filter(d => {
        if (fDirecao && d.direcao !== fDirecao) return false;
        if (fCompetencia && (d.competencia || 'sem-competencia') !== fCompetencia) return false;
        if (fStatus && d.status !== fStatus) return false;
        if (fEmpresa && d.empresaId !== fEmpresa) return false;
        return true;
    }), [docs, fDirecao, fCompetencia, fStatus, fEmpresa]);

    const summary = useMemo(() => summarize(filteredDocs), [filteredDocs]);
    const filtroAtivo = !!(fDirecao || fCompetencia || fStatus || fEmpresa);

    if (loading) return <p className="text-center text-xs text-slate-400 py-6">Carregando dashboard...</p>;
    if (docs.length === 0) {
        return (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 text-center">
                <p className="text-sm text-slate-500">Nenhum XML capturado ainda.</p>
                <p className="text-xs text-slate-400 mt-1">Use a aba "Importação Manual" para começar.</p>
            </div>
        );
    }

    const competencias = Object.entries(summary.porCompetencia).sort(([a], [b]) => b.localeCompare(a)).slice(0, 6);
    // Resolve nome de cada empresa: usa nome do doc; se for CNPJ cru (sem
    // nome), tenta o cadastro pelo CNPJ; senao mantem CNPJ formatado.
    const resolveNome = (id: string, nome: string): string => {
        // Nome ja bom? usa direto.
        const nomeDigits = (nome || '').replace(/\D/g, '');
        const nomeEhCnpjOuVazio = !nome || nome === '(sem identificação)' || nomeDigits.length === 14;
        if (!nomeEhCnpjOuVazio) return nome;
        // Descobre o CNPJ: a chave pode ser o proprio CNPJ, ou um empresaId
        // que mapeamos pro CNPJ via docs.
        const idDigits = (id || '').replace(/\D/g, '');
        const cnpj = idDigits.length === 14 ? idDigits : (cnpjPorEmpresaId.get(id) || '');
        if (cnpj) {
            const doCadastro = nomePorCnpj.get(cnpj);
            if (doCadastro) return doCadastro;
            return formatCnpjCpf(cnpj);
        }
        return nome || '(sem identificação)';
    };
    const empresas = Object.entries(summary.porEmpresa)
        .sort(([, a], [, b]) => b.valorTotal - a.valorTotal)
        .slice(0, 5)
        .map(([id, e]) => [id, { ...e, nome: resolveNome(id, e.nome) }] as [string, typeof e]);
    const cfops = Object.entries(summary.cfops).sort(([, a], [, b]) => b.quantidade - a.quantidade).slice(0, 5);

    return (
        <div className="space-y-4">
            {/* Barra de filtros — todos os cards abaixo refletem o filtro */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <select className={SELECT_CLS} value={fDirecao} onChange={e => setFDirecao(e.target.value)}>
                        <option value="">Direção (todas)</option>
                        <option value="entrada">Entrada</option>
                        <option value="saida">Saída</option>
                    </select>
                    <select className={SELECT_CLS} value={fCompetencia} onChange={e => setFCompetencia(e.target.value)}>
                        <option value="">Competência (todas)</option>
                        {competenciasOpts.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select className={SELECT_CLS} value={fStatus} onChange={e => setFStatus(e.target.value)}>
                        <option value="">Status (todos)</option>
                        {statusOpts.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select className={SELECT_CLS} value={fEmpresa} onChange={e => setFEmpresa(e.target.value)}>
                        <option value="">Empresa (todas)</option>
                        {empresasOpts.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
                    </select>
                </div>
                {filtroAtivo && (
                    <div className="flex items-center gap-3 mt-2">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            Mostrando <strong>{filteredDocs.length}</strong> de {docs.length} documentos.
                        </span>
                        <button
                            type="button"
                            onClick={() => { setFDirecao(''); setFCompetencia(''); setFStatus(''); setFEmpresa(''); }}
                            className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                        >
                            Limpar filtros
                        </button>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card label="Total de XMLs" value={summary.total} />
                <Card label="Entradas" value={summary.entradas} tone="blue" />
                <Card label="Saídas" value={summary.saidas} tone="emerald" />
                <Card label="Valor Total" value={formatCurrency(summary.valorTotal)} tone="slate" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Por Competência</h3>
                    {competencias.length === 0 ? <p className="text-xs text-slate-400">Sem dados.</p> : (
                        <table className="w-full text-xs">
                            <thead><tr className="text-left text-slate-500">
                                <th className="py-1">Competência</th><th>Entradas</th><th>Saídas</th><th className="text-right">Valor Total</th>
                            </tr></thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {competencias.map(([comp, c]) => (
                                    <tr key={comp}>
                                        <td className="py-1 font-mono">{comp}</td>
                                        <td>{c.entradas}</td>
                                        <td>{c.saidas}</td>
                                        <td className="text-right font-bold">{formatCurrency(c.valorEntradas + c.valorSaidas)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Top Empresas</h3>
                    {empresas.length === 0 ? <p className="text-xs text-slate-400">Sem dados.</p> : (
                        <table className="w-full text-xs">
                            <thead><tr className="text-left text-slate-500">
                                <th className="py-1">Empresa</th><th className="text-center">Qtd</th><th className="text-right">Valor</th>
                            </tr></thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {empresas.map(([id, e]) => (
                                    <tr key={id}>
                                        <td className="py-1 truncate max-w-[160px]" title={e.nome}>{e.nome}</td>
                                        <td className="text-center">{e.total}</td>
                                        <td className="text-right font-bold">{formatCurrency(e.valorTotal)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">CFOPs mais utilizados</h3>
                    {cfops.length === 0 ? <p className="text-xs text-slate-400">Sem dados.</p> : (
                        <table className="w-full text-xs">
                            <thead><tr className="text-left text-slate-500">
                                <th className="py-1">CFOP</th><th className="text-center">Qtd</th><th className="text-right">Valor</th>
                            </tr></thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {cfops.map(([cfop, c]) => (
                                    <tr key={cfop}>
                                        <td className="py-1 font-mono">{cfop}</td>
                                        <td className="text-center">{c.quantidade}</td>
                                        <td className="text-right">{formatCurrency(c.valor)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">Status</h3>
                    <div className="grid grid-cols-2 gap-2">
                        {Object.entries(summary.porStatus).map(([s, q]) => (
                            <div key={s} className="bg-slate-50 dark:bg-slate-700/30 rounded p-2 flex justify-between">
                                <span className="text-xs text-slate-600 dark:text-slate-300 capitalize">{s}</span>
                                <span className="text-xs font-bold">{q}</span>
                            </div>
                        ))}
                    </div>
                    {summary.duplicados > 0 && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-3">
                            ⚠️ {summary.duplicados} chave(s) duplicada(s) detectada(s) na base.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default XmlDashboard;
