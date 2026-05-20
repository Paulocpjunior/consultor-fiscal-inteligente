import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    listarTarefas,
    criarTarefaManual,
    marcarConcluida,
    atualizarStatus,
    reatribuir,
    removerTarefa,
    type Tarefa,
    type StatusTarefa,
    type ObrigacaoTarefa,
    type FiltrosTarefa,
} from '../services/tarefasService';
import { getEmpresasParaPerfilCliente, type EmpresaPerfilOption } from '../services/xmlFiscalService';
import { listarCarteiras, type VinculoCarteira } from '../services/carteiraService';
import type { User } from '../types';

interface TarefasProps {
    currentUser: User | null;
}

const STATUS_LABEL: Record<StatusTarefa, string> = {
    a_fazer: 'A Fazer',
    em_andamento: 'Em Andamento',
    concluida: 'Concluída',
    cancelada: 'Cancelada',
};

const STATUS_COR: Record<StatusTarefa, string> = {
    a_fazer:      'bg-gray-100  text-gray-800  dark:bg-gray-700/40  dark:text-gray-200',
    em_andamento: 'bg-blue-100  text-blue-800  dark:bg-blue-900/40  dark:text-blue-200',
    concluida:    'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    cancelada:    'bg-red-100   text-red-800   dark:bg-red-900/40   dark:text-red-200',
};

const OBRIGACAO_LABEL: Record<ObrigacaoTarefa, string> = {
    DAS: 'DAS',
    DCTFWEB: 'DCTFWeb',
    FGTS: 'FGTS Digital',
    SPED: 'SPED Fiscal',
    OUTRA: 'Outra',
};

const Tarefas: React.FC<TarefasProps> = ({ currentUser }) => {
    const isAdmin = currentUser?.role === 'admin';
    const myUid = currentUser?.id || null;

    // Estado
    const [tarefas, setTarefas] = useState<Tarefa[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [empresas, setEmpresas] = useState<EmpresaPerfilOption[]>([]);
    const [carteira, setCarteira] = useState<VinculoCarteira[]>([]);
    const [versao, setVersao] = useState(0);
    const [erro, setErro] = useState<string | null>(null);

    // Filtros (padrao: minhas tarefas + a_fazer + mes atual)
    const mesAtual = useMemo(() => {
        const d = new Date();
        return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }, []);

    const [filtroResp,       setFiltroResp]       = useState<string | 'todos' | 'sem_dono'>('todos');
    const [filtroEmpresa,    setFiltroEmpresa]    = useState<string>('');
    const [filtroStatus,     setFiltroStatus]     = useState<StatusTarefa | 'todas' | 'atrasadas'>('todas');
    const [filtroObrigacao,  setFiltroObrigacao]  = useState<ObrigacaoTarefa | 'todas'>('todas');
    const [filtroCompetencia,setFiltroCompetencia]= useState<string>(mesAtual);

    // Modal de criar/editar
    const [modalCriarAberto, setModalCriarAberto] = useState(false);

    // Modal de reatribuir
    const [tarefaParaReatribuir, setTarefaParaReatribuir] = useState<Tarefa | null>(null);

    // Carrega empresas + carteira no mount
    useEffect(() => {
        if (!currentUser) return;
        getEmpresasParaPerfilCliente(currentUser).then(setEmpresas);
        listarCarteiras(currentUser).then(setCarteira);
    }, [currentUser]);

    // Lista de colaboradores (a partir da carteira, distintos)
    const colaboradores = useMemo(() => {
        const map = new Map<string, string>();
        carteira.forEach(v => map.set(v.colaboradorUid, v.colaboradorNome || v.colaboradorUid));
        return Array.from(map.entries()).map(([uid, nome]) => ({ uid, nome }));
    }, [carteira]);

    // Carrega tarefas conforme filtros
    useEffect(() => {
        let ativo = true;
        setCarregando(true);

        const filtros: FiltrosTarefa = {};
        if (filtroEmpresa)        filtros.empresaId = filtroEmpresa;
        if (filtroCompetencia)    filtros.competencia = filtroCompetencia;
        if (filtroObrigacao !== 'todas') filtros.obrigacao = filtroObrigacao;
        if (filtroStatus === 'atrasadas') {
            filtros.apenasAtrasadas = true;
        } else if (filtroStatus !== 'todas') {
            filtros.status = filtroStatus;
        }
        if (filtroResp === 'sem_dono')      filtros.responsavel = null;
        else if (filtroResp !== 'todos')    filtros.responsavel = filtroResp;

        listarTarefas(filtros).then(list => {
            if (ativo) {
                setTarefas(list);
                setCarregando(false);
            }
        });
        return () => { ativo = false; };
    }, [filtroResp, filtroEmpresa, filtroStatus, filtroObrigacao, filtroCompetencia, versao]);

    // Helpers
    const formataData = (d: Date | null) => {
        if (!d || d.getTime() === 0) return '—';
        return d.toLocaleDateString('pt-BR');
    };

    const tarefaAtrasada = (t: Tarefa) => {
        if (t.status === 'concluida' || t.status === 'cancelada') return false;
        return t.vencimento < new Date(new Date().setHours(0,0,0,0));
    };

    // Acoes
    const handleConcluir = async (t: Tarefa) => {
        if (!confirm(`Marcar "${t.titulo}" como concluída?`)) return;
        const r = await marcarConcluida(t.id);
        if (r.ok) setVersao(v => v + 1);
        else setErro(r.error || 'Erro ao concluir');
    };

    const handleStatus = async (t: Tarefa, novo: StatusTarefa) => {
        const r = await atualizarStatus(t.id, novo);
        if (r.ok) setVersao(v => v + 1);
        else setErro(r.error || 'Erro ao atualizar status');
    };

    const handleExcluir = async (t: Tarefa) => {
        if (!isAdmin) { setErro('Apenas admin pode excluir'); return; }
        if (!confirm(`Excluir definitivamente "${t.titulo}"?`)) return;
        const r = await removerTarefa(t.id);
        if (r.ok) setVersao(v => v + 1);
        else setErro(r.error || 'Erro ao excluir');
    };

    const handleReatribuir = async (uid: string | null, nome: string | null) => {
        if (!tarefaParaReatribuir) return;
        const r = await reatribuir(tarefaParaReatribuir.id, uid, nome);
        if (r.ok) {
            setVersao(v => v + 1);
            setTarefaParaReatribuir(null);
        } else {
            setErro(r.error || 'Erro ao reatribuir');
        }
    };

    // Pegar pra mim
    const pegarPraMim = async (t: Tarefa) => {
        if (!myUid) return;
        const r = await reatribuir(t.id, myUid, currentUser?.name || currentUser?.email || '');
        if (r.ok) setVersao(v => v + 1);
        else setErro(r.error || 'Erro');
    };

    // Resumo / contadores
    const contadores = useMemo(() => {
        return {
            total: tarefas.length,
            atrasadas: tarefas.filter(tarefaAtrasada).length,
            semDono:   tarefas.filter(t => !t.responsavel && t.status !== 'concluida').length,
            concluidas: tarefas.filter(t => t.status === 'concluida').length,
        };
    }, [tarefas]);

    return (
        <div className="space-y-4">
            {/* Cabecalho + Resumo */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                        <h2 className="font-semibold text-gray-800 dark:text-gray-100 text-lg">Tarefas</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Gestão de prazos por empresa, obrigação e responsável.
                        </p>
                    </div>
                    <button
                        onClick={() => setModalCriarAberto(true)}
                        className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm"
                    >
                        ➕ Nova tarefa
                    </button>
                </div>

                {/* Resumo */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                    <div className="rounded-xl p-3 bg-gray-50 dark:bg-gray-900/40">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Total</div>
                        <div className="font-bold text-gray-800 dark:text-gray-100">{contadores.total}</div>
                    </div>
                    <div className="rounded-xl p-3 bg-red-50 dark:bg-red-900/30">
                        <div className="text-xs text-red-600 dark:text-red-300">Atrasadas</div>
                        <div className="font-bold text-red-700 dark:text-red-200">{contadores.atrasadas}</div>
                    </div>
                    <div className="rounded-xl p-3 bg-amber-50 dark:bg-amber-900/30">
                        <div className="text-xs text-amber-700 dark:text-amber-300">Sem dono</div>
                        <div className="font-bold text-amber-800 dark:text-amber-200">{contadores.semDono}</div>
                    </div>
                    <div className="rounded-xl p-3 bg-green-50 dark:bg-green-900/30">
                        <div className="text-xs text-green-700 dark:text-green-300">Concluídas</div>
                        <div className="font-bold text-green-800 dark:text-green-200">{contadores.concluidas}</div>
                    </div>
                </div>
            </div>

            {/* Filtros */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div>
                        <label className="text-xs text-gray-600 dark:text-gray-300">Responsável</label>
                        <select value={filtroResp} onChange={e => setFiltroResp(e.target.value as any)}
                            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700">
                            <option value="todos">Todos</option>
                            {myUid && <option value={myUid}>Eu</option>}
                            <option value="sem_dono">Sem dono</option>
                            {colaboradores.map(c => (
                                <option key={c.uid} value={c.uid}>{c.nome}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-gray-600 dark:text-gray-300">Empresa</label>
                        <select value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)}
                            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700">
                            <option value="">Todas</option>
                            {empresas.map(e => (
                                <option key={e.id} value={e.id}>{e.nome}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-gray-600 dark:text-gray-300">Status</label>
                        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value as any)}
                            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700">
                            <option value="todas">Todas</option>
                            <option value="atrasadas">🚨 Atrasadas</option>
                            <option value="a_fazer">A Fazer</option>
                            <option value="em_andamento">Em Andamento</option>
                            <option value="concluida">Concluídas</option>
                            <option value="cancelada">Canceladas</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-gray-600 dark:text-gray-300">Obrigação</label>
                        <select value={filtroObrigacao} onChange={e => setFiltroObrigacao(e.target.value as any)}
                            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700">
                            <option value="todas">Todas</option>
                            <option value="DAS">DAS</option>
                            <option value="DCTFWEB">DCTFWeb</option>
                            <option value="FGTS">FGTS</option>
                            <option value="SPED">SPED</option>
                            <option value="OUTRA">Outra</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-gray-600 dark:text-gray-300">Competência</label>
                        <input value={filtroCompetencia} onChange={e => setFiltroCompetencia(e.target.value)} placeholder="MM/AAAA"
                            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
                    </div>
                </div>
            </div>

            {/* Erro inline */}
            {erro && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-3 text-sm text-red-700 dark:text-red-300">
                    {erro}
                    <button onClick={() => setErro(null)} className="float-right text-xs underline">fechar</button>
                </div>
            )}

            {/* Lista */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                {carregando ? (
                    <div className="p-8 text-center text-gray-400">Carregando…</div>
                ) : tarefas.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">Nenhuma tarefa encontrada com esses filtros.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs uppercase text-gray-500 dark:text-gray-400">
                                <tr>
                                    <th className="px-3 py-2 text-left">Status</th>
                                    <th className="px-3 py-2 text-left">Tarefa</th>
                                    <th className="px-3 py-2 text-left">Empresa</th>
                                    <th className="px-3 py-2 text-left">Vencimento</th>
                                    <th className="px-3 py-2 text-left">Responsável</th>
                                    <th className="px-3 py-2"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {tarefas.map(t => {
                                    const atrasada = tarefaAtrasada(t);
                                    return (
                                        <tr key={t.id} className={`border-t border-gray-100 dark:border-gray-700 ${atrasada ? 'bg-red-50/40 dark:bg-red-900/10' : ''}`}>
                                            <td className="px-3 py-2">
                                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${STATUS_COR[t.status]}`}>
                                                    {STATUS_LABEL[t.status]}
                                                </span>
                                                {atrasada && <span className="ml-1 text-red-600" title="Atrasada">🚨</span>}
                                            </td>
                                            <td className="px-3 py-2">
                                                <div className="font-medium text-gray-800 dark:text-gray-200">{t.titulo}</div>
                                                <div className="text-[11px] text-gray-400">
                                                    {OBRIGACAO_LABEL[t.obrigacao]} · {t.competencia} · {t.origem === 'automatica' ? 'auto' : 'manual'}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2">
                                                <div className="text-gray-800 dark:text-gray-200">{t.empresaNome}</div>
                                                <div className="text-[11px] text-gray-400 font-mono">{t.empresaCnpj}</div>
                                            </td>
                                            <td className={`px-3 py-2 ${atrasada ? 'text-red-600 font-semibold' : 'text-gray-700 dark:text-gray-300'}`}>
                                                {formataData(t.vencimento)}
                                            </td>
                                            <td className="px-3 py-2">
                                                {t.responsavelNome ? (
                                                    <span className="text-gray-700 dark:text-gray-300">{t.responsavelNome}</span>
                                                ) : (
                                                    <button onClick={() => pegarPraMim(t)} className="text-xs text-amber-700 dark:text-amber-400 underline hover:text-amber-900">
                                                        (sem dono — pegar pra mim)
                                                    </button>
                                                )}
                                                {isAdmin && (
                                                    <button onClick={() => setTarefaParaReatribuir(t)} className="ml-2 text-xs text-blue-600 hover:text-blue-800" title="Reatribuir">↻</button>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-right whitespace-nowrap">
                                                {t.status !== 'concluida' && t.status !== 'cancelada' && (
                                                    <>
                                                        {t.status === 'a_fazer' && (
                                                            <button onClick={() => handleStatus(t, 'em_andamento')} className="text-xs text-blue-600 hover:text-blue-800 mr-2" title="Iniciar">▶</button>
                                                        )}
                                                        <button onClick={() => handleConcluir(t)} className="text-xs text-green-600 hover:text-green-800 mr-2" title="Concluir">✓</button>
                                                    </>
                                                )}
                                                {isAdmin && (
                                                    <button onClick={() => handleExcluir(t)} className="text-xs text-red-600 hover:text-red-800" title="Excluir">🗑️</button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal: criar tarefa manual */}
            {modalCriarAberto && currentUser && (
                <ModalCriarTarefa
                    empresas={empresas}
                    onFechar={() => setModalCriarAberto(false)}
                    onCriou={() => { setModalCriarAberto(false); setVersao(v => v + 1); }}
                />
            )}

            {/* Modal: reatribuir */}
            {tarefaParaReatribuir && (
                <ModalReatribuir
                    tarefa={tarefaParaReatribuir}
                    colaboradores={colaboradores}
                    onFechar={() => setTarefaParaReatribuir(null)}
                    onAtribuir={handleReatribuir}
                />
            )}
        </div>
    );
};

// ════════════════════════════════════════════════════════════════════
// Modal: criar tarefa manual
// ════════════════════════════════════════════════════════════════════
interface ModalCriarTarefaProps {
    empresas: EmpresaPerfilOption[];
    onFechar: () => void;
    onCriou: () => void;
}

const ModalCriarTarefa: React.FC<ModalCriarTarefaProps> = ({ empresas, onFechar, onCriou }) => {
    const [titulo, setTitulo] = useState('');
    const [descricao, setDescricao] = useState('');
    const [empresaId, setEmpresaId] = useState('');
    const [vencimento, setVencimento] = useState(''); // yyyy-mm-dd
    const [obrigacao, setObrigacao] = useState<ObrigacaoTarefa>('OUTRA');
    const [salvando, setSalvando] = useState(false);
    const [erro, setErroLocal] = useState<string | null>(null);

    const podeSalvar = titulo.trim() && empresaId && vencimento;

    const salvar = async () => {
        setErroLocal(null);
        if (!podeSalvar) {
            setErroLocal('Título, empresa e vencimento são obrigatórios.');
            return;
        }
        const emp = empresas.find(e => e.id === empresaId);
        if (!emp) { setErroLocal('Empresa inválida'); return; }
        const dataVenc = new Date(vencimento + 'T00:00:00');

        setSalvando(true);
        const r = await criarTarefaManual({
            titulo: titulo.trim(),
            descricao: descricao.trim(),
            empresaId: emp.id,
            empresaCnpj: emp.cnpj || '',
            empresaNome: emp.nome || '',
            obrigacao,
            vencimento: dataVenc,
        });
        setSalvando(false);
        if (r.ok) onCriou();
        else setErroLocal(r.error || 'Erro ao criar');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">Nova tarefa manual</h3>
                    <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                </div>
                <div className="px-5 py-4 space-y-3">
                    <div>
                        <label className="text-xs text-gray-600 dark:text-gray-300">Título *</label>
                        <input value={titulo} onChange={e => setTitulo(e.target.value)}
                            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
                    </div>
                    <div>
                        <label className="text-xs text-gray-600 dark:text-gray-300">Empresa *</label>
                        <select value={empresaId} onChange={e => setEmpresaId(e.target.value)}
                            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700">
                            <option value="">Selecione…</option>
                            {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-xs text-gray-600 dark:text-gray-300">Vencimento *</label>
                            <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)}
                                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
                        </div>
                        <div>
                            <label className="text-xs text-gray-600 dark:text-gray-300">Tipo</label>
                            <select value={obrigacao} onChange={e => setObrigacao(e.target.value as ObrigacaoTarefa)}
                                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700">
                                <option value="OUTRA">Outra</option>
                                <option value="DAS">DAS</option>
                                <option value="DCTFWEB">DCTFWeb</option>
                                <option value="FGTS">FGTS</option>
                                <option value="SPED">SPED</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-gray-600 dark:text-gray-300">Descrição</label>
                        <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2}
                            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
                    </div>
                    {erro && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded p-2 text-xs text-red-700 dark:text-red-300">
                            {erro}
                        </div>
                    )}
                </div>
                <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
                    <button onClick={onFechar} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600">Cancelar</button>
                    <button onClick={salvar} disabled={!podeSalvar || salvando}
                        className="px-3 py-1.5 text-sm rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50">
                        {salvando ? 'Salvando…' : 'Criar tarefa'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ════════════════════════════════════════════════════════════════════
// Modal: reatribuir
// ════════════════════════════════════════════════════════════════════
interface ModalReatribuirProps {
    tarefa: Tarefa;
    colaboradores: { uid: string; nome: string }[];
    onFechar: () => void;
    onAtribuir: (uid: string | null, nome: string | null) => void;
}

const ModalReatribuir: React.FC<ModalReatribuirProps> = ({ tarefa, colaboradores, onFechar, onAtribuir }) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">Reatribuir tarefa</h3>
                    <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                </div>
                <div className="px-5 py-4 space-y-2">
                    <p className="text-xs text-gray-500">{tarefa.titulo} · {tarefa.empresaNome}</p>
                    <button onClick={() => onAtribuir(null, null)}
                        className="w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-50 dark:hover:bg-gray-700">
                        ⬜ Remover responsável (sem dono)
                    </button>
                    {colaboradores.length === 0 && (
                        <p className="text-xs text-gray-400 italic px-3">Nenhum colaborador na carteira.</p>
                    )}
                    {colaboradores.map(c => (
                        <button key={c.uid} onClick={() => onAtribuir(c.uid, c.nome)}
                            className="w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-50 dark:hover:bg-gray-700">
                            👤 {c.nome}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Tarefas;
