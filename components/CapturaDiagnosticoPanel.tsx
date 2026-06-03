/**
 * CapturaDiagnosticoPanel.tsx
 *
 * Painel admin que mostra estado REAL das 3 capturas noturnas
 * (NFe DistDFe, NFSe SP, NFSe Nacional ADN):
 *   - última execução do cron + duração + sucessos/falhas
 *   - total de empresas elegíveis + travadas (>7d sem sync)
 *   - docs capturados nos últimos 7d (NFe / NFSe SP / NFSe Nacional)
 *   - janela operacional atual
 *   - botão "Forçar captura agora" pra cada fonte
 *
 * Lê de /api/admin/sefaz/captura-diagnostico.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
    fetchCapturaDiagnostico,
    forcarCapturaAgora,
    type CapturaDiagnostico,
    type CapturaStatus,
    type CronLog,
} from '../services/capturaDiagnosticoService';
import type { User } from '../types';
import ConsultaNFePorChavePanel from './ConsultaNFePorChavePanel';

interface Props {
    currentUser: User;
}

function formatRelativeBR(ms: number | null | undefined): string {
    if (!ms) return 'nunca';
    const diffMin = Math.floor((Date.now() - ms) / 60000);
    if (diffMin < 1) return 'agora';
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `há ${diffH}h`;
    return `há ${Math.floor(diffH / 24)}d`;
}

function statusColor(ultimoMs: number | null | undefined): string {
    if (!ultimoMs) return 'bg-red-100 text-red-800 border-red-300';
    const diffH = (Date.now() - ultimoMs) / 3600000;
    if (diffH < 30) return 'bg-green-100 text-green-800 border-green-300';
    if (diffH < 72) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-red-100 text-red-800 border-red-300';
}

function isCronLog(x: any): x is CronLog {
    return x && typeof x === 'object' && 'executadoEmMs' in x;
}

const CardCaptura: React.FC<{
    titulo: string;
    status: CapturaStatus;
    fonte: 'sefazNfe' | 'nfseSp' | 'nfseNacional';
    isAdmin: boolean;
    onForcarOk: () => void;
}> = ({ titulo, status, fonte, isAdmin, onForcarOk }) => {
    const [forcando, setForcando] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null);

    const log = isCronLog(status.ultimoCron) ? status.ultimoCron : null;
    const ultimoMs = log?.executadoEmMs ?? null;
    const cor = statusColor(ultimoMs);
    const stateOk = status.state && 'total' in status.state;
    const stateTotal = stateOk ? (status.state as any).total : null;
    const stateTravadas = stateOk ? (status.state as any).travadas : null;
    // bloqueadas = empresas sem cert A1/A3 nem procuracao e-CAC. Sao puladas
    // pelo cron (nao tentam capturar) — exibimos separado pra nao confundir
    // com "falhas" reais e pra contador ver o que precisa cadastrar.
    const stateBloqueadas = stateOk ? (status.state as any).bloqueadas : null;

    const handleForcar = async () => {
        setForcando(true);
        setFeedback(null);
        try {
            const r = await forcarCapturaAgora(fonte);
            if (r.ok) {
                setFeedback('Captura iniciada em background. Aguarde alguns minutos.');
                setTimeout(onForcarOk, 5000);
            } else {
                setFeedback(`Erro: ${r.motivo || 'falha desconhecida'}`);
            }
        } catch (e: any) {
            setFeedback(`Erro: ${e.message}`);
        } finally {
            setForcando(false);
        }
    };

    return (
        <div className={`border-2 rounded-lg p-4 ${cor}`}>
            <div className="flex items-start justify-between mb-3">
                <div>
                    <h3 className="font-bold text-base">{titulo}</h3>
                    <p className="text-xs opacity-80 mt-1">{status.fonte}</p>
                </div>
                <span className="text-2xl">
                    {!ultimoMs ? '🚨' : (Date.now() - ultimoMs) / 3600000 < 30 ? '✅' : (Date.now() - ultimoMs) / 3600000 < 72 ? '⚠️' : '🔴'}
                </span>
            </div>

            <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="opacity-80">Última execução:</span>
                    <span className="font-semibold">{formatRelativeBR(ultimoMs)}</span>
                </div>
                {log && (
                    <>
                        <div className="flex justify-between">
                            <span className="opacity-80">Sucessos / Falhas:</span>
                            <span className="font-mono">{log.sucessos ?? 0} / {log.falhas ?? 0}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="opacity-80">Novos docs (essa exec.):</span>
                            <span className="font-mono">{log.totalNovos ?? 0}</span>
                        </div>
                        {log.erroFatal && (
                            <div className="text-red-700 bg-red-50 p-2 rounded text-xs mt-1">
                                <strong>Erro fatal:</strong> {log.erroFatal}
                            </div>
                        )}
                    </>
                )}
                <div className="flex justify-between border-t pt-2 mt-2">
                    <span className="opacity-80">Empresas elegíveis:</span>
                    <span className="font-mono">
                        {stateTotal ?? '—'}
                        {stateTravadas !== null && stateTravadas !== undefined && stateTravadas > 0 && (
                            <span className="text-red-700 ml-2">({stateTravadas} travadas &gt;7d)</span>
                        )}
                    </span>
                </div>
                {stateBloqueadas !== null && stateBloqueadas !== undefined && stateBloqueadas > 0 && (
                    <div className="flex justify-between">
                        <span className="opacity-80" title="Empresas sem cert A1/A3 e sem procuração e-CAC — admin precisa configurar antes de capturar">
                            🔒 Bloqueadas por cadastro:
                        </span>
                        <span className="font-mono text-amber-700">{stateBloqueadas}</span>
                    </div>
                )}
                <div className="flex justify-between">
                    <span className="opacity-80">Docs capturados &lt;7d:</span>
                    <span className="font-mono font-bold">{status.docsUltimos7d ?? '—'}</span>
                </div>
                <div className="text-xs opacity-70 pt-2 border-t mt-2">
                    <div>📅 {status.schedulerEsperado}</div>
                </div>
            </div>

            {isAdmin && (
                <div className="mt-3 pt-3 border-t">
                    <button
                        onClick={handleForcar}
                        disabled={forcando}
                        className="w-full px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                        {forcando ? '⏳ Disparando…' : '▶ Forçar captura agora'}
                    </button>
                    {feedback && (
                        <p className="text-xs mt-2 opacity-90">{feedback}</p>
                    )}
                </div>
            )}
        </div>
    );
};

const CapturaDiagnosticoPanel: React.FC<Props> = ({ currentUser }) => {
    const [data, setData] = useState<CapturaDiagnostico | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const isAdmin = currentUser.role === 'admin';

    const load = useCallback(async () => {
        setLoading(true);
        setErro(null);
        try {
            const d = await fetchCapturaDiagnostico();
            setData(d);
        } catch (e: any) {
            setErro(e.message || 'Falha ao carregar diagnóstico');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const interval = setInterval(load, 60000); // refresh a cada 1min
        return () => clearInterval(interval);
    }, [load]);

    if (loading && !data) {
        return <div className="p-6 text-center text-gray-500">Carregando diagnóstico de captura…</div>;
    }
    if (erro) {
        return (
            <div className="p-6 border border-red-300 bg-red-50 rounded">
                <p className="text-red-700 font-semibold">Erro ao carregar: {erro}</p>
                <button onClick={load} className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm">Tentar de novo</button>
            </div>
        );
    }
    if (!data) return null;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        🛰️ Diagnóstico de Captura Automática
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Estado real das 3 capturas noturnas que alimentam os XMLs e NFSe dos clientes.
                    </p>
                </div>
                <button
                    onClick={load}
                    className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 rounded transition"
                >
                    ↻ Atualizar
                </button>
            </div>

            <div className={`p-3 rounded border ${data.janela.dentro ? 'bg-green-50 border-green-300 text-green-800' : 'bg-yellow-50 border-yellow-300 text-yellow-800'}`}>
                <div className="text-sm">
                    <strong>Janela operacional:</strong> {data.janela.agoraBRT} BRT —{' '}
                    {data.janela.dentro ? '✅ dentro (captura manual permitida)' : `⏸️ fora (${data.janela.motivo || 'horário restrito'})`}
                </div>
                <div className="text-xs opacity-80 mt-1">
                    Cron noturno (02h/03h/04h) roda 24/7, não bloqueia por janela.
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <CardCaptura
                    titulo="NFe — Entrada/Saída"
                    status={data.capturas.sefazNfe}
                    fonte="sefazNfe"
                    isAdmin={isAdmin}
                    onForcarOk={load}
                />
                <CardCaptura
                    titulo="NFSe SP — Tomados+Prestados"
                    status={data.capturas.nfseSp}
                    fonte="nfseSp"
                    isAdmin={isAdmin}
                    onForcarOk={load}
                />
                <CardCaptura
                    titulo="NFSe Nacional ADN"
                    status={data.capturas.nfseNacional}
                    fonte="nfseNacional"
                    isAdmin={isAdmin}
                    onForcarOk={load}
                />
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 p-3 bg-gray-50 dark:bg-gray-800 rounded">
                <strong>Como ler:</strong> 🟢 verde = última execução &lt;30h · 🟡 amarelo = 30-72h · 🔴 vermelho = &gt;72h ou nunca executado.
                Empresas <strong>travadas &gt;7d</strong> são as que não tiveram nova captura — verifique cert, autorização ou flag de captura.
            </div>

            {isAdmin && <ConsultaNFePorChavePanel />}
        </div>
    );
};

export default CapturaDiagnosticoPanel;
