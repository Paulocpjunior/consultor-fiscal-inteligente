/**
 * SefazSyncButton.tsx — botão Sincronizar + (admin) toggle de captura automática
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    captureFromSefaz, captureCteFromSefaz, getSefazState, getSefazWindow, toggleSefazCapture,
    type SefazState, type SefazWindow,
} from '../services/dfeCaptureService';
import type { EmpresaXmlOption } from '../services/xmlFiscalService';
import type { User } from '../types';

interface Props {
    empresa: EmpresaXmlOption & { capturarSefaz?: boolean };
    currentUser: User;
    onSyncComplete?: () => void;
}

const formatRelativeBR = (ts: any): string => {
    if (!ts) return '—';
    const ms = ts._seconds ? ts._seconds * 1000 : (typeof ts === 'string' ? new Date(ts).getTime() : ts);
    if (!ms || Number.isNaN(ms)) return '—';
    const diffMin = Math.floor((Date.now() - ms) / 60000);
    if (diffMin < 1) return 'agora';
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `há ${diffH}h`;
    return `há ${Math.floor(diffH / 24)}d`;
};

const SefazSyncButton: React.FC<Props> = ({ empresa, currentUser, onSyncComplete }) => {
    const [state, setState] = useState<SefazState | null>(null);
    const [windowInfo, setWindowInfo] = useState<SefazWindow | null>(null);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<{ tipo: 'sucesso' | 'erro' | 'aviso'; texto: string } | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [ativoAtual, setAtivoAtual] = useState<boolean>(empresa.capturarSefaz !== false);
    const [savingToggle, setSavingToggle] = useState(false);
    const [toggleErr, setToggleErr] = useState<string | null>(null);
    // CT-e (18/08) — prova de conceito: o webservice CTeDistribuicaoDFe nunca
    // foi chamado deste app, e a rede da SEFAZ é bloqueada do ambiente de
    // desenvolvimento. Este botão é a ÚNICA forma de provar em produção antes
    // de entrar no cron noturno — por isso admin-only e resultado próprio,
    // nunca misturado com `result` (que é do NF-e).
    const [runningCte, setRunningCte] = useState(false);
    const [resultCte, setResultCte] = useState<{ tipo: 'sucesso' | 'erro' | 'aviso'; texto: string } | null>(null);

    const handleSyncCte = async () => {
        setRunningCte(true);
        setResultCte(null);
        try {
            const r = await captureCteFromSefaz({
                empresa: { id: empresa.id, cnpj: empresa.cnpj, nome: empresa.nome } as any,
                user: currentUser,
            });
            if (r.sucesso) {
                setResultCte({ tipo: 'sucesso', texto: r.motivo });
            } else if (r.rateLimited) {
                setResultCte({ tipo: 'erro', texto: 'SEFAZ pediu para aguardar 1h (cStat 656).' });
            } else {
                setResultCte({ tipo: 'erro', texto: r.motivo });
            }
        } catch (e: any) {
            setResultCte({ tipo: 'erro', texto: e.message || 'Erro inesperado' });
        } finally {
            setRunningCte(false);
        }
    };

    const isAdmin = currentUser.role === 'admin';

    const loadInfo = async () => {
        const [s, w] = await Promise.all([getSefazState(empresa.cnpj), getSefazWindow()]);
        setState(s);
        setWindowInfo(w);
    };

    useEffect(() => { loadInfo(); }, [empresa.cnpj]);
    useEffect(() => { setAtivoAtual(empresa.capturarSefaz !== false); }, [empresa.capturarSefaz]);

    const handleSync = async (resetNSU = false) => {
        if (resetNSU && !confirm(
            `Recapturar ${empresa.nome} do início da janela SEFAZ?\n\n`
            + `Isso zera o cursor NSU e re-solicita ~90 dias de DF-e (ENTRADA + eventos).\n\n`
            + `⚠ Use no MÁXIMO 1x e só após ajuste de certificado. Repetir o "90d" é o que dispara `
            + `o cStat 656 (Consumo Indevido) — e aí esperar 1h não resolve, porque cada reset re-arma o bloqueio. `
            + `Há um cooldown de 3h por empresa.\n\n`
            + `A SAÍDA própria (mod 55) NÃO vem por este canal (Rejeição 641) — para saída use o cofre de e-mail.`,
        )) return;
        setRunning(true);
        setResult(null);
        try {
            const r = await captureFromSefaz({
                empresa: { id: empresa.id, cnpj: empresa.cnpj, nome: empresa.nome } as any,
                user: currentUser,
                resetNSU,
            });
            if (r.sucesso) {
                const novos = r.novosXmls || 0;
                setResult(novos > 0
                    ? { tipo: 'sucesso', texto: `${novos} nova${novos > 1 ? 's' : ''} NF-e capturada${novos > 1 ? 's' : ''}` }
                    : { tipo: 'sucesso', texto: 'Sem novos documentos na SEFAZ' });
                onSyncComplete?.();
            } else if (r.foraDeJanela) {
                setResult({ tipo: 'aviso', texto: r.motivo });
            } else if (r.rateLimited) {
                setResult({ tipo: 'erro', texto: 'SEFAZ pediu para aguardar 1h (cStat 656).' });
            } else {
                setResult({ tipo: 'erro', texto: r.motivo });
            }
            await loadInfo();
        } catch (e: any) {
            setResult({ tipo: 'erro', texto: e.message || 'Erro inesperado' });
        } finally {
            setRunning(false);
        }
    };

    const handleToggle = async (novoAtivo: boolean) => {
        setSavingToggle(true);
        setToggleErr(null);
        try {
            const r = await toggleSefazCapture(empresa.cnpj, novoAtivo);
            if (r.ok) {
                setAtivoAtual(novoAtivo);
                setShowSettings(false);
                onSyncComplete?.();
            } else {
                setToggleErr(r.motivo || 'Falha ao salvar');
            }
        } finally {
            setSavingToggle(false);
        }
    };

    const dentroDeJanela = windowInfo?.dentro ?? true;
    const lockAtivo = state?.lock?.ativo;
    const desabilitadoBotao = running || !dentroDeJanela || lockAtivo || !ativoAtual;
    const desabilitadoRecaptura = running || !dentroDeJanela || !ativoAtual;
    const ultimaSync = state?.state?.ultimaSync;
    const ultNSU = state?.state?.ultNSU;
    const tooltip = !ativoAtual ? 'Captura desativada pelo admin'
        : !dentroDeJanela ? windowInfo?.motivo
        : (lockAtivo ? 'Sincronizado recentemente.' : '');
    const corResultado = result?.tipo === 'sucesso'
        ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
        : result?.tipo === 'aviso'
        ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
        : 'text-red-300 bg-red-500/10 border-red-500/30';

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => handleSync(false)}
                    disabled={desabilitadoBotao}
                    title={tooltip}
                    className={`text-xs font-medium px-3 py-1 rounded transition ${
                        desabilitadoBotao
                            ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                            : 'bg-emerald-500 hover:bg-emerald-400 text-slate-900'
                    }`}
                >
                    {running ? '⏳ Sincronizando...' : ativoAtual ? '↓ Sincronizar SEFAZ' : '⛔ Desativada'}
                </button>
                {isAdmin && ativoAtual && (
                    <button
                        type="button"
                        onClick={() => handleSync(true)}
                        disabled={desabilitadoRecaptura}
                        title="Admin: zera NSU e recaptura os DF-e disponíveis dos últimos ~90 dias"
                        className={`text-xs font-medium px-2 py-1 rounded transition ${
                            desabilitadoRecaptura
                                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                : 'bg-amber-500 hover:bg-amber-400 text-slate-900'
                        }`}
                    >
                        ⟲ 90d
                    </button>
                )}
                {isAdmin && (
                    <button
                        type="button"
                        onClick={() => setShowSettings(true)}
                        title="Configurar captura automática (admin)"
                        className="text-xs px-2 py-1 rounded text-slate-400 hover:text-white hover:bg-slate-700"
                    >
                        ⚙️
                    </button>
                )}
                {isAdmin && (
                    <button
                        type="button"
                        onClick={handleSyncCte}
                        disabled={runningCte}
                        title="🚧 Prova de conceito (18/08): busca CT-e desta empresa como TOMADORA. Nunca testado contra a SEFAZ real."
                        className={`text-xs font-medium px-2 py-1 rounded transition ${
                            runningCte
                                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                : 'bg-sky-600 hover:bg-sky-500 text-white'
                        }`}
                    >
                        {runningCte ? '⏳…' : '🚚 CT-e (beta)'}
                    </button>
                )}
                {ultimaSync && (
                    <span className="text-xs text-slate-400">
                        Última: {formatRelativeBR(ultimaSync)}
                        {ultNSU && ultNSU !== '0' && <span className="ml-1 text-slate-500">· NSU {ultNSU}</span>}
                    </span>
                )}
            </div>
            {result && (
                <div className={`text-xs border rounded px-2 py-1 ${corResultado}`}>{result.texto}</div>
            )}
            {resultCte && (
                <div className={`text-xs border rounded px-2 py-1 ${
                    resultCte.tipo === 'sucesso'
                        ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
                        : 'text-red-300 bg-red-500/10 border-red-500/30'
                }`}>
                    CT-e: {resultCte.texto}
                </div>
            )}

            {showSettings && createPortal(
                <div
                    className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto"
                    onClick={() => !savingToggle && setShowSettings(false)}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl my-auto"
                    >
                        <h3 className="text-base font-semibold text-white mb-1">Captura automática SEFAZ</h3>
                        <p className="text-xs text-slate-400 mb-4">
                            Empresa: <span className="text-slate-200 font-medium">{empresa.nome}</span><br />
                            CNPJ: <span className="text-slate-200 font-mono">{empresa.cnpj}</span>
                        </p>

                        <div className="space-y-3 mb-5">
                            <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition ${
                                ativoAtual ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-slate-700 hover:border-slate-600'
                            }`}>
                                <input
                                    type="radio"
                                    name="toggle"
                                    checked={ativoAtual}
                                    onChange={() => handleToggle(true)}
                                    disabled={savingToggle}
                                    className="mt-1"
                                />
                                <div>
                                    <div className="text-sm font-medium text-white">Ativada (padrão)</div>
                                    <div className="text-xs text-slate-400 mt-0.5">
                                        Empresa será incluída no cron noturno (02:00 BRT seg-sex) e botão manual fica habilitado.
                                    </div>
                                </div>
                            </label>

                            <label className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition ${
                                !ativoAtual ? 'border-amber-500/50 bg-amber-500/5' : 'border-slate-700 hover:border-slate-600'
                            }`}>
                                <input
                                    type="radio"
                                    name="toggle"
                                    checked={!ativoAtual}
                                    onChange={() => handleToggle(false)}
                                    disabled={savingToggle}
                                    className="mt-1"
                                />
                                <div>
                                    <div className="text-sm font-medium text-white">Desativada</div>
                                    <div className="text-xs text-slate-400 mt-0.5">
                                        Empresa pula no cron noturno e botão manual fica desabilitado. Use quando não há (ou não haverá) procuração e-CAC.
                                    </div>
                                </div>
                            </label>
                        </div>

                        {toggleErr && (
                            <div className="mb-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                                {toggleErr}
                            </div>
                        )}

                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowSettings(false)}
                                disabled={savingToggle}
                                className="text-xs px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-50"
                            >
                                {savingToggle ? 'Salvando...' : 'Fechar'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default SefazSyncButton;
