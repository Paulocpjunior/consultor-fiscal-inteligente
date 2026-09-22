// ============================================================================
// O que ficou FORA do recorte "só o CFI" (Paulo, 22/09: "aqui é somente
// sobre o CFI"). Não some em silêncio: sai contado por autor, com o motivo —
// e o motivo diz ONDE corrigir (Gerenciar Usuários), nunca deduz vínculo.
// ============================================================================
import React, { useState } from 'react';
import { ForaDoEscopoCfi } from '../../services/auditoriaDonoService';

const ForaDoEscopo: React.FC<{ fora?: ForaDoEscopoCfi; rotulo?: string }> = ({ fora, rotulo = 'evento' }) => {
    const [aberto, setAberto] = useState(false);
    if (!fora || !fora.eventos) return null;
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
            <button onClick={() => setAberto((v) => !v)} className="w-full flex items-center justify-between text-left">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    🚫 Fora do escopo do CFI: {fora.eventos} {rotulo}(s) de {fora.autores.length} autor(es) de outros apps do escritório
                </span>
                <span className="text-[10px] text-slate-400">{aberto ? 'ocultar' : 'ver quem'}</span>
            </button>
            {aberto && (
                <ul className="mt-2 space-y-0.5">
                    {fora.autores.map((a) => (
                        <li key={a.quem} className="text-[11px] text-slate-500 dark:text-slate-400 flex gap-2">
                            <span className="font-semibold text-slate-700 dark:text-slate-200 shrink-0">{a.quem}</span>
                            <span className="shrink-0">{a.quantidade}</span>
                            <span className="truncate">{a.motivo || ''}</span>
                        </li>
                    ))}
                    <li className="text-[10px] text-slate-400 pt-1">Se alguém aí atua no Fiscal, vincule o departamento em Configurações → Gerenciar Usuários. Nada aqui é deduzido.</li>
                </ul>
            )}
        </div>
    );
};

export default ForaDoEscopo;
