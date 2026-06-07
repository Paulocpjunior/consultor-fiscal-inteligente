import React, { useEffect, useState } from 'react';
import { User, AccessLog } from '../types';
import * as authService from '../services/authService';
import { CloseIcon, UserGroupIcon, TrashIcon, UserIcon } from './Icons';
import { useConfirm, usePrompt } from './dialog/DialogProvider';

interface UserManagementModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentUserEmail?: string;
    currentUserRole?: 'admin' | 'colaborador';
}

type Tab = 'users' | 'logs';

const UserManagementModal: React.FC<UserManagementModalProps> = ({
    isOpen,
    onClose,
    currentUserEmail,
    currentUserRole,
}) => {
    const [tab, setTab] = useState<Tab>('users');
    const [users, setUsers] = useState<User[]>([]);
    const [logs, setLogs] = useState<AccessLog[]>([]);
    const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const confirm = useConfirm();
    const prompt = usePrompt();

    const isAdmin = currentUserRole === 'admin';

    const loadUsers = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const fetchedUsers = await authService.getAllUsers();
            setUsers(Array.isArray(fetchedUsers) ? fetchedUsers : []);
        } catch (err: any) {
            const m = err?.message || 'Erro ao carregar usuários.';
            if (m.includes('PERMISSION_DENIED')) {
                setError('Apenas administradores podem listar todos os usuários. Solicite a um admin que te promova.');
            } else {
                setError(m);
            }
            setUsers([]);
        } finally {
            setIsLoading(false);
        }
    };

    const loadLogs = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const fetchedLogs = await authService.getRecentLogs(100);
            setLogs(Array.isArray(fetchedLogs) ? fetchedLogs : []);
        } catch (err: any) {
            const m = err?.message || 'Erro ao carregar logs.';
            if (m.includes('PERMISSION_DENIED')) {
                setError('Apenas administradores podem ler logs de acesso.');
            } else {
                setError(m);
            }
            setLogs([]);
        } finally {
            setIsLoading(false);
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
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
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
                    ) : tab === 'users' ? (
                        <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
                            <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300 sticky top-0">
                                <tr>
                                    <th className="px-4 py-2">Nome</th>
                                    <th className="px-4 py-2">E-mail</th>
                                    <th className="px-4 py-2">Role</th>
                                    <th className="px-4 py-2 text-center">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((user) => (
                                    <tr key={user.id} className="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                        <td className="px-4 py-2 font-medium text-slate-900 dark:text-white flex items-center gap-2">
                                            <div className={`p-1 rounded-full ${user.role === 'admin' ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                                                <UserIcon className="w-3 h-3" />
                                            </div>
                                            {user.name}
                                            {user.email === currentUserEmail && <span className="text-xs text-sky-600">(Você)</span>}
                                        </td>
                                        <td className="px-4 py-2">{user.email}</td>
                                        <td className="px-4 py-2">
                                            <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                                                user.role === 'admin'
                                                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                                            }`}>
                                                {user.role === 'admin' ? 'Administrador' : 'Colaborador'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2 text-center">
                                            {user.email !== currentUserEmail && (
                                                <div className="flex justify-center gap-2">
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
                                        </td>
                                    </tr>
                                ))}
                                {users.length === 0 && !error && (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-8 text-center text-slate-400">Nenhum usuário encontrado.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    ) : (
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
