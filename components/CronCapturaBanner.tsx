/**
 * CronCapturaBanner — banner sempre visivel no topo mostrando o status
 * da ultima execucao do cron SEFAZ (captura automatica de XMLs).
 *
 * Comportamento:
 *  - Busca GET /api/admin/sefaz/cron-status no mount
 *  - Exibe apenas se a ultima execucao foi nas ultimas 24h
 *  - Dispensavel com X (persiste no sessionStorage, reaparece na proxima sessao)
 *  - Polling a cada 5 min para detectar novas execucoes (6h/12h/18h)
 *  - Mostra toast e flash visual quando nova captura e detectada
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { User } from '../types';
import { getAuth } from 'firebase/auth';

interface CronStatus {
    hasRun: boolean;
    executadoEm?: { _seconds: number; _nanoseconds?: number } | string;
    totalEmpresas?: number;
    sucessos?: number;
    falhas?: number;
    totalNovosXmls?: number;
    duracaoMs?: number;
    fonte?: string;
    erro?: string;
}

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const DISMISS_KEY = 'cronCapturaBanner:dismissed';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function parseTimestamp(ts: CronStatus['executadoEm']): Date | null {
    if (!ts) return null;
    if (typeof ts === 'string') return new Date(ts);
    if (typeof ts === 'object' && '_seconds' in ts) return new Date(ts._seconds * 1000);
    return null;
}

/** Extracts a raw comparable value (epoch ms) from the executadoEm field */
function getTimestampMs(ts: CronStatus['executadoEm']): number | null {
    if (!ts) return null;
    if (typeof ts === 'string') return new Date(ts).getTime();
    if (typeof ts === 'object' && '_seconds' in ts) return ts._seconds * 1000;
    return null;
}

function formatBRT(date: Date): string {
    return date.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
    });
}

function formatTimeBRT(date: Date): string {
    return date.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
    });
}

const CronCapturaBanner: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [status, setStatus] = useState<CronStatus | null>(null);
    const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');
    const [flash, setFlash] = useState(false);
    const lastExecutadoEmRef = useRef<number | null>(null);
    const initialFetchDone = useRef(false);

    /** Fetch cron status from API */
    const fetchCronStatus = useCallback(async (): Promise<CronStatus | null> => {
        try {
            const user = getAuth().currentUser;
            if (!user) return null;
            const token = await user.getIdToken();
            const res = await fetch('/api/admin/sefaz/cron-status', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }, []);

    // Initial fetch on mount
    useEffect(() => {
        if (!currentUser) return;
        let cancelled = false;

        (async () => {
            const data = await fetchCronStatus();
            if (cancelled || !data) return;
            setStatus(data);
            const tsMs = getTimestampMs(data.executadoEm);
            lastExecutadoEmRef.current = tsMs;
            initialFetchDone.current = true;
        })();

        return () => { cancelled = true; };
    }, [currentUser, fetchCronStatus]);

    // Polling every 5 minutes to detect new cron runs
    useEffect(() => {
        if (!currentUser) return;

        const poll = async () => {
            // Don't poll if the tab is hidden
            if (document.visibilityState !== 'visible') return;

            const newData = await fetchCronStatus();
            if (!newData) return;

            const newTsMs = getTimestampMs(newData.executadoEm);

            // Detect new cron execution
            if (
                initialFetchDone.current &&
                newTsMs !== null &&
                lastExecutadoEmRef.current !== null &&
                newTsMs !== lastExecutadoEmRef.current
            ) {
                // New cron result detected!
                setStatus(newData);
                setDismissed(false);
                sessionStorage.removeItem(DISMISS_KEY);

                // Flash animation
                setFlash(true);
                setTimeout(() => setFlash(false), 2000);

                // Show toast notification
                if (onShowToast && newData.hasRun) {
                    const execDate = parseTimestamp(newData.executadoEm);
                    const hora = execDate ? formatTimeBRT(execDate) : '';
                    const msg = (newData.falhas ?? 0) > 0
                        ? `Captura SEFAZ ${hora}: ${newData.totalNovosXmls ?? 0} novos XMLs, ${newData.falhas} falha(s)`
                        : `Captura SEFAZ ${hora}: ${newData.totalNovosXmls ?? 0} novos XMLs em ${newData.totalEmpresas ?? 0} empresas`;
                    onShowToast(msg);
                }
            } else if (newData) {
                // No new cron, but update data silently in case other fields changed
                setStatus(newData);
            }

            if (newTsMs !== null) {
                lastExecutadoEmRef.current = newTsMs;
            }
        };

        const interval = setInterval(poll, POLL_INTERVAL_MS);

        // Also poll when tab becomes visible again (user might have been away)
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                poll();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [currentUser, fetchCronStatus, onShowToast]);

    if (dismissed || !status) return null;

    // Se nunca executou
    if (!status.hasRun) {
        return (
            <div style={styles.container('#94A3B8', 'rgba(148,163,184,0.08)', 'rgba(148,163,184,0.25)')}>
                <span style={styles.text}>
                    Captura SEFAZ automatica ainda nao executou
                </span>
                <button onClick={dismiss} style={styles.closeBtn} aria-label="Dispensar">
                    &times;
                </button>
            </div>
        );
    }

    const execDate = parseTimestamp(status.executadoEm);
    if (!execDate) return null;

    // So mostra se executou nas ultimas 24h
    const diffMs = Date.now() - execDate.getTime();
    if (diffMs > 24 * 60 * 60 * 1000) return null;

    const hasFalhas = (status.falhas ?? 0) > 0;
    const hasErro = !!status.erro;

    // Cores: verde = ok, amber = com falhas ou erro
    const accentColor = (hasFalhas || hasErro) ? 'var(--warning)' : 'var(--success)';
    const bgColor = (hasFalhas || hasErro) ? 'var(--warning-soft)' : 'rgba(5,150,105,0.08)';
    const borderColor = (hasFalhas || hasErro) ? 'var(--warning-soft-border)' : 'rgba(5,150,105,0.25)';

    const timeStr = formatBRT(execDate);

    let message: string;
    if (hasErro) {
        message = `Captura SEFAZ falhou as ${timeStr} — ${status.erro}`;
    } else {
        message = `Captura SEFAZ concluida as ${timeStr} — ${status.totalEmpresas ?? 0} empresa(s), ${status.totalNovosXmls ?? 0} novos XMLs, ${status.falhas ?? 0} falha(s)`;
    }

    return (
        <div
            style={styles.container(accentColor, bgColor, borderColor)}
            className={flash ? 'cron-banner-flash' : ''}
        >
            <style>{`
                @keyframes cronBannerFlash {
                    0% { opacity: 1; transform: scale(1); }
                    15% { opacity: 0.7; transform: scale(1.01); }
                    30% { opacity: 1; transform: scale(1); }
                    45% { opacity: 0.7; transform: scale(1.01); }
                    60% { opacity: 1; transform: scale(1); }
                    100% { opacity: 1; transform: scale(1); }
                }
                .cron-banner-flash {
                    animation: cronBannerFlash 1.5s ease-in-out;
                }
            `}</style>
            <span style={styles.dot(accentColor)} />
            <span style={styles.text}>{message}</span>
            <button onClick={dismiss} style={styles.closeBtn} aria-label="Dispensar">
                &times;
            </button>
        </div>
    );

    function dismiss() {
        sessionStorage.setItem(DISMISS_KEY, '1');
        setDismissed(true);
    }
};

const styles = {
    container: (accent: string, bg: string, border: string): React.CSSProperties => ({
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px',
        marginBottom: 8,
        borderRadius: 8,
        border: `1px solid ${border}`,
        background: bg,
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
        lineHeight: 1.4,
    }),
    dot: (color: string): React.CSSProperties => ({
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
    }),
    text: {
        flex: 1,
    } as React.CSSProperties,
    closeBtn: {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: '1.1rem',
        color: 'var(--text-muted)',
        padding: '0 4px',
        lineHeight: 1,
        opacity: 0.7,
        flexShrink: 0,
    } as React.CSSProperties,
};

export default CronCapturaBanner;
