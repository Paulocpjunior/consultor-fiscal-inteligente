import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { autoGerarTarefasParaCompetencia } from '../services/tarefasAutoGerar';
import { STATUS_LABEL, STATUS_COR, OBRIGACAO_LABEL } from './Tarefas/_common';
import ModalCriarTarefa from './Tarefas/ModalCriarTarefa';
import ModalReatribuir from './Tarefas/ModalReatribuir';
import PrazoIssModal, { type AlvoPrazoIss } from './PrazoIssModal';
import ModalMover from './Tarefas/ModalMover';
import KanbanColuna from './Tarefas/KanbanColuna';
import type { User } from '../types';
import EmpresaSearchSelect from './xml/EmpresaSearchSelect';
import { paraEmpresaOptions } from '../services/empresaOption';

interface TarefasProps {
    currentUser: User | null;
}


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
    // Escolha PENDENTE: trocar de empresa não busca nada. Só o ⚡ Ativar move
    // pro `filtroEmpresa` — que aqui refaz `listarTarefas` E a auto-geração da
    // competência, então cada escolha errada custava caro.
    const [empresaEscolhida, setEmpresaEscolhida] = useState<string>('');
    const [filtroStatus,     setFiltroStatus]     = useState<StatusTarefa | 'todas' | 'atrasadas'>('todas');
    const [filtroObrigacao,  setFiltroObrigacao]  = useState<ObrigacaoTarefa | 'todas'>('todas');
    const [filtroCompetencia,setFiltroCompetencia]= useState<string>(mesAtual);

    // Modal de criar/editar
    const [modalCriarAberto, setModalCriarAberto] = useState(false);

    // Modal de reatribuir
    const [tarefaParaReatribuir, setTarefaParaReatribuir] = useState<Tarefa | null>(null);

    // ── Kanban ─────────────────────────────────────────────────────────────
    // 'lista' = tabela original (default — nao muda nada pra usuarios atuais)
    // 'kanban' = 3 colunas drag-and-drop. Cancelada nao aparece no Kanban
    //           (raras; gerencie pela Lista filtrando status=Cancelada).
    const [vista, setVista] = useState<'lista' | 'kanban'>('kanban');
    // Card sendo arrastado (HTML5 drag) — null quando nao ha drag em curso.
    const [arrastando, setArrastando] = useState<Tarefa | null>(null);
    // Modal "Mover para" — fallback mobile quando drag-and-drop nao funciona.
    const [tarefaParaMover, setTarefaParaMover] = useState<Tarefa | null>(null);
    // ISS de cidade sem calendário: a data é informada NO FLUXO (Paulo, 16/08).
    const [prazoAInformar, setPrazoAInformar] = useState<AlvoPrazoIss | null>(null);

    // Atualizando status (loading state pra evitar double-click)
    const [atualizandoStatus, setAtualizandoStatus] = useState<string | null>(null);

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

    // Memoriza competencias ja auto-geradas nesta sessao pra evitar
    // chamadas repetidas ao Firestore quando o useEffect dispara
    // por outros motivos (mudanca de filtroStatus etc).
    const competenciasGeradas = useRef<Set<string>>(new Set());

    // Carrega tarefas conforme filtros. Antes de listar, auto-gera tarefas
    // da competencia (idempotente — `criarTarefaAutomatica` checa duplicata
    // por empresaId+obrigacao+competencia). Roda uma vez por competencia
    // por sessao pra nao saturar o Firestore.
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

        const carregar = async () => {
            if (filtroCompetencia && currentUser && !competenciasGeradas.current.has(filtroCompetencia)) {
                competenciasGeradas.current.add(filtroCompetencia);
                try {
                    const stats = await autoGerarTarefasParaCompetencia(currentUser, filtroCompetencia);
                    if (stats.criadas > 0) {
                        console.info(
                            `[tarefas] auto-gerou ${stats.criadas} tarefa(s) para ${filtroCompetencia} ` +
                            `(${stats.jaExistiam} ja existiam, ${stats.empresasProcessadas} empresas, ${stats.erros} erros).`,
                        );
                    }
                } catch (e) {
                    console.warn('[tarefas] auto-gerar falhou:', e);
                }
            }
            if (!ativo) return;
            const list = await listarTarefas(filtros);
            if (!ativo) return;
            setTarefas(list);
            setCarregando(false);
        };
        carregar();
        return () => { ativo = false; };
    }, [filtroResp, filtroEmpresa, filtroStatus, filtroObrigacao, filtroCompetencia, versao, currentUser]);

    // Helpers
    const formataData = (d: Date | null | undefined) => {
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

    // Re-utilizada por DROP (drag-and-drop) e pelo modal "Mover" (mobile).
    // Optimistic NAO — espera commit do Firestore antes de recarregar
    // (assim se a regra de permissao bloquear, o usuario ve o erro).
    const moverPara = async (t: Tarefa, novoStatus: StatusTarefa) => {
        if (t.status === novoStatus) return;
        setAtualizandoStatus(t.id);
        const r = await atualizarStatus(t.id, novoStatus);
        setAtualizandoStatus(null);
        if (r.ok) {
            setVersao(v => v + 1);
            setTarefaParaMover(null);
        } else {
            setErro(r.error || 'Erro ao mover tarefa');
        }
    };

    // Agrupa tarefas por status pra renderizar as 3 colunas do Kanban.
    // Cancelada nao entra (gerenciamento pela Lista).
    const colunas = useMemo<Record<'a_fazer' | 'em_andamento' | 'concluida', Tarefa[]>>(() => {
        const c = { a_fazer: [] as Tarefa[], em_andamento: [] as Tarefa[], concluida: [] as Tarefa[] };
        for (const t of tarefas) {
            if (t.status === 'a_fazer' || t.status === 'em_andamento' || t.status === 'concluida') {
                c[t.status].push(t);
            }
        }
        return c;
    }, [tarefas]);

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
                    <div className="flex items-center gap-2">
                        {/* Toggle de vista: Lista vs Kanban */}
                        <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
                            <button
                                onClick={() => setVista('lista')}
                                className={`px-3 py-2 font-medium transition-colors ${
                                    vista === 'lista'
                                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100'
                                        : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                                }`}
                                title="Vista em lista (tabela)"
                            >
                                📋 Lista
                            </button>
                            <button
                                onClick={() => setVista('kanban')}
                                className={`px-3 py-2 font-medium transition-colors border-l border-gray-200 dark:border-gray-700 ${
                                    vista === 'kanban'
                                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100'
                                        : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                                }`}
                                title="Vista em kanban (3 colunas)"
                            >
                                📊 Kanban
                            </button>
                        </div>
                        <button
                            onClick={() => setModalCriarAberto(true)}
                            className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm"
                        >
                            ➕ Nova tarefa
                        </button>
                    </div>
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
                        <EmpresaSearchSelect
                            empresas={paraEmpresaOptions(empresas)}
                            value={empresaEscolhida}
                            onChange={setEmpresaEscolhida}
                            onAtivar={(id) => setFiltroEmpresa(id)}
                            permitirLimpar
                            rotuloVazio="Todas"
                        />
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
            {vista === 'lista' && (
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
                                                {/* ISS de cidade sem calendário nasce SEM data (16/08).
                                                    A data é pedida AQUI, na hora de trabalhar a
                                                    obrigação — e o que a pessoa informa vira o
                                                    calendário da cidade, então ninguém pergunta de
                                                    novo no mês seguinte. */}
                                                {t.vencimento ? formataData(t.vencimento) : (
                                                    <button
                                                        onClick={() => setPrazoAInformar({
                                                            empresaNome: t.empresaNome,
                                                            codMunIBGE: (t as any).codMunIBGE || '',
                                                            municipioNome: (t as any).municipioNome || null,
                                                            uf: (t as any).uf || null,
                                                            competencia: isoDaCompetencia(t.competencia),
                                                        })}
                                                        className="btn-press text-[11px] px-2 py-0.5 rounded-lg border border-amber-400 dark:border-amber-600 text-amber-700 dark:text-amber-400 whitespace-nowrap">
                                                        📅 informar vencimento
                                                    </button>
                                                )}
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
            )}

            {/* Kanban */}
            {vista === 'kanban' && (
                <div>
                    {carregando ? (
                        <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center text-gray-400 shadow-sm border border-gray-100 dark:border-gray-700">Carregando…</div>
                    ) : tarefas.length === 0 ? (
                        <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center text-gray-400 shadow-sm border border-gray-100 dark:border-gray-700">Nenhuma tarefa encontrada com esses filtros.</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {(['a_fazer', 'em_andamento', 'concluida'] as const).map(coluna => (
                                <KanbanColuna
                                    key={coluna}
                                    coluna={coluna}
                                    tarefas={colunas[coluna]}
                                    arrastando={arrastando}
                                    atualizandoStatus={atualizandoStatus}
                                    formataData={formataData}
                                    tarefaAtrasada={tarefaAtrasada}
                                    onDragStart={(t) => setArrastando(t)}
                                    onDragEnd={() => setArrastando(null)}
                                    onDrop={(t) => moverPara(t, coluna)}
                                    onMover={(t) => setTarefaParaMover(t)}
                                    onReatribuir={(t) => setTarefaParaReatribuir(t)}
                                    onPegarPraMim={pegarPraMim}
                                    onExcluir={handleExcluir}
                                    myUid={myUid}
                                    isAdmin={isAdmin}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Modal: mover tarefa entre colunas (fallback mobile p/ drag-and-drop) */}
            {tarefaParaMover && (
                <ModalMover
                    tarefa={tarefaParaMover}
                    onFechar={() => setTarefaParaMover(null)}
                    onMover={(novoStatus) => moverPara(tarefaParaMover, novoStatus)}
                />
            )}

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

            {/* Modal: informar o vencimento do ISS da cidade (16/08).
                Depois de informado, RECARREGA — a tarefa passa a ter data e a
                cidade inteira sai da situação, não só este cliente. */}
            {prazoAInformar && (
                <PrazoIssModal
                    alvo={prazoAInformar}
                    onClose={() => setPrazoAInformar(null)}
                    onInformado={() => { setPrazoAInformar(null); setVersao(v => v + 1); }}
                />
            )}
        </div>
    );
};

/**
 * 'MM/AAAA' (competência da tarefa) → 'AAAA-MM' (o que a vigência usa).
 *
 * ⚠️ Este descasamento mordeu TRÊS vezes em 15/08, uma delas em silêncio. Aqui
 * a conversão é explícita e o formato de origem está dito no nome.
 */
function isoDaCompetencia(comp: string): string {
    const m = String(comp || '').match(/^(\d{2})\/(\d{4})$/);
    if (m) return `${m[2]}-${m[1]}`;
    return String(comp || '').slice(0, 7);
}

// ════════════════════════════════════════════════════════════════════
// Modal: criar tarefa manual
// ════════════════════════════════════════════════════════════════════





export default Tarefas;
