/**
 * NfseSpSessaoCookies.tsx
 *
 * Admin cola cookies do portal SP (DevTools → Application → Cookies) pra
 * habilitar o cron noturno baixar CSV de NFs automaticamente das 254 empresas.
 *
 * Strategy: enquanto o login mTLS automático não está resolvido, esse fluxo
 * 30s/dia permite captura noturna real de TODAS as empresas com 1 login do
 * escritório no portal SP.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { getAuth } from 'firebase/auth';
import type { User } from '../types';

interface Props {
    currentUser: User;
}

interface SessionStatus {
    valida: boolean;
    cookiesNomes?: string[];
    atualizadoEm?: string;
    expiraEm?: string;
    motivo?: string;
}

const fmtRelTime = (iso?: string) => {
    if (!iso) return '—';
    try {
        const ms = new Date(iso).getTime();
        const diff = Date.now() - ms;
        if (diff < 0) {
            const h = Math.ceil(-diff / 3600000);
            return `daqui ${h}h`;
        }
        const min = Math.floor(diff / 60000);
        if (min < 1) return 'agora';
        if (min < 60) return `há ${min}min`;
        return `há ${Math.floor(min / 60)}h`;
    } catch {
        return iso;
    }
};

const NfseSpSessaoCookies: React.FC<Props> = ({ currentUser }) => {
    const [status, setStatus] = useState<SessionStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [cookieString, setCookieString] = useState('');
    const [salvando, setSalvando] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const isAdmin = currentUser.role === 'admin';

    const carregar = useCallback(async () => {
        setLoading(true);
        try {
            const token = await getAuth().currentUser?.getIdToken();
            const r = await fetch('/api/admin/sefaz/nfsesp-portal-session', {
                headers: { Authorization: `Bearer ${token}` },
            });
            const d = await r.json();
            setStatus(d);
        } catch (e: any) {
            setStatus({ valida: false, motivo: e.message });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { carregar(); }, [carregar]);

    const salvar = async () => {
        if (!cookieString.trim()) {
            setMsg('Cole os cookies primeiro');
            return;
        }
        setSalvando(true);
        setMsg(null);
        try {
            const token = await getAuth().currentUser?.getIdToken();
            const r = await fetch('/api/admin/sefaz/nfsesp-portal-session', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ cookieString }),
            });
            const d = await r.json();
            if (!r.ok) {
                setMsg(`❌ ${d.erro}`);
            } else {
                setMsg(`✅ Cookies salvos. Expira ${fmtRelTime(d.expiraEm)}. Cron noturno vai usar.`);
                setCookieString('');
                carregar();
            }
        } catch (e: any) {
            setMsg(`❌ ${e.message}`);
        } finally {
            setSalvando(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-4 rounded-lg text-white">
                <h3 className="font-bold">🔐 Cookies do portal SP (sessão temporária)</h3>
                <p className="text-xs text-purple-100 mt-1">
                    Renove ~a cada 2h. Cron noturno usa esses cookies pra baixar NFs de TODAS as empresas autorizadas.
                </p>
            </div>

            {loading && <p className="text-sm text-gray-500">Carregando…</p>}

            {!loading && status && (
                <div className={`p-4 rounded border ${status.valida ? 'bg-green-50 border-green-300' : 'bg-amber-50 border-amber-300'}`}>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">{status.valida ? '✅' : '⚠️'}</span>
                        <span className={`font-bold ${status.valida ? 'text-green-800' : 'text-amber-900'}`}>
                            {status.valida ? 'Sessão válida' : 'Sessão expirada/ausente'}
                        </span>
                    </div>
                    {status.valida ? (
                        <div className="text-sm space-y-1 text-green-900">
                            <div>Cookies salvos: <code className="text-xs">{status.cookiesNomes?.join(', ')}</code></div>
                            <div>Atualizado: {fmtRelTime(status.atualizadoEm)}</div>
                            <div>Expira: <strong>{fmtRelTime(status.expiraEm)}</strong></div>
                        </div>
                    ) : (
                        <p className="text-sm font-medium text-amber-900">{status.motivo}</p>
                    )}
                </div>
            )}

            {isAdmin && (
                <div className="border rounded p-4 space-y-3">
                    <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900">
                        <strong>📋 Como capturar os cookies (30 segundos):</strong>
                        <ol className="list-decimal list-inside mt-2 space-y-1">
                            <li>Abre aba anônima → cola <code>https://nfe.prefeitura.sp.gov.br</code></li>
                            <li>Login com certificado digital S&P</li>
                            <li>DevTools (Cmd+Option+I) → aba <strong>Armazenamento → Cookies → nfe.prefeitura.sp.gov.br</strong></li>
                            <li>Copia o valor de <strong>3 cookies</strong>: <code>PMSP_NFeID</code>, <code>PMSP_NFE_CPFCNPJ</code>, <code>ASP.NET_SessionId</code></li>
                            <li>Cola abaixo no formato: <code>PMSP_NFeID=...; PMSP_NFE_CPFCNPJ=...; ASP.NET_SessionId=...</code></li>
                        </ol>
                        <p className="mt-2 italic">Atalho: no Safari, clique direito em qualquer request → "Copiar" → "Copiar valor de cookies da request"</p>
                    </div>

                    <label className="text-sm font-semibold block">Cookies (string completa):</label>
                    <textarea
                        value={cookieString}
                        onChange={(e) => setCookieString(e.target.value)}
                        placeholder="PMSP_NFeID=ABC123...; PMSP_NFE_CPFCNPJ=44388152000189; ASP.NET_SessionId=xyz..."
                        className="w-full h-32 p-2 text-xs font-mono border border-slate-300 rounded bg-white text-slate-900 placeholder-slate-400"
                    />

                    <button
                        onClick={salvar}
                        disabled={salvando || !cookieString.trim()}
                        className="px-4 py-2 bg-purple-600 text-white rounded font-semibold hover:bg-purple-700 disabled:opacity-50"
                    >
                        {salvando ? '⏳ Salvando…' : '💾 Salvar e Ativar Cron'}
                    </button>
                    {msg && <p className="text-sm">{msg}</p>}
                </div>
            )}

            {!isAdmin && (
                <p className="text-xs text-gray-500">Apenas administradores podem alterar a sessão.</p>
            )}
        </div>
    );
};

export default NfseSpSessaoCookies;
