import React, { useEffect, useState, useRef } from 'react';
import { User, AccessLog } from '../types';
import * as authService from '../services/authService';
import { MODULOS_RESTRITOS, PERMISSOES_FUNCIONAIS } from '../config/menuConfig';
import { CloseIcon, UserGroupIcon, TrashIcon, UserIcon } from './Icons';
import { useConfirm, usePrompt } from './dialog/DialogProvider';

interface UserManagementModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentUserEmail?: string;
    currentUserRole?: 'admin' | 'colaborador';
}

type Tab = 'users' | 'logs';

/**
 * Os DEPARTAMENTOS do SaaS (08/08): dizem qual MÓDULO do app a pessoa abre.
 * Espelho do catálogo do backend (cadastro-central-departamentos.js) — quem
 * valida de verdade é lá; isto aqui é só o desenho das caixas de seleção.
 * Outra coisa que os módulos restritos abaixo: aquilo libera CARDS dentro do
 * CFI; departamento libera o APP irmão inteiro, consultado pelo túnel.
 */
const DEPARTAMENTOS_SAAS = [
    { id: 'fiscal', label: '🧾 Fiscal' },
    { id: 'contabil', label: '📊 Contábil' },
    { id: 'dp-folha', label: '👥 DP/Folha' },
    { id: 'legalizacao', label: '📋 Legalização' },
    { id: 'financeiro', label: '💰 Financeiro' },
];

/**
 * Editor da EXCEÇÃO de horário de acesso (Paulo, 10/08). Padrão da casa =
 * seg–sex 07:00–20:00; o admin abre exceção por colaborador (dias/faixa
 * próprios, ou 24h). Espelha a régua do backend (horario-acesso.js): null =
 * padrão, {vale24h:true} = 24h, {dias,inicio,fim} = janela própria. Quem
 * valida de verdade é o backend (validarHorarioAcesso) — aqui é só a caixa.
 */
const DIAS_SEMANA = [
    { n: 1, l: 'Seg' }, { n: 2, l: 'Ter' }, { n: 3, l: 'Qua' }, { n: 4, l: 'Qui' },
    { n: 5, l: 'Sex' }, { n: 6, l: 'Sáb' }, { n: 0, l: 'Dom' },
];
const HORARIO_PADRAO_LABEL = 'Padrão da casa — seg a sex, 07:00 às 20:00';

type ModoHorario = 'padrao' | '24h' | 'custom';

function rotularHorario(h: User['horarioAcesso']): string {
    if (!h) return HORARIO_PADRAO_LABEL;
    if (h.vale24h) return 'Liberado 24h (todos os dias)';
    const dias = (h.dias ?? []).slice().sort((a, b) => a - b);
    const nomes = dias.map(d => DIAS_SEMANA.find(x => x.n === d)?.l ?? d).join(', ');
    return `${nomes || '—'}, das ${h.inicio ?? '??'} às ${h.fim ?? '??'}`;
}

const HorarioEditor: React.FC<{
    user: User;
    disabled: boolean;
    onSave: (user: User, horario: User['horarioAcesso']) => void | Promise<void>;
}> = ({ user, disabled, onSave }) => {
    const inicial = user.horarioAcesso ?? null;
    const modoInicial: ModoHorario = !inicial ? 'padrao' : inicial.vale24h ? '24h' : 'custom';
    const [modo, setModo] = useState<ModoHorario>(modoInicial);
    const [dias, setDias] = useState<number[]>(inicial?.dias ?? [1, 2, 3, 4, 5]);
    const [inicio, setInicio] = useState<string>(inicial?.inicio ?? '07:00');
    const [fim, setFim] = useState<string>(inicial?.fim ?? '20:00');
    const [salvando, setSalvando] = useState(false);

    // Reinicia o rascunho quando troca de usuário no painel.
    useEffect(() => {
        const i = user.horarioAcesso ?? null;
        setModo(!i ? 'padrao' : i.vale24h ? '24h' : 'custom');
        setDias(i?.dias ?? [1, 2, 3, 4, 5]);
        setInicio(i?.inicio ?? '07:00');
        setFim(i?.fim ?? '20:00');
    }, [user.id]);

    const toggleDia = (n: number) => {
        setDias(prev => prev.includes(n) ? prev.filter(d => d !== n) : [...prev, n].sort((a, b) => a - b));
    };

    const erroCustom = modo === 'custom' && (dias.length === 0
        ? 'Marque ao menos um dia.'
        : (fim <= inicio ? 'O fim deve ser depois do início.' : null));

    const salvar = async () => {
        if (disabled || salvando) return;
        let payload: User['horarioAcesso'];
        if (modo === 'padrao') payload = null;
        else if (modo === '24h') payload = { vale24h: true };
        else {
            if (erroCustom) return;
            payload = { dias: dias.slice().sort((a, b) => a - b), inicio, fim };
        }
        setSalvando(true);
        try { await onSave(user, payload); } finally { setSalvando(false); }
    };

    return (
        <div>
            <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-1.5">
                ⏰ Horário de acesso
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                Atual: <span className="font-semibold">{rotularHorario(user.horarioAcesso)}</span>
                {user.role === 'admin' && <span className="text-amber-600 dark:text-amber-400"> · admin sempre passa (a régua não o barra)</span>}
            </p>
            <div className="flex flex-wrap gap-1.5 mb-2">
                {([['padrao', 'Padrão'], ['24h', '24h'], ['custom', 'Personalizado']] as [ModoHorario, string][]).map(([m, l]) => (
                    <button
                        key={m}
                        disabled={disabled}
                        onClick={() => setModo(m)}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                            modo === m
                                ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:bg-slate-200'
                        } ${disabled ? 'cursor-default opacity-70' : ''}`}
                    >
                        {modo === m ? '✓ ' : ''}{l}
                    </button>
                ))}
            </div>
            {modo === 'custom' && (
                <div className="space-y-2 mb-2 p-2 rounded bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
                    <div className="flex flex-wrap gap-1">
                        {DIAS_SEMANA.map(d => (
                            <button
                                key={d.n}
                                disabled={disabled}
                                onClick={() => toggleDia(d.n)}
                                className={`text-[11px] font-semibold w-9 py-1 rounded border transition-colors ${
                                    dias.includes(d.n)
                                        ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700'
                                        : 'bg-white dark:bg-slate-700 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-600'
                                } ${disabled ? 'cursor-default opacity-70' : ''}`}
                            >
                                {d.l}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <span>das</span>
                        <input type="time" value={inicio} disabled={disabled} onChange={e => setInicio(e.target.value)}
                            className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800" />
                        <span>às</span>
                        <input type="time" value={fim} disabled={disabled} onChange={e => setFim(e.target.value)}
                            className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800" />
                    </div>
                    {erroCustom && <p className="text-[11px] text-red-500">{erroCustom}</p>}
                </div>
            )}
            {!disabled && (
                <button
                    onClick={salvar}
                    disabled={salvando || !!erroCustom}
                    className="text-xs font-semibold px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                    {salvando ? 'Salvando…' : 'Salvar horário'}
                </button>
            )}
        </div>
    );
};

const UserManagementModal: React.FC<UserManagementModalProps> = ({
    isOpen,
    onClose,
    currentUserEmail,
    currentUserRole,
}) => {
    const [tab, setTab] = useState<Tab>('users');
    // Layout de 09/08 (pedido do Paulo: "o layout não ajuda em nada"): com 39
    // usuários e ~20 chips por linha numa célula de ~250px, cada usuário
    // virava um bloco gigante com chips cortados na borda. Agora a linha é
    // COMPACTA (nome, e-mail, role, resumo) e os chips só aparecem no painel
    // expandido do usuário clicado, em largura total.
    const [busca, setBusca] = useState('');
    const [expandido, setExpandido] = useState<string | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [logs, setLogs] = useState<AccessLog[]>([]);
    const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const confirm = useConfirm();
    const prompt = usePrompt();
    // Guard que evita setState apos unmount/fechar modal mid-flight do fetch.
    // Antes, abrir/fechar rapido o modal podia atualizar state em componente
    // ja desmontado (React 18 warning + memory leak).
    const aliveRef = useRef(true);

    const isAdmin = currentUserRole === 'admin';

    useEffect(() => {
        aliveRef.current = true;
        return () => { aliveRef.current = false; };
    }, []);

    const loadUsers = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const fetchedUsers = await authService.getAllUsers();
            if (!aliveRef.current) return;
            setUsers(Array.isArray(fetchedUsers) ? fetchedUsers : []);
        } catch (err: any) {
            if (!aliveRef.current) return;
            const m = err?.message || 'Erro ao carregar usuários.';
            if (m.includes('PERMISSION_DENIED')) {
                setError('Apenas administradores podem listar todos os usuários. Solicite a um admin que te promova.');
            } else {
                setError(m);
            }
            setUsers([]);
        } finally {
            if (aliveRef.current) setIsLoading(false);
        }
    };

    const loadLogs = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const fetchedLogs = await authService.getRecentLogs(100);
            if (!aliveRef.current) return;
            setLogs(Array.isArray(fetchedLogs) ? fetchedLogs : []);
        } catch (err: any) {
            if (!aliveRef.current) return;
            const m = err?.message || 'Erro ao carregar logs.';
            if (m.includes('PERMISSION_DENIED')) {
                setError('Apenas administradores podem ler logs de acesso.');
            } else {
                setError(m);
            }
            setLogs([]);
        } finally {
            if (aliveRef.current) setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        setMsg(null);
        if (tab === 'users') loadUsers();
        else loadLogs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, tab]);

    const handleResetPassword = async (userId: string, userName: string) => {
        const ok = await confirm({
            title: 'Resetar senha',
            message: `Resetar senha de "${userName}" para a senha padrão?`,
            variant: 'warning',
            confirmLabel: 'Resetar',
        });
        if (!ok) return;
        try {
            const success = await authService.resetUserPassword(userId);
            setMsg(success
                ? { text: `Senha de ${userName} resetada.`, type: 'success' }
                : { text: 'Erro ao resetar senha.', type: 'error' });
        } catch (e: any) {
            setMsg({ text: e?.message || 'Erro ao resetar senha.', type: 'error' });
        }
    };

    const handleDeleteUser = async (userId: string, userName: string) => {
        const ok = await confirm({
            title: `Excluir usuário "${userName}"?`,
            message: 'Esta ação não pode ser desfeita.',
            variant: 'danger',
            confirmLabel: 'Excluir',
        });
        if (!ok) return;
        try {
            const success = await authService.deleteUser(userId);
            if (success) {
                setMsg({ text: `Usuário ${userName} excluído.`, type: 'success' });
                loadUsers();
            } else {
                setMsg({ text: 'Erro ao excluir usuário.', type: 'error' });
            }
        } catch (e: any) {
            setMsg({ text: e?.message || 'Erro ao excluir usuário.', type: 'error' });
        }
    };

    const handleToggleRole = async (user: User) => {
        const novoRole = user.role === 'admin' ? 'colaborador' : 'admin';
        const acao = novoRole === 'admin' ? 'promover a admin' : 'rebaixar para colaborador';
        const ok = await confirm({
            title: `${acao.charAt(0).toUpperCase() + acao.slice(1)}?`,
            message: `Tem certeza que deseja ${acao} "${user.name}"?`,
            variant: novoRole === 'admin' ? 'warning' : 'info',
        });
        if (!ok) return;
        try {
            const result = await authService.setUserRole(user.id, novoRole);
            if (result) {
                setMsg({
                    text: `${user.name} agora é ${novoRole === 'admin' ? 'administrador' : 'colaborador'}.`,
                    type: 'success',
                });
                loadUsers();
            } else {
                setMsg({ text: 'Erro ao alterar role.', type: 'error' });
            }
        } catch (e: any) {
            setMsg({ text: e?.message || 'Erro ao alterar role.', type: 'error' });
        }
    };

    /**
     * Libera/revoga o acesso de um colaborador a um módulo restrito
     * (adminOnly, ex.: Consulta Situação Fiscal) ou a uma permissão
     * funcional (ex.: Emissão de Tributos, exigida pelo backend nas rotas
     * /emitir* de DAS/DARF). Grava a lista em
     * users/{uid}.modulosPermitidos — só admin consegue (Firestore rules).
     */
    const handleToggleModulo = async (user: User, moduloType: string, moduloLabel: string) => {
        const atuais = user.modulosPermitidos ?? [];
        const temAcesso = atuais.includes(moduloType);
        const ok = await confirm({
            title: temAcesso ? 'Revogar acesso?' : 'Liberar acesso?',
            message: `${temAcesso ? 'Revogar' : 'Liberar'} o acesso de "${user.name}" ao módulo "${moduloLabel}"?`,
            variant: temAcesso ? 'warning' : 'info',
            confirmLabel: temAcesso ? 'Revogar' : 'Liberar',
        });
        if (!ok) return;
        const novos = temAcesso ? atuais.filter(m => m !== moduloType) : [...atuais, moduloType];
        try {
            const result = await authService.setUserModulos(user.id, novos);
            if (result) {
                const admin = authService.getCurrentUser();
                if (admin) {
                    authService.logAction(
                        admin.id, admin.name,
                        temAcesso ? 'revogou acesso a módulo' : 'liberou acesso a módulo',
                        `${moduloLabel} — ${user.name} (${user.email})`,
                    );
                }
                setMsg({
                    text: `Acesso ao módulo "${moduloLabel}" ${temAcesso ? 'revogado de' : 'liberado para'} ${user.name}. O usuário verá o módulo no próximo login/refresh.`,
                    type: 'success',
                });
                loadUsers();
            } else {
                setMsg({ text: 'Erro ao atualizar acesso ao módulo.', type: 'error' });
            }
        } catch (e: any) {
            setMsg({ text: e?.message || 'Erro ao atualizar acesso ao módulo.', type: 'error' });
        }
    };

    /**
     * Vincula/desvincula o usuário de um DEPARTAMENTO do SaaS. É o que decide
     * qual módulo irmão (Contábil, DP, Legalização, Financeiro) ele consegue
     * abrir — os apps consultam o vínculo pelo túnel no login deles.
     */
    const handleToggleDepartamento = async (user: User, depId: string, depLabel: string) => {
        const atuais = user.departamentos ?? [];
        const vinculado = atuais.includes(depId);
        const ok = await confirm({
            title: vinculado ? 'Desvincular do departamento?' : 'Vincular ao departamento?',
            message: `${vinculado ? 'Desvincular' : 'Vincular'} "${user.name}" ${vinculado ? 'do' : 'ao'} departamento ${depLabel}? `
                + (vinculado
                    ? 'Ele perde o acesso ao módulo correspondente no próximo login.'
                    : 'Ele passa a abrir o módulo correspondente no próximo login.'),
            variant: vinculado ? 'warning' : 'info',
            confirmLabel: vinculado ? 'Desvincular' : 'Vincular',
        });
        if (!ok) return;
        const novos = vinculado ? atuais.filter(d => d !== depId) : [...atuais, depId];
        try {
            const result = await authService.setUserDepartamentos(user.id, novos);
            if (result) {
                const admin = authService.getCurrentUser();
                if (admin) {
                    authService.logAction(
                        admin.id, admin.name,
                        vinculado ? 'desvinculou de departamento' : 'vinculou a departamento',
                        `${depLabel} — ${user.name} (${user.email})`,
                    );
                }
                setMsg({
                    text: `${user.name} ${vinculado ? 'desvinculado do' : 'vinculado ao'} departamento ${depLabel}.`,
                    type: 'success',
                });
                loadUsers();
            } else {
                setMsg({ text: 'Erro ao atualizar departamento.', type: 'error' });
            }
        } catch (e: any) {
            setMsg({ text: e?.message || 'Erro ao atualizar departamento.', type: 'error' });
        }
    };

    /**
     * Grava a EXCEÇÃO de horário do colaborador (ou volta ao padrão com null).
     * A validação forte é do backend (validarHorarioAcesso); aqui já barramos
     * o óbvio no editor pra não gastar ida ao servidor.
     */
    const handleSetHorario = async (user: User, horario: User['horarioAcesso']) => {
        try {
            const ok = await authService.setUserHorario(user.id, horario ?? null);
            if (ok) {
                const admin = authService.getCurrentUser();
                if (admin) {
                    authService.logAction(
                        admin.id, admin.name, 'alterou horário de acesso',
                        `${user.name} (${user.email}) → ${horario ? (horario.vale24h ? '24h' : `${(horario.dias ?? []).join('/')} ${horario.inicio}-${horario.fim}`) : 'padrão'}`,
                    );
                }
                setMsg({ text: `Horário de ${user.name} atualizado.`, type: 'success' });
                loadUsers();
            } else {
                setMsg({ text: 'Erro ao atualizar horário.', type: 'error' });
            }
        } catch (e: any) {
            setMsg({ text: e?.message || 'Erro ao atualizar horário.', type: 'error' });
        }
    };

    const handleEditName = async (user: User) => {
        const novoNome = await prompt({
            title: 'Editar nome',
            message: `E-mail: ${user.email}`,
            defaultValue: user.name,
            placeholder: 'Nome completo',
            confirmLabel: 'Salvar',
        });
        if (novoNome === null) return;
        const trimmed = novoNome.trim();
        if (!trimmed || trimmed === user.name) return;
        try {
            const ok = await authService.setUserName(user.id, trimmed);
            if (ok) {
                setMsg({ text: `Nome alterado para "${trimmed}".`, type: 'success' });
                loadUsers();
            } else {
                setMsg({ text: 'Erro ao alterar nome.', type: 'error' });
            }
        } catch (e: any) {
            setMsg({ text: e?.message || 'Erro ao alterar nome.', type: 'error' });
        }
    };

    if (!isOpen) return null;

    const TabButton: React.FC<{ id: Tab; label: string; count?: number }> = ({ id, label, count }) => (
        <button
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === id
                    ? 'border-sky-600 text-sky-600 dark:text-sky-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
        >
            {label}{count !== undefined && ` (${count})`}
        </button>
    );

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[70] animate-fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="bg-slate-100 dark:bg-slate-900 p-4 rounded-t-xl flex justify-between items-center border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-slate-800 dark:text-slate-100 font-bold text-lg flex items-center gap-2">
                        <UserGroupIcon className="w-5 h-5 text-sky-600" />
                        Gerenciar Usuários
                    </h3>
                    <button onClick={onClose} className="p-1 rounded-full text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                        <CloseIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-200 dark:border-slate-700 px-4 bg-white dark:bg-slate-800">
                    <TabButton id="users" label="Usuários" count={users.length || undefined} />
                    <TabButton id="logs" label="Logs de acesso" count={logs.length || undefined} />
                </div>

                {/* Body */}
                <div className="p-4 flex-grow overflow-y-auto bg-white dark:bg-slate-800">
                    {msg && (
                        <div className={`mb-4 p-3 rounded-lg text-sm font-bold ${
                            msg.type === 'success' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                                                   : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                        }`}>
                            {msg.text}
                        </div>
                    )}

                    {error && (
                        <div className="mb-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500 text-amber-800 dark:text-amber-300 text-sm">
                            <p className="font-bold mb-1">⚠ Permissão necessária</p>
                            <p>{error}</p>
                        </div>
                    )}

                    {isLoading ? (
                        <div className="text-center py-12 text-slate-500">Carregando...</div>
                    ) : tab === 'users' ? (() => {
                        const termo = busca.trim().toLowerCase();
                        const filtrados = users.filter(u => !termo
                            || (u.name || '').toLowerCase().includes(termo)
                            || (u.email || '').toLowerCase().includes(termo));
                        return (
                        <div>
                            <div className="mb-3 flex items-center gap-3">
                                <input
                                    value={busca}
                                    onChange={e => setBusca(e.target.value)}
                                    placeholder="🔎 Buscar por nome ou e-mail…"
                                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                                />
                                {termo && (
                                    <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                        {filtrados.length} de {users.length}
                                    </span>
                                )}
                            </div>
                            <div className="space-y-1">
                                {filtrados.map((user) => {
                                    const deps = user.departamentos ?? [];
                                    const mods = user.modulosPermitidos ?? [];
                                    const aberto = expandido === user.id;
                                    return (
                                        <div key={user.id} className={`rounded-lg border ${aberto ? 'border-sky-300 dark:border-sky-700' : 'border-slate-200 dark:border-slate-700'}`}>
                                            {/* Linha compacta: clique abre o editor de acessos */}
                                            <div
                                                className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg"
                                                onClick={() => setExpandido(aberto ? null : user.id)}
                                            >
                                                <div className={`p-1 rounded-full shrink-0 ${user.role === 'admin' ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                                                    <UserIcon className="w-3 h-3" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <span className="font-medium text-slate-900 dark:text-white text-sm">
                                                        {user.name}
                                                        {user.email === currentUserEmail && <span className="text-xs text-sky-600 ml-1">(Você)</span>}
                                                    </span>
                                                    <span className="block sm:inline sm:ml-2 text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</span>
                                                </div>
                                                <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                                                    user.role === 'admin'
                                                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                                                }`}>
                                                    {user.role === 'admin' ? 'Admin' : 'Colaborador'}
                                                </span>
                                                {/* Resumo honesto sem abrir: quantos vínculos, e o ⚠ de quem não tem nenhum */}
                                                {user.role !== 'admin' && deps.length === 0 ? (
                                                    <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400 font-semibold" title="Sem departamento — não abre nenhum módulo irmão do app.">⚠ sem depto.</span>
                                                ) : (
                                                    <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400 hidden sm:inline">
                                                        {user.role === 'admin' ? 'todos os módulos' : `${deps.length} depto. · ${mods.length} card(s)`}
                                                    </span>
                                                )}
                                                <span className="shrink-0 text-xs font-bold text-sky-600 dark:text-sky-400">{aberto ? 'Fechar ▴' : 'Acessos ▾'}</span>
                                            </div>

                                            {/* Painel expandido: chips em LARGURA TOTAL, por seção nomeada */}
                                            {aberto && (
                                                <div className="px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-700 space-y-3">
                                                    <div>
                                                        <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-1.5">
                                                            Departamentos — módulos irmãos do SaaS
                                                        </p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {DEPARTAMENTOS_SAAS.map(dep => {
                                                                const vinculado = deps.includes(dep.id);
                                                                return (
                                                                    <button
                                                                        key={dep.id}
                                                                        disabled={!isAdmin}
                                                                        onClick={() => handleToggleDepartamento(user, dep.id, dep.label)}
                                                                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                                                                            vinculado
                                                                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700 hover:bg-blue-200'
                                                                                : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-600 hover:bg-slate-200'
                                                                        } ${!isAdmin ? 'cursor-default opacity-70' : ''}`}
                                                                        title={isAdmin
                                                                            ? (vinculado ? `Desvincular do departamento ${dep.label}` : `Vincular ao departamento ${dep.label}`)
                                                                            : `Apenas administradores vinculam. ${vinculado ? 'Vinculado.' : 'Não vinculado.'}`}
                                                                    >
                                                                        {vinculado ? '✓ ' : ''}{dep.label}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                        {user.role !== 'admin' && deps.length === 0 && (
                                                            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                                                                ⚠ Sem departamento — não abre nenhum módulo irmão do app.
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 mb-1.5">
                                                            Cards internos do CFI
                                                        </p>
                                                        {user.role === 'admin' ? (
                                                            <span className="text-xs text-slate-400 italic">Todos (admin)</span>
                                                        ) : (
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {[...MODULOS_RESTRITOS, ...PERMISSOES_FUNCIONAIS].map(mod => {
                                                                    const modLabel = mod.label ?? mod.type;
                                                                    const liberado = mods.includes(mod.type);
                                                                    return (
                                                                        <button
                                                                            key={mod.type}
                                                                            disabled={!isAdmin}
                                                                            onClick={() => handleToggleModulo(user, mod.type, modLabel)}
                                                                            className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                                                                                liberado
                                                                                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700 hover:bg-green-200'
                                                                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:bg-slate-200'
                                                                            } ${!isAdmin ? 'cursor-default opacity-70' : ''}`}
                                                                            title={isAdmin
                                                                                ? (liberado ? `Clique para revogar o acesso a ${modLabel}` : `Clique para liberar o acesso a ${modLabel}`)
                                                                                : `Apenas administradores podem alterar. ${liberado ? 'Acesso liberado.' : 'Sem acesso.'}`}
                                                                        >
                                                                            {liberado ? '✓ ' : ''}{modLabel}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <HorarioEditor user={user} disabled={!isAdmin} onSave={handleSetHorario} />
                                                    {user.email !== currentUserEmail && (
                                                        <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100 dark:border-slate-700/50">
                                                            {isAdmin && (
                                                                <button
                                                                    onClick={() => handleEditName(user)}
                                                                    className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-xs font-semibold"
                                                                    title="Editar nome de exibição"
                                                                >
                                                                    Editar nome
                                                                </button>
                                                            )}
                                                            {isAdmin && (
                                                                <button
                                                                    onClick={() => handleToggleRole(user)}
                                                                    className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 text-xs font-semibold"
                                                                    title={user.role === 'admin' ? 'Rebaixar para colaborador' : 'Promover a administrador'}
                                                                >
                                                                    {user.role === 'admin' ? 'Rebaixar' : 'Promover'}
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => handleResetPassword(user.id, user.name)}
                                                                className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded hover:bg-yellow-200 dark:hover:bg-yellow-900/50 text-xs font-semibold"
                                                                title="Resetar senha para 123456"
                                                            >
                                                                Resetar Senha
                                                            </button>
                                                            {isAdmin && (
                                                                <button
                                                                    onClick={() => handleDeleteUser(user.id, user.name)}
                                                                    className="p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                                                                    title="Excluir usuário"
                                                                >
                                                                    <TrashIcon className="w-4 h-4" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {filtrados.length === 0 && !error && (
                                    <p className="px-4 py-8 text-center text-slate-400 text-sm">
                                        {users.length === 0 ? 'Nenhum usuário encontrado.' : `Nenhum usuário casa com "${busca}".`}
                                    </p>
                                )}
                            </div>
                        </div>
                        );
                    })() : (
                        // Logs tab
                        <div className="space-y-2">
                            {logs.length === 0 && !error && (
                                <p className="text-center text-slate-400 py-8">Nenhum log encontrado.</p>
                            )}
                            {logs.map((log) => (
                                <div key={log.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 border-b dark:border-slate-700/50">
                                    <div className="flex-shrink-0 w-2 h-2 rounded-full bg-sky-500 mt-2"></div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-slate-700 dark:text-slate-300">
                                            <span className="font-bold">{log.userName}</span>
                                            <span className="text-slate-400 mx-2">·</span>
                                            <span>{log.action}</span>
                                        </p>
                                        {log.details && (
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate" title={log.details}>
                                                {log.details}
                                            </p>
                                        )}
                                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                                            {new Date(log.timestamp).toLocaleString('pt-BR')}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-b-xl text-right">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 font-semibold transition-colors"
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UserManagementModal;
