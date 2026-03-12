
import React, { useEffect, useState } from 'react';
import { User } from '../types';
import * as authService from '../services/authService';
import { CloseIcon, UserGroupIcon, TrashIcon, UserIcon } from './Icons';

interface UserManagementModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentUserEmail?: string;
}

const UserManagementModal: React.FC<UserManagementModalProps> = ({ isOpen, onClose, currentUserEmail }) => {
    const [users, setUsers] = useState<User[]>([]);
    const [msg, setMsg] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const loadUsers = async () => {
        setIsLoading(true);
        try {
            const fetchedUsers = await authService.getAllUsers();
            setUsers(Array.isArray(fetchedUsers) ? fetchedUsers : []);
        } catch (error) {
            console.error("Failed to load users", error);
            setUsers([]);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            loadUsers();
            setMsg(null);
        }
    }, [isOpen]);

    const handleResetPassword = async (userId: string, userName: string) => {
        if (window.confirm(`Tem certeza que deseja resetar a senha de "${userName}" para "123456"?`)) {
            try {
                const success = await authService.resetUserPassword(userId);
                if (success) {
                    setMsg({ text: `Senha de ${userName} resetada para 123456.`, type: 'success' });
                } else {
                    setMsg({ text: 'Erro ao resetar senha.', type: 'error' });
                }
            } catch (e) {
                setMsg({ text: 'Erro ao resetar senha.', type: 'error' });
            }
        }
    };

    const handleDeleteUser = async (userId: string, userName: string) => {
        if (window.confirm(`ATENÇÃO: Tem certeza que deseja EXCLUIR o usuário "${userName}"? Esta ação não pode ser desfeita.`)) {
            try {
                const success = await authService.deleteUser(userId);
                if (success) {
                    setMsg({ text: `Usuário ${userName} excluído.`, type: 'success' });
                    loadUsers();
                } else {
                    setMsg({ text: 'Erro ao excluir usuário.', type: 'error' });
                }
            } catch (e) {
                setMsg({ text: 'Erro ao excluir usuário.', type: 'error' });
            }
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[70] animate-fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="bg-slate-100 dark:bg-slate-900 p-4 rounded-t-xl flex justify-between items-center border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-slate-800 dark:text-slate-100 font-bold text-lg flex items-center gap-2">
                        <UserGroupIcon className="w-5 h-5 text-sky-600" />
                        Gerenciar Usuários
                    </h3>
                    <button onClick={onClose} className="p-1 rounded-full text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                        <CloseIcon className="w-5 h-5" />
                    </button>
                </div>
                
                <div className="p-4 flex-grow overflow-y-auto">
                    {msg && (
                        <div className={`mb-4 p-3 rounded-lg text-sm font-bold ${msg.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {msg.text}
                        </div>
                    )}

                    {isLoading ? (
                        <div className="text-center py-4 text-slate-500">Carregando usuários...</div>
                    ) : (
                        <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
                            <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300 sticky top-0">
                                <tr>
                                    <th className="px-4 py-2">Nome</th>
                                    <th className="px-4 py-2">E-mail</th>
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
                                        <td className="px-4 py-2 text-center flex justify-center gap-2">
                                            {user.email !== currentUserEmail && (
                                                <>
                                                    <button 
                                                        onClick={() => handleResetPassword(user.id, user.name)}
                                                        className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 text-xs font-semibold"
                                                        title="Resetar senha para 123456"
                                                    >
                                                        Resetar Senha
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDeleteUser(user.id, user.name)}
                                                        className="p-1 text-red-500 hover:bg-red-100 rounded"
                                                        title="Excluir usuário"
                                                    >
                                                        <TrashIcon className="w-4 h-4" />
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {users.length === 0 && (
                                    <tr>
                                        <td colSpan={3} className="px-4 py-8 text-center text-slate-400">Nenhum usuário encontrado.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>
                
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
