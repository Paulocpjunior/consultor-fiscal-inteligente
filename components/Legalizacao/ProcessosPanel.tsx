/**
 * ProcessosPanel (Legalização) — CRUD dos processos do departamento:
 * aberturas, alterações contratuais, encerramentos, contratos, venda de
 * certificado digital, certidões, cadastros, permissões especiais,
 * procurações e regularizações.
 *
 * Processo com data de vencimento preenchida entra automaticamente na
 * análise de vencimentos e nos alertas ao cliente (ex.: procuração).
 * Exclusão só admin (rules).
 */
import React, { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import type { User } from '../../types';
import {
    listarProcessos, criarProcesso, atualizarProcesso, removerProcesso,
    type ProcessoLegalizacao, type NovoProcesso,
} from '../../services/legalizacaoService';
import {
    TIPO_PROCESSO_LABEL, STATUS_PROCESSO_LABEL, fmtCnpj, fmtDataBr,
    type StatusProcesso, type TipoProcesso,
} from '../../services/legalizacaoLogic';
import { useConfirm } from '../dialog/DialogProvider';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

const FORM_VAZIO: NovoProcesso = { tipo: 'abertura', titulo: '', empresaNome: '' };

const ProcessosPanel: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const confirm = useConfirm();
    const [processos, setProcessos] = useState<ProcessoLegalizacao[] | null>(null);
    const [filtroStatus, setFiltroStatus] = useState<'ativos' | 'todos' | StatusProcesso>('ativos');
    const [busca, setBusca] = useState('');
    const [mostrarForm, setMostrarForm] = useState(false);
    const [form, setForm] = useState<NovoProcesso>(FORM_VAZIO);
    const [salvando, setSalvando] = useState(false);

    const recarregar = async () => {
        try {
            setProcessos(await listarProcessos());
        } catch (e) {
            onShowToast?.(`Erro ao carregar processos: ${e instanceof Error ? e.message : e}`);
            setProcessos([]);
        }
    };
    useEffect(() => { void recarregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const filtrados = useMemo(() => {
        if (!processos) return [];
        const q = busca.trim().toLowerCase();
        return processos
            .filter(p => filtroStatus === 'todos'
                || (filtroStatus === 'ativos' ? !['concluido', 'cancelado'].includes(p.status) : p.status === filtroStatus))
            .filter(p => !q
                || p.empresaNome?.toLowerCase().includes(q)
                || p.titulo?.toLowerCase().includes(q)
                || String(p.cnpj || '').includes(q.replace(/\D/g, '') || '§'))
            .sort((a, b) => (b.atualizadoEm?.getTime() ?? 0) - (a.atualizadoEm?.getTime() ?? 0));
    }, [processos, filtroStatus, busca]);

    const salvar = async () => {
        if (!form.titulo.trim() || !form.empresaNome.trim()) {
            onShowToast?.('Preencha ao menos o título e a empresa.');
            return;
        }
        setSalvando(true);
        try {
            await criarProcesso({ ...form, responsavelNome: form.responsavelNome || currentUser.name });
            onShowToast?.('Processo criado.');
            setForm(FORM_VAZIO);
            setMostrarForm(false);
            await recarregar();
        } catch (e) {
            onShowToast?.(`Erro ao criar processo: ${e instanceof Error ? e.message : e}`);
        } finally {
            setSalvando(false);
        }
    };

    const mudarStatus = async (p: ProcessoLegalizacao, status: StatusProcesso) => {
        try {
            await atualizarProcesso(p.id, { status });
            setProcessos(prev => prev?.map(x => x.id === p.id ? { ...x, status } : x) ?? null);
        } catch (e) {
            onShowToast?.(`Erro ao atualizar status: ${e instanceof Error ? e.message : e}`);
        }
    };

    const excluir = async (p: ProcessoLegalizacao) => {
        const ok = await confirm({
            title: 'Excluir processo?',
            message: `"${p.titulo}" de ${p.empresaNome} será excluído definitivamente.`,
        });
        if (!ok) return;
        try {
            await removerProcesso(p.id);
            setProcessos(prev => prev?.filter(x => x.id !== p.id) ?? null);
            onShowToast?.('Processo excluído.');
        } catch (e) {
            onShowToast?.(`Erro ao excluir: ${e instanceof Error ? e.message : e}`);
        }
    };

    if (!processos) return <LoadingSpinner />;

    const inputCls = 'px-3 py-1.5 text-xs rounded-md w-full';
    const inputStyle: React.CSSProperties = { background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center rounded-lg p-3" style={{ background: 'var(--bg-card)' }}>
                <button
                    onClick={() => setMostrarForm(v => !v)}
                    className="px-3 py-1.5 text-xs font-bold rounded-md btn-press"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                >
                    {mostrarForm ? '✖ Fechar' : '➕ Novo processo'}
                </button>
                <input
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    placeholder="Buscar empresa, título ou CNPJ…"
                    className="px-3 py-1.5 text-xs rounded-md flex-1 min-w-[180px]"
                    style={inputStyle}
                />
                <select
                    value={filtroStatus}
                    onChange={e => setFiltroStatus(e.target.value as typeof filtroStatus)}
                    className="px-2 py-1.5 text-xs rounded-md"
                    style={inputStyle}
                >
                    <option value="ativos">Ativos (não concluídos)</option>
                    <option value="todos">Todos</option>
                    {(Object.keys(STATUS_PROCESSO_LABEL) as StatusProcesso[]).map(s => (
                        <option key={s} value={s}>{STATUS_PROCESSO_LABEL[s]}</option>
                    ))}
                </select>
                <span className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>{filtrados.length} de {processos.length}</span>
            </div>

            {mostrarForm && (
                <div className="rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                    <label className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>Tipo
                        <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoProcesso }))} className={inputCls} style={inputStyle}>
                            {(Object.keys(TIPO_PROCESSO_LABEL) as TipoProcesso[]).map(t => (
                                <option key={t} value={t}>{TIPO_PROCESSO_LABEL[t]}</option>
                            ))}
                        </select>
                    </label>
                    <label className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>Título *
                        <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Ex.: Alteração de endereço na JUCESP" className={inputCls} style={inputStyle} />
                    </label>
                    <label className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>Empresa *
                        <input value={form.empresaNome} onChange={e => setForm(f => ({ ...f, empresaNome: e.target.value }))} className={inputCls} style={inputStyle} />
                    </label>
                    <label className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>CNPJ
                        <input value={form.cnpj ?? ''} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} className={inputCls} style={inputStyle} />
                    </label>
                    <label className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>E-mail do cliente (para alertas)
                        <input value={form.emailCliente ?? ''} onChange={e => setForm(f => ({ ...f, emailCliente: e.target.value }))} className={inputCls} style={inputStyle} />
                    </label>
                    <label className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>Vencimento (entra nos alertas — ex.: procuração)
                        <input type="date" value={form.dataVencimento ?? ''} onChange={e => setForm(f => ({ ...f, dataVencimento: e.target.value }))} className={inputCls} style={inputStyle} />
                    </label>
                    <label className="text-[11px] font-bold sm:col-span-2" style={{ color: 'var(--text-muted)' }}>Descrição
                        <input value={form.descricao ?? ''} onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} className={inputCls} style={inputStyle} />
                    </label>
                    <div className="flex items-end">
                        <button onClick={() => void salvar()} disabled={salvando} className="px-4 py-1.5 text-xs font-bold rounded-md btn-press" style={{ background: 'var(--success)', color: '#fff' }}>
                            {salvando ? 'Salvando…' : '💾 Salvar processo'}
                        </button>
                    </div>
                </div>
            )}

            <div className="rounded-lg overflow-x-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <table className="w-full text-xs" style={{ color: 'var(--text-primary)' }}>
                    <thead>
                        <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                            <th className="p-2">Tipo</th>
                            <th className="p-2">Título</th>
                            <th className="p-2">Empresa</th>
                            <th className="p-2">Vencimento</th>
                            <th className="p-2">Responsável</th>
                            <th className="p-2">Status</th>
                            {currentUser.role === 'admin' && <th className="p-2"></th>}
                        </tr>
                    </thead>
                    <tbody>
                        {filtrados.length === 0 && (
                            <tr><td colSpan={7} className="p-4 text-center" style={{ color: 'var(--text-muted)' }}>
                                Nenhum processo — clique em “Novo processo” para registrar o primeiro.
                            </td></tr>
                        )}
                        {filtrados.map(p => (
                            <tr key={p.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                <td className="p-2">{TIPO_PROCESSO_LABEL[p.tipo] ?? p.tipo}</td>
                                <td className="p-2 font-semibold">{p.titulo}{p.descricao ? <div className="font-normal" style={{ color: 'var(--text-muted)' }}>{p.descricao}</div> : null}</td>
                                <td className="p-2">{p.empresaNome}<div style={{ color: 'var(--text-muted)' }}>{fmtCnpj(p.cnpj)}</div></td>
                                <td className="p-2">{p.dataVencimento ? fmtDataBr(p.dataVencimento) : '—'}</td>
                                <td className="p-2">{p.responsavelNome || '—'}</td>
                                <td className="p-2">
                                    <select
                                        value={p.status}
                                        onChange={e => void mudarStatus(p, e.target.value as StatusProcesso)}
                                        className="px-2 py-1 text-xs rounded-md"
                                        style={inputStyle}
                                    >
                                        {(Object.keys(STATUS_PROCESSO_LABEL) as StatusProcesso[]).map(s => (
                                            <option key={s} value={s}>{STATUS_PROCESSO_LABEL[s]}</option>
                                        ))}
                                    </select>
                                </td>
                                {currentUser.role === 'admin' && (
                                    <td className="p-2">
                                        <button onClick={() => void excluir(p)} className="text-xs font-bold" style={{ color: 'var(--danger)' }}>🗑️</button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ProcessosPanel;
