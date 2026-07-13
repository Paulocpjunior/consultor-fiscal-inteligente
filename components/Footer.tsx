import React from 'react';
import { APP_VERSION, APP_RELEASE, APP_BUILD_TIME, APP_COMMIT, formatBuildDate } from '../version';

const Footer: React.FC = () => {
  return (
    <footer className="w-full text-center py-6 px-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Direitos Reservados - Uso Exclusivo by SP Assessoria Contábil
        <br />
        As informações são geradas por IA e devem ser usadas como referência. Confirme com as fontes oficiais.
      </p>
      <p
        className="mt-2 text-[10px] text-slate-400 dark:text-slate-500 font-mono"
        title={`Build: ${formatBuildDate(APP_BUILD_TIME)}`}
      >
        Versão {APP_VERSION} · Release {APP_RELEASE} · commit {APP_COMMIT} · atualizado {formatBuildDate(APP_BUILD_TIME)}
      </p>
    </footer>
  );
};

export default Footer;
