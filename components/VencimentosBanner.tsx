/**
 * VencimentosBanner.tsx
 *
 * Banner no topo do app que mostra obrigações vencendo. Refresh a cada
 * 5 min. Clica → vai pra aba Tarefas. Admin pode "Disparar alertas agora"
 * pra forçar email + push imediato (cron normal roda 08h BRT).
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
    fetchResumoVencimentos,
    dispararCronVencimentos,
    type ResumoVencimentos,
    type ProximaObrigacao,
} from '../services/vencimentosService';
import type { User } from '../types';

interface Props {
    currentUser: User | null;
    onClickIrTarefas?: () => void;
}

const DISMISS_KEY = 'vencimentosBanner:dismissed';

const fmtCnpj = (s?: string) => (s || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

const labelDias = (d: number) => {
    if (d < 0) return `há ${Math.abs(d)}d`;
    if (d === 0) return 'hoje';
    if (d === 1) return 'amanhã';
    return `em ${d}d`;
};

const VencimentosBanner: React.FC<Props> = ({ currentUser, onClickIrTarefas }) => {
    const [resumo, setResumo] = useState<ResumoVencimentos | null>(null);
    const [proximas, setProximas] = useState<ProximaObrigacao[]>([]);
    const [aberto, setAberto] = useState(false);
    const [loading, setLoading] = useState(false);
    const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');
    const [disparando, setDisparando] = useState(false);
    const isAdmin = currentUser?.role === 'admin';
    // Guard que evita setState apos unmount (fetch que termina depois do componente desmontar)
    const aliveRef = useRef(true);

    const carregar = useCallback(async () => {
        if (!currentUser) return;
        setLoading(true);
        try {
            const r = await fetchResumoVencimentos();
            if (!aliveRef.current) return;
            setResumo(r.resumo);
            setProximas(r.proximas);
        } catch {
            // silencioso — banner não bloqueia app
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, [currentUser]);

    useEffect(() => {
        if (!currentUser) return;
        aliveRef.current = true;
        carregar();
        const interval = setInterval(carregar, 5 * 60 * 1000); // 5 min
        return () => {
            aliveRef.current = false;
            clearInterval(interval);
        };
    }, [carregar, currentUser]);

    if (!currentUser || !resumo || dismissed) return null;

    const total = resumo.atrasadas + resumo.venceHoje + resumo.venceAmanha + resumo.vence3d;
    if (total === 0) return null;

    const cor =
        resumo.atrasadas > 0 || resumo.venceHoje > 0 ? 'from-red-600 to-rose-600'
        : resumo.venceAmanha > 0 ? 'from-orange-500 to-amber-500'
        : 'from-yellow-500 to-amber-500';

    const dispararAlertas = async () => {
        if (!confirm('Disparar emails e notificações de vencimento AGORA para todas as obrigações próximas?')) return;
        setDisparando(true);
        try {
            const r = await dispararCronVencimentos();
            alert(r.ok ? '✅ Alertas disparados em background. Verifique caixa de entrada em 1-2 min.' : `❌ ${r.error}`);
        } finally {
            setDisparando(false);
        }
    };

    return (
        <div className={`bg-gradient-to-r ${cor} text-white shadow-lg`}>
            <div className="max-w-screen-2xl mx-auto px-4 py-2 flex items-center gap-3 text-sm">
                <span className="text-xl">⚠️</span>
                <div className="flex-1 min-w-0">
                    <div className="font-bold">
                        {resumo.atrasadas > 0 && <span className="mr-3">🔴 {resumo.atrasadas} atrasada{resumo.atrasadas > 1 ? 's' : ''}</span>}
                        {resumo.venceHoje > 0 && <span className="mr-3">🟠 {resumo.venceHoje} vence{resumo.venceHoje > 1 ? 'm' : ''} hoje</span>}
                        {resumo.venceAmanha > 0 && <span className="mr-3">🟡 {resumo.venceAmanha} vence{resumo.venceAmanha > 1 ? 'm' : ''} amanhã</span>}
                        {resumo.vence3d > 0 && <span className="mr-3">🟢 {resumo.vence3d} em ≤3 dias</span>}
                    </div>
                    <div className="text-xs opacity-90 truncate">
                        {proximas.length > 0 && `${proximas[0].titulo} (${proximas[0].empresaNome}) — ${labelDias(proximas[0].diasAteVencimento)}`}
                    </div>
                </div>
                <button
                    onClick={() => setAberto(!aberto)}
                    className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-semibold"
                >
                    {aberto ? '▲ Fechar' : '▼ Ver detalhes'}
                </button>
                {onClickIrTarefas && (
                    <button
                        onClick={onClickIrTarefas}
                        className="px-3 py-1 bg-white text-red-700 rounded text-xs font-bold hover:bg-gray-100"
                    >
                        Ir pra Tarefas →
                    </button>
                )}
                <button
                    onClick={() => { sessionStorage.setItem(DISMISS_KEY, '1'); setDismissed(true); }}
                    className="text-white/70 hover:text-white text-lg leading-none"
                    title="Ocultar até nova sessão"
                >×</button>
            </div>

            {aberto && (
                <div className="max-w-screen-2xl mx-auto px-4 pb-3">
                    <div className="bg-white text-gray-900 rounded-lg shadow-inner max-h-96 overflow-y-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-gray-100 sticky top-0">
                                <tr>
                                    <th className="px-2 py-1.5 text-left">Quando</th>
                                    <th className="px-2 py-1.5 text-left">Obrigação</th>
                                    <th className="px-2 py-1.5 text-left">Empresa</th>
                                    <th className="px-2 py-1.5 text-left">Responsável</th>
                                    <th className="px-2 py-1.5 text-right">Valor</th>
                                </tr>
                            </thead>
                            <tbody>
                                {proximas.map(p => {
                                    const cor =
                                        p.diasAteVencimento < 0 ? 'text-red-700 bg-red-50'
                                        : p.diasAteVencimento === 0 ? 'text-orange-700 bg-orange-50'
                                        : p.diasAteVencimento === 1 ? 'text-amber-700 bg-amber-50'
                                        : '';
                                    return (
                                        <tr key={p.id} className={`border-t ${cor}`}>
                                            <td className="px-2 py-1.5 font-semibold">{labelDias(p.diasAteVencimento)}</td>
                                            <td className="px-2 py-1.5">{p.titulo}</td>
                                            <td className="px-2 py-1.5">
                                                <div>{p.empresaNome}</div>
                                                <div className="text-[10px] text-gray-500">{fmtCnpj(p.empresaCnpj)}</div>
                                            </td>
                                            <td className="px-2 py-1.5">{p.responsavelNome || '(sem)'}</td>
                                            <td className="px-2 py-1.5 text-right font-mono">
                                                {p.valorEstimado ? `R$ ${p.valorEstimado.toFixed(2)}` : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {proximas.length === 0 && (
                                    <tr><td colSpan={5} className="p-3 text-center text-gray-500">Sem obrigações próximas.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {isAdmin && (
                        <div className="flex gap-2 mt-2">
                            <button
                                onClick={dispararAlertas}
                                disabled={disparando}
                                className="px-3 py-1.5 bg-white text-red-700 rounded text-xs font-bold hover:bg-gray-100 disabled:opacity-50"
                            >
                                {disparando ? '⏳ Disparando…' : '✉️ Disparar alertas agora'}
                            </button>
                            <button onClick={carregar} disabled={loading} className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded text-xs">
                                {loading ? '…' : '↻ Atualizar'}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default VencimentosBanner;
