/**
 * SefazSyncButton.tsx — Botão "Sincronizar SEFAZ" por empresa.
 */

import React, { useEffect, useState } from 'react';
import {
    captureFromSefaz, getSefazState, getSefazWindow,
    type SefazState, type SefazWindow,
} from '../services/dfeCaptureService';
import type { EmpresaXmlOption } from '../services/xmlFiscalService';
import type { User } from '../types';

interface Props {
    empresa: EmpresaXmlOption;
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
    const [window, setWindow] = useState<SefazWindow | null>(null);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<{ tipo: 'sucesso' | 'erro' | 'aviso'; texto: string } | null>(null);

    const loadInfo = async () => {
        const [s, w] = await Promise.all([getSefazState(empresa.cnpj), getSefazWindow()]);
        setState(s);
        setWindow(w);
    };

    useEffect(() => { loadInfo(); }, [empresa.cnpj]);

    const handleSync = async () => {
        setRunning(true);
        setResult(null);
        try {
            const r = await captureFromSefaz({
                empresa: { id: empresa.id, cnpj: empresa.cnpj, nome: empresa.nome } as any,
                user: currentUser,
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

    const dentroDeJanela = window?.dentro ?? true;
    const lockAtivo = state?.lock?.ativo;
    const desabilitado = running || !dentroDeJanela || lockAtivo;
    const ultimaSync = state?.state?.ultimaSync;
    const ultNSU = state?.state?.ultNSU;
    const tooltip = !dentroDeJanela ? window?.motivo : (lockAtivo ? 'Sincronizado recentemente.' : '');
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
                    onClick={handleSync}
                    disabled={desabilitado}
                    title={tooltip}
                    className={`text-xs font-medium px-3 py-1 rounded transition ${
                        desabilitado
                            ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                            : 'bg-emerald-500 hover:bg-emerald-400 text-slate-900'
                    }`}
                >
                    {running ? '⏳ Sincronizando...' : '↓ Sincronizar SEFAZ'}
                </button>
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
        </div>
    );
};

export default SefazSyncButton;
