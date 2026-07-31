/**
 * ReformaCountdownBanner — alerta dos marcos CBS/IBS nos documentos fiscais.
 *
 * ATUALIZADO 31/07/2026 (Ato Conjunto RFB/CGIBS nº 4/2026): o início da
 * obrigatoriedade virou ESCALONADO — NF-e/NFC-e/CT-e/MDF-e seguem em
 * 03/08/2026 (regime regular, rejeição 1115), NFS-e em 01/10, NFAg/NF-e ABI
 * em 01/12 e Simples Nacional só em 01/01/2027. O banner mostra o PRÓXIMO
 * marco com contagem regressiva e o cronograma completo embaixo — a tabela
 * de datas vive em services/reformaMarcos.ts (fonte única, testada).
 *
 * Some sozinho quando o último marco passa. O usuário pode fechar
 * (lembra via localStorage por 1 dia).
 */
import React, { useMemo, useState } from 'react';
import { estadoMarcosReforma, cronogramaCompacto, fmtDataBr } from '../services/reformaMarcos';

const STORAGE_KEY = 'reforma_cbs_ibs_banner_fechado_em';

interface Props {
    /** Leva o colaborador pra aba Reforma Tributária ao clicar. */
    onIrParaReforma?: () => void;
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

    const estado = useMemo(() => estadoMarcosReforma(new Date()), []);

    if (fechado) return null;
    // Todos os marcos vigentes: banner aposenta (a info vira a aba Reforma).
    if (!estado.proximo || estado.diasAteProximo === null) return null;

    const dias = estado.diasAteProximo;
    const marco = estado.proximo;

    // Urgência crescente: <=7 vermelho, <=30 âmbar, senão azul.
    const tema =
        dias <= 7 ? { bg: 'linear-gradient(135deg,#dc2626,#b91c1c)', emoji: '🚨' }
        : dias <= 30 ? { bg: 'linear-gradient(135deg,#d97706,#b45309)', emoji: '⏳' }
        : { bg: 'linear-gradient(135deg,#1e40af,#1e3a8a)', emoji: '📣' };

    const fechar = () => {
        try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* ignore */ }
        setFechado(true);
    };

    const frase =
        dias === 0 ? `É HOJE — campos IBS/CBS obrigatórios em ${marco.docs}!`
        : dias === 1 ? `AMANHÃ os campos IBS/CBS ficam obrigatórios em ${marco.docs}!`
        : `Faltam ${dias} dias: campos IBS/CBS obrigatórios em ${marco.docs}`;

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
                    {fmtDataBr(marco.dataIso)}: {marco.publico}.
                    {' '}Cronograma: {cronogramaCompacto()} <i>(Ato Conjunto RFB/CGIBS nº 4/2026)</i>.
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
