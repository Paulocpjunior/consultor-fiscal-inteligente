import React from 'react';
import { APP_RELEASE, APP_BUILD_TIME, APP_COMMIT, formatBuildDate, rotuloVersao } from '../version';

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
        Versão {rotuloVersao()} · Release {APP_RELEASE} · commit {APP_COMMIT} · atualizado {formatBuildDate(APP_BUILD_TIME)}
      </p>
      {/* O guia de conferência mora AO LADO DA VERSÃO de propósito: ele começa
          mandando anotar a versão, e foi um print de tela desatualizada — com o
          defeito já corrigido — que o originou (12/08). Print sem versão é
          narrativa, não evidência. */}
      <p className="mt-1 text-[10px] flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <a
          href="/guia-ordem-do-mes.html"
          target="_blank"
          rel="noreferrer"
          className="text-slate-400 dark:text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 underline underline-offset-2"
        >
          📘 Manual do mês — EFD-Reinf e DCTFWeb por departamento
        </a>
        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
        <a
          href="/guia-conferencia-entregas.html"
          target="_blank"
          rel="noreferrer"
          className="text-slate-400 dark:text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 underline underline-offset-2"
        >
          📗 Como conferir uma entrega nova (e o que reportar)
        </a>
      </p>
    </footer>
  );
};

export default Footer;
