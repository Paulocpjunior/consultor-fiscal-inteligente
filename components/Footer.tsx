
import React from 'react';
import { APP_VERSION, APP_BUILD_DATE } from '../version';

const Footer: React.FC = () => {
  return (
    <footer className="w-full text-center py-6 px-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Direitos Reservados - Uso Exclusivo by SP Assessoria Contábil
        <br />
        As informações são geradas por IA e devem ser usadas como referência. Confirme com as fontes oficiais.
        <br />
        <span className="text-[10px] text-slate-400 dark:text-slate-500 opacity-60" title={`Build ${APP_BUILD_DATE}`}>v{APP_VERSION}</span>
      </p>
    </footer>
  );
};

export default Footer;
