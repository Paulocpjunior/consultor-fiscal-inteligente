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
        <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{background:"#020026"}}>
            <div className="w-full max-w-md rounded-2xl overflow-hidden animate-fade-in" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(200,208,255,0.12)"}}>
                <div className="p-8 text-center" style={{background:"#08007A"}}>
                    <div className="flex justify-center mb-4">
                        <Logo className="h-20 w-auto text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-[#F5F6FF]" style={{fontFamily:"Cormorant Garamond,serif"}}>Consultor Fiscal Inteligente</h1>
                    <p className="text-sm mt-2" style={{color:"rgba(200,208,255,0.5)"}}>Acesso Exclusivo SP Assessoria Contábil</p>
                </div>
                
                <div className="p-8" style={{background:"rgba(8,0,122,0.06)"}}>
                    <h2 className="text-xl font-bold mb-6 text-center" style={{color:"#F5F6FF",fontFamily:"Cormorant Garamond,serif"}}>
                        {isRegistering ? 'Criar Nova Conta Online' : 'Acesso ao Sistema'}
                    </h2>
                    
                    <form onSubmit={handleRegisterOrLogin} className="space-y-4">
                        {isRegistering && (
                            <div className="animate-fade-in">
                                <label className="block text-sm font-medium mb-1" style={{color:"rgba(200,208,255,0.5)"}}>Nome do Colaborador</label>
                                <input 
                                    type="text" 
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full p-3 rounded-lg focus:outline-none font-normal" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(200,208,255,0.1)",color:"#F5F6FF"}}
                                    placeholder="Seu nome completo"
                                    required={isRegistering}
                                />
                            </div>
                        )}
                        
                        <div>
                            <label className="block text-sm font-medium mb-1" style={{color:"rgba(200,208,255,0.5)"}}>E-mail Corporativo</label>
                            <input 
                                type="email" 
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full p-3 rounded-lg focus:outline-none font-normal" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(200,208,255,0.1)",color:"#F5F6FF"}}
                                placeholder="nome@spassessoriacontabil.com.br"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1" style={{color:"rgba(200,208,255,0.5)"}}>Senha</label>
                            <input 
                                type="password" 
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full p-3 rounded-lg focus:outline-none font-normal" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(200,208,255,0.1)",color:"#F5F6FF"}}
                                placeholder="••••••••"
                                required
                            />
                        </div>

                        {error && (
                            <div className="p-3 rounded-lg text-sm font-medium text-center" style={{background:"rgba(255,68,102,0.08)",border:"1px solid rgba(255,68,102,0.2)",color:"#FF4466"}}>
                                {error}
                            </div>
                        )}

                        <button 
                            type="submit" 
                            disabled={isLoading}
                            className="w-full py-3 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex justify-center items-center gap-2" style={{background:"#1400FF"}}
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
                            className="text-sm font-medium hover:underline" style={{color:"#5B7FFF"}}
                        >
                            {isRegistering ? 'Já tem uma conta? Faça login' : 'Primeiro acesso? Cadastre-se aqui'}
                        </button>
                    </div>
                </div>
                
                <div className="p-4 flex flex-col items-center gap-2" style={{background:"rgba(8,0,122,0.15)",borderTop:"1px solid rgba(200,208,255,0.08)"}}>
                    <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${isFirebaseConfigured ? 'text-[#00C896]' : 'text-[#F5A623]'}`}>
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
                        <p className="text-[10px] text-center max-w-xs" style={{color:"rgba(200,208,255,0.3)"}}>
                            Acesso seguro ao Banco de Dados da SP Assessoria.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default LoginScreen;