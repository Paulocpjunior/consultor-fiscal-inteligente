/**
 * CronsHealthPanel.tsx
 *
 * Visão única (admin) da saúde de TODOS os crons de captura/apuração — lê o
 * último log de cada coleção *_cron_logs via /api/admin/crons/health e mostra
 * verde/amarelo/vermelho num relance. Complementa o CapturaDiagnosticoPanel
 * (que detalha só as 3 capturas noturnas) com a lista completa "algum parou?".
 *
 * Se o usuário não for admin (403), o painel se esconde silenciosamente.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { fetchCronsHealth, type CronsHealth, type CronSaudeLinha, type CronSaude } from '../services/capturaDiagnosticoService';

const SAUDE_UI: Record<CronSaude, { label: string; cls: string; dot: string }> = {
    ok:            { label: 'OK',         cls: 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700',   dot: 'bg-green-500' },
    atrasado:      { label: 'Atrasado',   cls: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700', dot: 'bg-yellow-500' },
    // Run morto no meio (deploy/reciclagem) — âmbar: não capturou nesta rodada,
    // mas a próxima execução do cron ainda está dentro da janela.
    interrompido:  { label: 'Interrompido', cls: 'bg-amber-50 dark:bg-amber-900/20 border-amber-400 dark:border-amber-700', dot: 'bg-amber-500' },
    travado:       { label: 'Travado',    cls: 'bg-red-50 dark:bg-red-900/20 border-red-400 dark:border-red-700',         dot: 'bg-red-500' },
    falha:         { label: 'Falha',      cls: 'bg-red-50 dark:bg-red-900/20 border-red-400 dark:border-red-700',         dot: 'bg-red-500' },
    'sem-dados':   { label: 'Sem dados',  cls: 'bg-slate-50 dark:bg-slate-800/40 border-slate-300 dark:border-slate-600', dot: 'bg-slate-400' },
    'erro-leitura':{ label: 'Erro',       cls: 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700', dot: 'bg-orange-500' },
};

function idadeLabel(l: CronSaudeLinha): string {
    if (l.idadeHoras == null) return 'nunca rodou';
    const h = l.idadeHoras;
    if (h < 1) return 'há minutos';
    if (h < 24) return `há ${Math.round(h)}h`;
    return `há ${Math.round(h / 24)}d`;
}

function resumoLabel(l: CronSaudeLinha): string {
    const r = l.resumo || {};
    const parts: string[] = [];
    if (typeof r.sucessos === 'number') parts.push(`${r.sucessos} ok`);
    if (typeof r.falhas === 'number' && r.falhas > 0) parts.push(`${r.falhas} falha(s)`);
    if (typeof r.totalNovos === 'number') parts.push(`${r.totalNovos} novos`);
    else if (typeof r.novosXmls === 'number') parts.push(`${r.novosXmls} novos`);
    return parts.join(' · ');
}

const CronsHealthPanel: React.FC = () => {
    const [data, setData] = useState<CronsHealth | null>(null);
    const [loading, setLoading] = useState(true);
    const [oculto, setOculto] = useState(false);

    const carregar = useCallback(async () => {
        setLoading(true);
        try {
            setData(await fetchCronsHealth());
        } catch (e: any) {
            // 403 → não é admin: esconde o painel sem ruído.
            if (String(e?.message || '').includes('403') || /admin/i.test(String(e?.message || ''))) {
                setOculto(true);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { carregar(); }, [carregar]);

    if (oculto) return null;

    const interrompidos = (data?.linhas || []).filter((l) => l.saude === 'interrompido').length;

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 mt-4">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Saúde dos crons</h3>
                    <p className="text-[11px] text-slate-400">
                        Último log de cada rotina de captura/apuração.
                        {data && data.problemas > 0 && (
                            <span className="ml-1 font-bold text-red-600 dark:text-red-400">{data.problemas} com problema.</span>
                        )}
                        {/* Farol honesto: só diz "todos ok" se NÃO houver run
                            interrompido — interrompido não capturou nada. */}
                        {data && data.problemas === 0 && interrompidos > 0 && (
                            <span className="ml-1 font-bold text-amber-600 dark:text-amber-400">
                                {interrompidos} interrompido(s) por reinício do servidor — a próxima rodada retoma.
                            </span>
                        )}
                        {data && data.problemas === 0 && interrompidos === 0 && <span className="ml-1 text-green-600 dark:text-green-400">todos ok.</span>}
                    </p>
                </div>
                <button
                    onClick={carregar}
                    disabled={loading}
                    className="px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40 font-bold"
                >
                    {loading ? 'Atualizando…' : '↻ Atualizar'}
                </button>
            </div>

            {!data && loading && <p className="text-xs text-slate-400 py-2">Carregando…</p>}

            {data && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {data.linhas.map((l) => {
                        const ui = SAUDE_UI[l.saude] || SAUDE_UI['sem-dados'];
                        const resumo = resumoLabel(l);
                        return (
                            <div key={l.collection} className={`rounded-lg border p-2.5 ${ui.cls}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate" title={l.label}>{l.label}</span>
                                    <span className="flex items-center gap-1 shrink-0">
                                        <span className={`w-2 h-2 rounded-full ${ui.dot}`} />
                                        <span className="text-[10px] font-bold uppercase text-slate-600 dark:text-slate-300">{ui.label}</span>
                                    </span>
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                    {idadeLabel(l)}
                                    {resumo && <span> · {resumo}</span>}
                                </div>
                                {/* Motivo dominante das falhas — sem isto "0 ok · 500 falhas"
                                    era número mudo; agora a causa aparece no card. */}
                                {l.motivoTop && (l.saude === 'falha' || l.saude === 'travado' || l.saude === 'interrompido' || (l.resumo?.falhas ?? 0) > 0) && (
                                    <div className={`mt-0.5 text-[10px] break-words ${l.saude === 'interrompido' ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400'}`} title={l.motivoTop}>
                                        {l.motivoTop}
                                    </div>
                                )}
                                {l.erro && <div className="mt-0.5 text-[10px] text-orange-600 dark:text-orange-400 truncate" title={l.erro}>{l.erro}</div>}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default CronsHealthPanel;
