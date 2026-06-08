/**
 * ReformaCountdownBanner — alerta de contagem regressiva pro marco CBS/IBS.
 *
 * A Reforma Tributária (EC 132/2023) entra em fase relevante em 01/08/2026.
 * Este banner fica no topo lembrando quantos dias faltam, com urgência
 * crescente conforme a data chega. Some sozinho depois que a data passa
 * (vira aviso de "já vigente").
 *
 * Data configurável via env VITE_REFORMA_CBS_IBS_DATE (YYYY-MM-DD); default
 * 2026-08-01. O usuário pode fechar (lembra via localStorage por 1 dia).
 */
import React, { useMemo, useState } from 'react';

// Marco CBS/IBS. ISO (meia-noite local). Override por env se a data mudar.
const DATA_ALVO_ISO =
    ((import.meta as any).env?.VITE_REFORMA_CBS_IBS_DATE as string) || '2026-08-01';

const STORAGE_KEY = 'reforma_cbs_ibs_banner_fechado_em';

interface Props {
    /** Leva o colaborador pra aba Reforma Tributária ao clicar. */
    onIrParaReforma?: () => void;
}

function diasAte(alvoIso: string): number {
    const [a, m, d] = alvoIso.split('-').map(Number);
    if (!a || !m || !d) return NaN;
    const alvo = new Date(a, m - 1, d);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return Math.round((alvo.getTime() - hoje.getTime()) / 86_400_000);
}

function fmtDataBr(alvoIso: string): string {
    const [a, m, d] = alvoIso.split('-');
    return `${d}/${m}/${a}`;
}

const ReformaCountdownBanner: React.FC<Props> = ({ onIrParaReforma }) => {
    const [fechado, setFechado] = useState<boolean>(() => {
        try {
            const ts = localStorage.getItem(STORAGE_KEY);
            if (!ts) return false;
            // Reaparece no dia seguinte (countdown muda todo dia).
            return Date.now() - Number(ts) < 24 * 60 * 60 * 1000;
        } catch { return false; }
    });

    const dias = useMemo(() => diasAte(DATA_ALVO_ISO), []);

    if (fechado || !Number.isFinite(dias)) return null;
    // Passou da data: some (a info vira a própria aba Reforma).
    if (dias < 0) return null;

    // Urgência crescente: <=15 vermelho, <=45 âmbar, senão azul.
    const tema =
        dias <= 15 ? { bg: 'linear-gradient(135deg,#dc2626,#b91c1c)', emoji: '🚨' }
        : dias <= 45 ? { bg: 'linear-gradient(135deg,#d97706,#b45309)', emoji: '⏳' }
        : { bg: 'linear-gradient(135deg,#1e40af,#1e3a8a)', emoji: '📣' };

    const fechar = () => {
        try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* ignore */ }
        setFechado(true);
    };

    const frase =
        dias === 0 ? 'É HOJE — CBS/IBS entra em vigor!'
        : dias === 1 ? 'Falta 1 dia pro início da CBS/IBS!'
        : `Faltam ${dias} dias pro início da CBS/IBS`;

    return (
        <div
            className="rounded-xl p-3 mb-3 flex items-center gap-3 text-white shadow-sm"
            style={{ background: tema.bg }}
        >
            <span className="text-2xl leading-none flex-shrink-0">{tema.emoji}</span>
            <div className="flex-1 min-w-0">
                <p className="font-bold text-sm leading-tight">
                    Reforma Tributária — {frase}
                </p>
                <p className="text-xs opacity-90 leading-tight">
                    Marco em <b>{fmtDataBr(DATA_ALVO_ISO)}</b>. Prepare as empresas: simule o impacto
                    IBS/CBS e revise CFOP/CST/NCM.
                </p>
            </div>
            {onIrParaReforma && (
                <button
                    onClick={onIrParaReforma}
                    className="flex-shrink-0 text-xs font-bold bg-white/20 hover:bg-white/30 transition-colors px-3 py-1.5 rounded-lg whitespace-nowrap"
                >
                    Simular impacto →
                </button>
            )}
            <button
                onClick={fechar}
                className="flex-shrink-0 text-white/70 hover:text-white text-lg leading-none px-1"
                title="Fechar por hoje"
                aria-label="Fechar"
            >
                ×
            </button>
        </div>
    );
};

export default ReformaCountdownBanner;
