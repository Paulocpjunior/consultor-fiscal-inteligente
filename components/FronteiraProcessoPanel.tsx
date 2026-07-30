/**
 * FronteiraProcessoPanel — O CORTE oficial: o que se faz no CFI × o que ainda
 * se faz no e-Fiscal (SAGE IOB). Vive dentro da Rotina do Mês, onde o
 * colaborador decide o próximo passo.
 *
 * Paulo, 30/07/2026: "o colaborador fica perdido — o que fazer, como fazer,
 * onde fazer. Tem que ter um corte." A fonte única do corte é
 * services/fronteiraProcesso.ts; esta tela só desenha.
 */
import React, { useState } from 'react';
import { FRONTEIRA, REGRA_DE_BOLSO, resumoFronteira, type RegimeFronteira } from '../services/fronteiraProcesso';

const SELO: Record<'cfi' | 'efiscal', { cls: string; label: string }> = {
    cfi: { cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', label: '✅ no CFI' },
    efiscal: { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', label: '🏛 e-Fiscal (por enquanto)' },
};

const FronteiraProcessoPanel: React.FC = () => {
    const [aberto, setAberto] = useState(false);
    const [regime, setRegime] = useState<RegimeFronteira>('simples');

    const linhas = FRONTEIRA[regime];
    const resumo = resumoFronteira(regime);

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
                onClick={() => setAberto((a) => !a)}
                className="w-full flex items-center justify-between gap-2 p-4 text-left"
                aria-expanded={aberto}
            >
                <div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                        🗺️ Onde fazer o quê — CFI × e-Fiscal (o corte oficial)
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        {REGRA_DE_BOLSO}
                    </p>
                </div>
                <span className="text-slate-400 text-sm flex-none">{aberto ? '▲ fechar' : '▼ abrir'}</span>
            </button>

            {aberto && (
                <div className="px-4 pb-4 space-y-3">
                    <div className="flex items-center gap-2">
                        {(['simples', 'lucro'] as RegimeFronteira[]).map((r) => (
                            <button
                                key={r}
                                onClick={() => setRegime(r)}
                                className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                                    regime === r
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40'
                                }`}
                            >
                                {r === 'simples' ? 'Simples Nacional' : 'Lucro Presumido/Real'}
                            </button>
                        ))}
                        <span className="ml-auto text-[11px] text-slate-400">
                            {resumo.cfi} de {resumo.total} tarefas já são no CFI
                        </span>
                    </div>

                    {regime === 'simples' && (
                        <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                            Regra do Simples: o e-Fiscal <u>não se abre</u> — exceção única é a DeSTDA (só quem tem ICMS-ST/DIFAL).
                        </p>
                    )}
                    {regime === 'lucro' && (
                        <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Regra do Lucro: tudo até a guia é CFI; livros/apuração de ICMS-IPI e SPED ainda são e-Fiscal —
                            <strong> sempre importando o .FML exportado do CFI</strong> (nunca digitar nota à mão lá).
                        </p>
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-[10px] uppercase text-slate-500">
                                    <th className="py-1 pr-3">Tarefa</th>
                                    <th className="py-1 pr-3">Onde</th>
                                    <th className="py-1">Como (o caminho exato)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {linhas.map((l) => (
                                    <tr key={l.tarefa} className="border-t border-slate-100 dark:border-slate-700 align-top">
                                        <td className="py-2 pr-3 font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap">
                                            {l.tarefa}
                                        </td>
                                        <td className="py-2 pr-3 whitespace-nowrap">
                                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${SELO[l.onde].cls}`}>
                                                {SELO[l.onde].label}
                                            </span>
                                        </td>
                                        <td className="py-2 text-slate-600 dark:text-slate-300">
                                            {l.como}
                                            {l.obs && (
                                                <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">⚠ {l.obs}</div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <p className="text-[11px] text-slate-400">
                        Este corte é a fonte oficial — quando uma tarefa migrar do e-Fiscal para o CFI, esta tabela muda
                        junto com a ferramenta. Dúvida que a tabela não resolve: falar com o admin, não improvisar.
                    </p>
                </div>
            )}
        </div>
    );
};

export default FronteiraProcessoPanel;
