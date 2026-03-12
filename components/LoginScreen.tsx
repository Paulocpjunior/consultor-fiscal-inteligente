import React, { useState } from 'react';
import Logo from './Logo';
import { User } from '../types';
import * as authService from '../services/authService';
import { isFirebaseConfigured } from '../services/firebaseConfig';
import { GlobeIcon, ShieldIcon } from './Icons';

interface LoginScreenProps {
    onLoginSuccess: (user: User) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
    const [isRegistering, setIsRegistering] = useState(false);
    
    // Fields
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleRegisterOrLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        
        try {
            if (isRegistering) {
                if (!name.trim()) throw new Error("Nome é obrigatório.");
                
                const result = await authService.register(name, email, password);
                onLoginSuccess(result.user);
            } else {
                // Login Logic
                const result = await authService.login(email, password);
                onLoginSuccess(result.user);
            }
        } catch (err: any) {
            let msg = err.message || "Ocorreu um erro.";
            
            // UX para Master Admin
            if (email.toLowerCase().includes('junior@spassessoriacontabil.com.br') && msg.includes('Senha incorreta')) {
                msg += " (Dica: Se for o primeiro acesso, a senha padrão é 123456)";
            }

            setError(msg);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-xl overflow-hidden animate-fade-in">
                <div className="bg-gradient-to-r from-sky-700 to-blue-900 p-8 text-center">
                    <div className="flex justify-center mb-4">
                        <Logo className="h-20 w-auto text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">Consultor Fiscal Inteligente</h1>
                    <p className="text-sky-200 text-sm mt-2">Acesso Exclusivo SP Assessoria Contábil</p>
                </div>
                
                <div className="p-8">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-6 text-center">
                        {isRegistering ? 'Criar Nova Conta Online' : 'Acesso ao Sistema'}
                    </h2>
                    
                    <form onSubmit={handleRegisterOrLogin} className="space-y-4">
                        {isRegistering && (
                            <div className="animate-fade-in">
                                <label className="block text-sm font-bold text-slate-900 dark:text-slate-300 dark:font-medium mb-1">Nome do Colaborador</label>
                                <input 
                                    type="text" 
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 focus:outline-none text-slate-900 dark:text-white font-bold dark:font-normal"
                                    placeholder="Seu nome completo"
                                    required={isRegistering}
                                />
                            </div>
                        )}
                        
                        <div>
                            <label className="block text-sm font-bold text-slate-900 dark:text-slate-300 dark:font-medium mb-1">E-mail Corporativo</label>
                            <input 
                                type="email" 
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 focus:outline-none text-slate-900 dark:text-white font-bold dark:font-normal"
                                placeholder="nome@spassessoriacontabil.com.br"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-900 dark:text-slate-300 dark:font-medium mb-1">Senha</label>
                            <input 
                                type="password" 
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-sky-500 focus:outline-none text-slate-900 dark:text-white font-bold dark:font-normal"
                                placeholder="••••••••"
                                required
                            />
                        </div>

                        {error && (
                            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-300 animate-shake font-bold text-center">
                                {error}
                            </div>
                        )}

                        <button 
                            type="submit" 
                            disabled={isLoading}
                            className="w-full py-3 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
                        >
                            {isLoading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    <span>{isRegistering ? 'Cadastrando na Nuvem...' : 'Conectando à Base...'}</span>
                                </>
                            ) : (
                                isRegistering ? 'Cadastrar (Online)' : 'Entrar'
                            )}
                        </button>
                    </form>

                    <div className="mt-6 text-center">
                        <button 
                            onClick={() => { setIsRegistering(!isRegistering); setError(''); }}
                            className="text-sm font-bold text-sky-600 dark:text-sky-400 hover:underline"
                        >
                            {isRegistering ? 'Já tem uma conta? Faça login' : 'Primeiro acesso? Cadastre-se aqui'}
                        </button>
                    </div>
                </div>
                
                <div className="bg-slate-50 dark:bg-slate-900 p-4 border-t border-slate-100 dark:border-slate-700 flex flex-col items-center gap-2">
                    <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${isFirebaseConfigured ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                        {isFirebaseConfigured ? (
                            <>
                                <GlobeIcon className="w-3 h-3" />
                                Sistema Online (Nuvem Ativa)
                            </>
                        ) : (
                            <>
                                <ShieldIcon className="w-3 h-3" />
                                Modo Offline (Banco de Dados Local)
                            </>
                        )}
                    </div>
                    {isFirebaseConfigured && (
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center max-w-xs font-bold dark:font-normal">
                            Acesso seguro ao Banco de Dados da SP Assessoria.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default LoginScreen;