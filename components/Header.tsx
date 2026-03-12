
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
    <header className="w-full py-6 md:py-8">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        {/* Left side: Logo & Title */}
        <div className="flex items-center gap-4 w-full md:w-auto justify-start">
          <Tooltip content="Consultor Fiscal Inteligente" position="bottom">
            <Logo />
          </Tooltip>
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-800 dark:text-slate-100 leading-tight">
              Consultor Fiscal
            </h1>
            <p className="text-xs sm:text-sm font-semibold text-sky-600 dark:text-sky-400 tracking-wider uppercase">
              Inteligente
            </p>
          </div>
        </div>

        {/* Right side: User Info & Actions */}
        <div className="flex items-center gap-3 self-end md:self-center">
          {user && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700 mr-2">
                  <div className={`p-1 rounded-full ${user.role === 'admin' ? 'bg-amber-100 text-amber-600' : 'bg-sky-100 text-sky-600'}`}>
                      <UserIcon className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-none">{user.name.split(' ')[0]}</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-none capitalize">{user.role}</span>
                  </div>
              </div>
          )}

          {user?.role === 'admin' && (
              <>
                {onShowUsers && (
                    <button
                        onClick={onShowUsers}
                        className="btn-press p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        title="Gerenciar Usuários"
                    >
                        <UserGroupIcon className="w-6 h-6" />
                    </button>
                )}
                {onShowLogs && (
                    <button
                        onClick={onShowLogs}
                        className="btn-press p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-amber-50 dark:hover:bg-slate-800 hover:text-amber-600 dark:hover:text-amber-500 transition-colors"
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
                  className="btn-press text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-2 rounded-lg transition-colors"
              >
                  Sair
              </button>
          )}

          <button
              onClick={onMenuClick}
              className="btn-press md:hidden p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 dark:focus:ring-offset-slate-900 transition-colors"
              aria-label="Abrir menu"
          >
              <MenuIcon className="w-6 h-6" />
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-md text-slate-600 dark:text-slate-400 animate-fade-in hidden md:block">
        {description || "Seu assistente de IA para consultas fiscais inteligentes"}
      </p>
    </header>
  );
};

export default Header;
