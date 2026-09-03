import React, { useState } from 'react';
import Logo from './Logo';
import { User } from '../types';
import * as authService from '../services/authService';
import { isFirebaseConfigured } from '../services/firebaseConfig';
import { GlobeIcon, ShieldIcon } from './Icons';
import { APP_RELEASE, APP_BUILD_TIME, formatBuildDate, rotuloVersao } from '../version';
import { validarEmailParaRedefinicao, type ResultadoRedefinicao } from '../services/redefinirSenha';
import { EMAIL_ADMIN_MASTER } from '../services/adminMaster';

interface LoginScreenProps {
    onLoginSuccess: (user: User) => void;
    /**
     * Login por /connect é do SP Connect, não do CFI — mesma identidade da
     * CASA que o resto do app já respeita (Paulo recusou associar a
     * ferramenta ao nome do CFI). Login compartilhado (Firebase), tela não.
     */
    spConnect?: boolean;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, spConnect = false }) => {
    const [isRegistering, setIsRegistering] = useState(false);
    
    // Fields
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // 🔑 ESQUECI MINHA SENHA (25/08, Paulo: "colaborador não consegue resetar a
    // SENHA"). O caminho simplesmente não existia nesta tela — havia "Entrar" e
    // "Primeiro acesso", e mais nada; quem esquecia dependia de pedir a alguém,
    // e o botão do admin em Gerenciar Usuários NÃO FAZIA NADA em produção
    // (dizia "resetada" e voltava). Quem redefine é o dono da caixa de e-mail,
    // pelo link do Firebase — nem o app nem o admin escolhem senha de ninguém.
    const [enviandoLink, setEnviandoLink] = useState(false);
    const [avisoSenha, setAvisoSenha] = useState<ResultadoRedefinicao | null>(null);

    const pedirLinkDeSenha = async () => {
        if (enviandoLink) return;
        setError('');
        setAvisoSenha(null);
        // A régua recusa ANTES da rede o que o Firebase também recusaria —
        // e-mail vazio, formato torto e e-mail pessoal (o engano comum).
        const invalido = validarEmailParaRedefinicao(email);
        if (invalido) { setAvisoSenha(invalido); return; }
        setEnviandoLink(true);
        try {
            setAvisoSenha(await authService.enviarLinkDeRedefinicao(email));
        } finally {
            setEnviandoLink(false);
        }
    };

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
            if (email.toLowerCase().includes(EMAIL_ADMIN_MASTER) && msg.includes('Senha incorreta')) {
                msg += " (Dica: Se for o primeiro acesso, a senha padrão é 123456)";
            }

            setError(msg);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{background:"var(--bg-page)"}}>
            <div className="w-full max-w-md rounded-2xl overflow-hidden animate-fade-in" style={{background:"var(--bg-card)",border:"1px solid var(--border-default)"}}>
                <div className="p-8 text-center" style={{background:"var(--accent-hover)"}}>
                    <div className="flex justify-center mb-4">
                        <Logo variant="light" className="h-20 w-auto" />
                    </div>
                    <h1 className="text-2xl font-bold text-[var(--text-primary)]" style={{fontFamily:"Cormorant Garamond,serif"}}>{spConnect ? 'SP Connect' : 'Consultor Fiscal Inteligente'}</h1>
                    <p className="text-sm mt-2" style={{color:"var(--text-muted)"}}>{spConnect ? 'Atendimento WhatsApp · SP Assessoria Contábil' : 'Acesso Exclusivo SP Assessoria Contábil'}</p>

                    <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
                        <span
                            className="inline-flex items-center gap-1 bg-white/15 text-[var(--text-primary)] text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/20"
                            title={`Build: ${formatBuildDate(APP_BUILD_TIME)}`}
                        >
                            Versão {rotuloVersao()}
                        </span>
                        <span
                            className="inline-flex items-center gap-1 text-[10px] font-mono px-2.5 py-1 rounded-full border"
                            style={{background:"var(--accent-soft-border)",borderColor:"var(--accent-soft-border)",color:"var(--text-primary)"}}
                            title={`Release técnico — gerado em ${formatBuildDate(APP_BUILD_TIME)}`}
                        >
                            Release {APP_RELEASE}
                        </span>
                    </div>
                </div>
                
                <div className="p-8" style={{background:"var(--bg-elevated)"}}>
                    <h2 className="text-xl font-bold mb-6 text-center" style={{color:"var(--text-primary)",fontFamily:"Cormorant Garamond,serif"}}>
                        {isRegistering ? 'Criar Nova Conta Online' : 'Acesso ao Sistema'}
                    </h2>
                    
                    <form onSubmit={handleRegisterOrLogin} className="space-y-4">
                        {isRegistering && (
                            <div className="animate-fade-in">
                                <label className="block text-sm font-medium mb-1" style={{color:"var(--text-muted)"}}>Nome do Colaborador</label>
                                <input 
                                    type="text" 
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full p-3 rounded-lg focus:outline-none font-normal" style={{background:"var(--bg-card)",border:"1px solid var(--border-default)",color:"var(--text-primary)"}}
                                    placeholder="Seu nome completo"
                                    required={isRegistering}
                                />
                            </div>
                        )}
                        
                        <div>
                            <label className="block text-sm font-medium mb-1" style={{color:"var(--text-muted)"}}>E-mail Corporativo</label>
                            <input 
                                type="email"
                                autoComplete="username"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full p-3 rounded-lg focus:outline-none font-normal" style={{background:"var(--bg-card)",border:"1px solid var(--border-default)",color:"var(--text-primary)"}}
                                placeholder="nome@spassessoriacontabil.com.br"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1" style={{color:"var(--text-muted)"}}>Senha</label>
                            <input 
                                type="password"
                                autoComplete={isRegistering ? 'new-password' : 'current-password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full p-3 rounded-lg focus:outline-none font-normal" style={{background:"var(--bg-card)",border:"1px solid var(--border-default)",color:"var(--text-primary)"}}
                                placeholder="••••••••"
                                required
                            />
                        </div>

                        {error && (
                            <div className="p-3 rounded-lg text-sm font-medium text-center" style={{background:"var(--danger-soft)",border:"1px solid var(--danger)",color:"var(--danger)"}}>
                                {error}
                            </div>
                        )}

                        {/* 🔑 O link fica ao lado do campo de SENHA, que é onde a
                            pessoa está quando descobre que esqueceu — e some no
                            cadastro, onde ele não faz sentido nenhum. */}
                        {!isRegistering && (
                            <div className="text-right -mt-2">
                                <button
                                    type="button"
                                    onClick={pedirLinkDeSenha}
                                    disabled={enviandoLink}
                                    className="text-xs font-medium hover:underline disabled:opacity-50"
                                    style={{color:"var(--accent)"}}
                                >
                                    {enviandoLink ? 'Enviando o link…' : 'Esqueci minha senha'}
                                </button>
                            </div>
                        )}

                        {avisoSenha && (
                            <div
                                className="p-3 rounded-lg text-sm text-left space-y-1"
                                style={avisoSenha.ok
                                    // ⚠️ `--success-soft` NÃO existe no index.css (só `--success` e
                                    // `--warning-soft`): token inventado vira fundo transparente e a
                                    // caixa some no tema escuro. O fundo é rgba translúcido, que
                                    // funciona nos dois temas; a cor e a borda vêm do token real.
                                    ? {background:"rgba(5,150,105,0.10)",border:"1px solid var(--success)",color:"var(--success)"}
                                    : {background:"var(--warning-soft)",border:"1px solid var(--warning)",color:"var(--warning)"}}
                            >
                                <p className="font-semibold">{avisoSenha.texto}</p>
                                {/* Recusa sem caminho é beco: toda situação diz o
                                    que fazer agora, inclusive a de rede caída —
                                    que NÃO afirma que o link deixou de sair. */}
                                {avisoSenha.acao && <p className="text-xs font-normal">{avisoSenha.acao}</p>}
                            </div>
                        )}

                        <button 
                            type="submit" 
                            disabled={isLoading}
                            className="w-full py-3 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex justify-center items-center gap-2" style={{background:"var(--accent)"}}
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
                            className="text-sm font-medium hover:underline" style={{color:"var(--accent)"}}
                        >
                            {isRegistering ? 'Já tem uma conta? Faça login' : 'Primeiro acesso? Cadastre-se aqui'}
                        </button>
                    </div>
                </div>
                
                <div className="p-4 flex flex-col items-center gap-2" style={{background:"var(--accent-soft)",borderTop:"1px solid var(--border-subtle)"}}>
                    <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${isFirebaseConfigured ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
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
                        <p className="text-[10px] text-center max-w-xs" style={{color:"var(--text-muted)"}}>
                            Acesso seguro ao Banco de Dados da SP Assessoria.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default LoginScreen;