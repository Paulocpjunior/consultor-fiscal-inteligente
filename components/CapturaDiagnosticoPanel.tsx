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

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { avaliarSaudeCaptura } from '../services/capturaSaude';
import {
    fetchCapturaDiagnostico,
    forcarCapturaAgora,
    type CapturaDiagnostico,
    type CapturaStatus,
    type CronLog,
} from '../services/capturaDiagnosticoService';
import type { User } from '../types';
import ConsultaNFePorChavePanel from './ConsultaNFePorChavePanel';
import { manifestarPendentes, type ManifestarPendentesResult, type TipoManifestacao } from '../services/manifestoService';

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

// Cores por nível de saúde HONESTA (resultado, não recência) — vide
// services/capturaSaude.ts. "Rodou há pouco" sozinho nunca mais dá verde.
const COR_POR_NIVEL: Record<'ok' | 'atencao' | 'critico', string> = {
    ok: 'bg-green-100 text-green-800 border-green-300',
    atencao: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    critico: 'bg-red-100 text-red-800 border-red-300',
};
const EMOJI_POR_NIVEL: Record<'ok' | 'atencao' | 'critico', string> = {
    ok: '✅', atencao: '⚠️', critico: '🔴',
};

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
    const stateOk = status.state && 'total' in status.state;
    const stateTotal = stateOk ? (status.state as any).total : null;
    const stateTotalAtivas = stateOk ? (status.state as any).totalAtivas : null;
    const stateTravadas = stateOk ? (status.state as any).travadas : null;
    // bloqueadas = empresas sem A1 proprio/mesma raiz nem A3 local. Sao puladas
    // pelo cron (nao tentam capturar) — exibimos separado pra nao confundir
    // com "falhas" reais e pra contador ver o que precisa cadastrar.
    const stateBloqueadas = stateOk ? (status.state as any).bloqueadas : null;

    // Saúde HONESTA: mede resultado (docs capturados + taxa de sucesso), não
    // só "o cron rodou". Regressão do verde mentiroso da NFS-e SP (0/121 ✅).
    const saude = avaliarSaudeCaptura({
        ultimoMs,
        sucessos: log?.sucessos ?? null,
        falhas: log?.falhas ?? null,
        docsUltimos7d: status.docsUltimos7d ?? null,
        elegiveis: stateTotal ?? null,
        agoraMs: Date.now(),
    });
    const cor = COR_POR_NIVEL[saude.nivel];

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
                <span className="text-2xl" title={saude.motivo}>
                    {EMOJI_POR_NIVEL[saude.nivel]}
                </span>
            </div>

            {/* Motivo do farol — sempre visível; é o que evita "verde mentiroso". */}
            <div className={`text-xs font-semibold mb-2 ${
                saude.nivel === 'critico' ? 'text-red-800' : saude.nivel === 'atencao' ? 'text-amber-800' : 'text-emerald-800'
            }`}>
                {saude.motivo}
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
                {/* Por que está falhando — agregado da última execução. Sem isto
                    o card dizia "0/121" e ninguém sabia a causa. */}
                {status.topFalhas?.top && status.topFalhas.top.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded p-2 text-xs space-y-1">
                        <div className="font-bold text-red-800">Principais motivos de falha:</div>
                        {status.topFalhas.top.map((f, i) => (
                            <div key={i} className="text-red-700">
                                <span className="font-mono font-bold">{f.quantidade}×</span> {f.motivo}
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex justify-between border-t pt-2 mt-2">
                    <span className="opacity-80">Empresas elegíveis:</span>
                    <span className="font-mono">
                        {stateTotal ?? '—'}
                        {stateTotalAtivas !== null && stateTotalAtivas !== undefined && stateTotalAtivas !== stateTotal && (
                            <span className="opacity-70 ml-1">/ {stateTotalAtivas} ativas</span>
                        )}
                        {stateTravadas !== null && stateTravadas !== undefined && stateTravadas > 0 && (
                            <span className="text-red-700 ml-2">({stateTravadas} travadas &gt;7d)</span>
                        )}
                    </span>
                </div>
                {stateBloqueadas !== null && stateBloqueadas !== undefined && stateBloqueadas > 0 && (
                    <div className="flex justify-between">
                        <span className="opacity-80" title="Empresas sem A1 próprio/mesma raiz CNPJ ou A3 local — admin precisa configurar antes de capturar">
                            🔒 Bloqueadas por cadastro:
                        </span>
                        <span className="font-mono text-amber-700">{stateBloqueadas}</span>
                    </div>
                )}
                {status.docsTotalHistorico !== undefined && status.docsTotalHistorico !== null && (
                    <div className="flex justify-between">
                        <span className="opacity-80" title="Se 0: esta fonte NUNCA capturou nada — problema de elegibilidade (ex.: municípios não aderentes ao ADN), não de cron.">
                            Docs (histórico total):
                        </span>
                        <span className={`font-mono font-bold ${status.docsTotalHistorico === 0 ? 'text-red-700' : ''}`}>
                            {status.docsTotalHistorico}
                            {status.docsTotalHistorico === 0 && ' — nunca capturou'}
                        </span>
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
    // Guard contra setState apos unmount
    const aliveRef = useRef(true);

    const load = useCallback(async () => {
        setLoading(true);
        setErro(null);
        try {
            const d = await fetchCapturaDiagnostico();
            if (aliveRef.current) setData(d);
        } catch (e: any) {
            if (aliveRef.current) setErro(e.message || 'Falha ao carregar diagnóstico');
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        aliveRef.current = true;
        load();
        const interval = setInterval(load, 60000); // refresh a cada 1min
        return () => {
            aliveRef.current = false;
            clearInterval(interval);
        };
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
                <strong>Como ler:</strong> o farol mede RESULTADO, não só execução: 🔴 = falhando tudo, 0 docs em 7d com empresas elegíveis, ou parado &gt;72h · 🟡 = mais falha que sucesso ou execução atrasada · 🟢 = executando E capturando.
                Empresas <strong>travadas &gt;7d</strong> são as que não tiveram nova captura — verifique cert, autorização ou flag de captura.
            </div>

            {isAdmin && <ConsultaNFePorChavePanel />}
            {isAdmin && <ManifestarPendentesCard />}
        </div>
    );
};

// Botao admin pra disparar manifestacao em lote dos resNFe pendentes na base.
// Auto-manifestacao (PR #35) cobre NOVOS imports. Esse botao cobre o HISTORICO
// que ja estava como resumo antes do PR #35 — usuario clica uma vez (ou
// algumas, em batches de 100) e a base e atualizada com procNFe completos.
const ManifestarPendentesCard: React.FC = () => {
    const [rodando, setRodando] = React.useState(false);
    const [resultado, setResultado] = React.useState<ManifestarPendentesResult | null>(null);
    const [limit, setLimit] = React.useState(100);
    const [tipo, setTipo] = React.useState<TipoManifestacao>('ciencia');

    const handleRun = async (dryRun: boolean) => {
        setRodando(true);
        setResultado(null);
        try {
            const r = await manifestarPendentes({ tipo, limit, dryRun });
            setResultado(r);
        } catch (e: any) {
            setResultado({ erro: e.message || 'erro' });
        } finally {
            setRodando(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">
                📨 Manifestar resNFe pendentes (libera procNFe completo)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Dispara <strong>Manifestação do Destinatário</strong> em lote pros resNFe já capturados na base.
                SEFAZ libera o <strong>procNFe completo</strong> (com itens, totais, natOp) na próxima DistDFe.
                Novas capturas já fazem isso automaticamente (PR #35) — esse botão cobre o histórico.
            </p>
            <div className="flex flex-wrap gap-2 items-end mb-3">
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Tipo</label>
                    <select
                        value={tipo}
                        onChange={(e) => setTipo(e.target.value as TipoManifestacao)}
                        className="px-2 py-1 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded"
                    >
                        <option value="ciencia">Ciência (210210) — recomendado</option>
                        <option value="confirmacao">Confirmação (210200) — implica concordância</option>
                    </select>
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Lote (max 500)</label>
                    <input
                        type="number" min={1} max={500}
                        value={limit}
                        onChange={(e) => setLimit(Math.min(500, Math.max(1, parseInt(e.target.value) || 100)))}
                        className="w-20 px-2 py-1 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded"
                    />
                </div>
                <button
                    onClick={() => handleRun(true)}
                    disabled={rodando}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 rounded"
                    title="Lista quantos seriam manifestados, sem enviar à SEFAZ"
                >
                    👀 Dry-run (preview)
                </button>
                <button
                    onClick={() => handleRun(false)}
                    disabled={rodando}
                    className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded"
                >
                    {rodando ? '⏳ Manifestando…' : `📨 Manifestar até ${limit} pendentes`}
                </button>
            </div>

            {resultado && (
                <div className={`mt-2 p-3 rounded border text-xs ${
                    resultado.erro
                        ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-300'
                }`}>
                    {resultado.erro ? (
                        <span><strong>Erro:</strong> {resultado.erro}</span>
                    ) : (
                        <div className="space-y-1">
                            <div className="font-semibold">
                                {resultado.dryRun ? '[DRY-RUN] ' : ''}
                                Total: {resultado.total ?? 0} ·
                                Sucessos: <strong>{resultado.sucessos ?? 0}</strong> ·
                                Falhas: <strong className={resultado.falhas ? 'text-red-700 dark:text-red-400' : ''}>{resultado.falhas ?? 0}</strong> ·
                                Puladas: {resultado.puladas ?? 0}
                            </div>
                            {resultado.detalhes && resultado.detalhes.length > 0 && (
                                <details className="text-[11px]">
                                    <summary className="cursor-pointer hover:underline">Ver detalhes ({resultado.detalhes.length})</summary>
                                    <div className="mt-1 max-h-[200px] overflow-y-auto space-y-1 font-mono">
                                        {resultado.detalhes.map((d, i) => (
                                            <div key={i} className="flex gap-2">
                                                <span className={d.status === 'ok' ? 'text-emerald-700' : 'text-red-600'}>{d.status}</span>
                                                <span className="text-slate-500">{d.chave?.slice(0, 12)}…</span>
                                                <span className="text-slate-700 dark:text-slate-300">{d.motivo || ''}</span>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            )}
                            {(resultado.total || 0) >= limit && (
                                <div className="text-amber-700 dark:text-amber-400 text-[11px]">
                                    ⚠ Lote completo — pode haver mais pendentes. Clica de novo pra processar o próximo batch.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default CapturaDiagnosticoPanel;
