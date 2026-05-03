
import React from 'react';
import ThemeSwitcher from './ThemeSwitcher';
import Logo from './Logo';
import Tooltip from './Tooltip';
import { MenuIcon, UserIcon, ShieldIcon, UserGroupIcon } from './Icons';
import { User } from '../types';

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
  return (
    <header className="w-full py-6 md:py-8" style={{borderBottom:"1px solid rgba(200,208,255,0.07)"}}>
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        {/* Left side: Logo & Title */}
        <div className="flex items-center gap-4 w-full md:w-auto justify-start">
          <Tooltip content="Consultor Fiscal Inteligente" position="bottom">
            <Logo />
          </Tooltip>
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl leading-tight" style={{color:"#F5F6FF",fontFamily:"Cormorant Garamond,serif",fontWeight:"300"}}>
              Consultor Fiscal
            </h1>
            <p className="text-xs sm:text-sm font-medium tracking-wider uppercase" style={{color:"#5B7FFF"}}>
              Inteligente
            </p>
          </div>
        </div>

        {/* Right side: User Info & Actions */}
        <div className="flex items-center gap-3 self-end md:self-center">
          {user && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full mr-2" style={{background:"rgba(8,0,122,0.2)",border:"1px solid rgba(200,208,255,0.1)"}}>
                  <div className="p-1 rounded-full" style={{background:user.role==='admin'?'rgba(245,166,35,0.15)':'rgba(20,0,255,0.15)',color:user.role==='admin'?'#F5A623':'#5B7FFF'}}>
                      <UserIcon className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col">
                      <span className="text-xs font-medium leading-none" style={{color:"#F5F6FF"}}>{user.name.split(' ')[0]}</span>
                      <span className="text-[10px] leading-none capitalize" style={{color:"rgba(200,208,255,0.4)"}}>{user.role}</span>
                  </div>
              </div>
          )}

          {user?.role === 'admin' && (
              <>
                {onShowUsers && (
                    <button
                        onClick={onShowUsers}
                        className="btn-press p-2 rounded-full transition-colors" style={{color:"rgba(200,208,255,0.5)"}}
                        title="Gerenciar Usuários"
                    >
                        <UserGroupIcon className="w-6 h-6" />
                    </button>
                )}
                {onShowLogs && (
                    <button
                        onClick={onShowLogs}
                        className="btn-press p-2 rounded-full transition-colors" style={{color:"rgba(200,208,255,0.5)"}}
                        title="Logs de Acesso"
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
                  className="btn-press text-xs font-medium px-3 py-2 rounded-lg transition-colors" style={{color:"#FF4466"}}
              >
                  Sair
              </button>
          )}

          <button
              onClick={onMenuClick}
              className="btn-press md:hidden p-2 rounded-full focus:outline-none transition-colors" style={{color:"rgba(200,208,255,0.6)"}}
              aria-label="Abrir menu"
          >
              <MenuIcon className="w-6 h-6" />
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-md animate-fade-in hidden md:block" style={{color:"rgba(200,208,255,0.4)"}}>
        {description || "Seu assistente de IA para consultas fiscais inteligentes"}
      </p>
    </header>
  );
};

export default Header;
