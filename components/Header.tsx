
import React from 'react';
import ThemeSwitcher from './ThemeSwitcher';
import Logo from './Logo';
import Tooltip from './Tooltip';
import { MenuIcon, UserIcon, ShieldIcon, UserGroupIcon } from './Icons';
import { User } from '../types';
import {
    NOVIDADES_URL, NOVIDADES_VERSAO, marcarNovidadesComoLidas,
    temNovidadeNaoLida, versaoVistaLocal,
} from '../services/novidadesService';

interface HeaderProps {
    theme: 'light' | 'dark';
    toggleTheme: () => void;
    onMenuClick: () => void;
    description?: string;
    user?: User | null;
    onLogout?: () => void;
    onShowLogs?: () => void;
    onShowUsers?: () => void;
}

const Header: React.FC<HeaderProps> = ({ theme, toggleTheme, onMenuClick, description, user, onLogout, onShowLogs, onShowUsers }) => {
  // 📣 Novidades vivia SÓ dentro do card Relatórios — quem não abria aquele
  // card nunca achava o comunicado. Agora fica no cabeçalho, em toda tela.
  const [novoAviso, setNovoAviso] = React.useState(false);
  React.useEffect(() => {
      setNovoAviso(temNovidadeNaoLida(NOVIDADES_VERSAO, versaoVistaLocal()));
  }, []);

  const abrirNovidades = () => {
      marcarNovidadesComoLidas();
      setNovoAviso(false);
  };

  return (
    <header className="w-full py-6 md:py-8" style={{borderBottom:"1px solid var(--border-subtle)"}}>
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        {/* Left side: Logo & Title */}
        <div className="flex items-center gap-4 w-full md:w-auto justify-start">
          <Tooltip content="Consultor Fiscal Inteligente" position="bottom">
            <Logo />
          </Tooltip>
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl leading-tight" style={{color:"var(--text-primary)",fontFamily:"Cormorant Garamond,serif",fontWeight:"300"}}>
              Consultor Fiscal
            </h1>
            <p className="text-xs sm:text-sm font-medium tracking-wider uppercase" style={{color:"var(--accent)"}}>
              Inteligente
            </p>
          </div>
        </div>

        {/* Right side: User Info & Actions */}
        <div className="flex items-center gap-3 self-end md:self-center">
          {user && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full mr-2" style={{background:"var(--accent-soft-border)",border:"1px solid var(--border-default)"}}>
                  <div className="p-1 rounded-full" style={{background:user.role==='admin'?'var(--warning-soft)':'var(--accent-soft)',color:user.role==='admin'?'var(--warning)':'var(--accent)'}}>
                      <UserIcon className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col">
                      <span className="text-xs font-medium leading-none" style={{color:"var(--text-primary)"}}>{user.name.split(' ')[0]}</span>
                      <span className="text-[10px] leading-none capitalize" style={{color:"var(--text-muted)"}}>{user.role}</span>
                  </div>
              </div>
          )}

          <a
              href={NOVIDADES_URL}
              target="_blank"
              rel="noopener"
              onClick={abrirNovidades}
              className="btn-press relative flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg transition-colors"
              style={{
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  border: '1px solid var(--border-default)',
              }}
              title="Novidades no CFI — o que mudou e o que fazer"
              aria-label="Novidades no CFI"
          >
              <span aria-hidden="true">📣</span>
              <span className="hidden sm:inline">Novidades</span>
              {novoAviso && (
                  <span
                      className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full"
                      style={{ background: 'var(--danger)' }}
                      title="Tem comunicado novo que você ainda não abriu"
                  />
              )}
          </a>

          {user?.role === 'admin' && (
              <>
                {onShowUsers && (
                    <button
                        onClick={onShowUsers}
                        className="btn-press p-2 rounded-full transition-colors" style={{color:"var(--text-muted)"}}
                        title="Gerenciar Usuários"
                        aria-label="Gerenciar Usuários"
                    >
                        <UserGroupIcon className="w-6 h-6" />
                    </button>
                )}
                {onShowLogs && (
                    <button
                        onClick={onShowLogs}
                        className="btn-press p-2 rounded-full transition-colors" style={{color:"var(--text-muted)"}}
                        title="Logs de Acesso"
                        aria-label="Logs de Acesso"
                    >
                        <ShieldIcon className="w-6 h-6" />
                    </button>
                )}
              </>
          )}

          <ThemeSwitcher theme={theme} toggleTheme={toggleTheme} />
          
          {onLogout && (
              <button
                  onClick={onLogout}
                  className="btn-press text-xs font-medium px-3 py-2 rounded-lg transition-colors" style={{color:"var(--danger)"}}
              >
                  Sair
              </button>
          )}

          <button
              onClick={onMenuClick}
              className="btn-press md:hidden p-2 rounded-full focus:outline-none transition-colors" style={{color:"var(--text-secondary)"}}
              aria-label="Abrir menu"
          >
              <MenuIcon className="w-6 h-6" />
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-md animate-fade-in hidden md:block" style={{color:"var(--text-muted)"}}>
        {description || "Seu assistente de IA para consultas fiscais inteligentes"}
      </p>
    </header>
  );
};

export default Header;
