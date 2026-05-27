/**
 * CronCapturaBanner — banner sempre visivel no topo mostrando o status
 * da ultima execucao do cron SEFAZ (captura automatica de XMLs).
 *
 * Comportamento:
 *  - Busca GET /api/admin/sefaz/cron-status no mount
 *  - Exibe apenas se a ultima execucao foi nas ultimas 24h
 *  - Dispensavel com X (persiste no sessionStorage, reaparece na proxima sessao)
 */
import React, { useEffect, useState } from 'react';
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
}

const DISMISS_KEY = 'cronCapturaBanner:dismissed';

function parseTimestamp(ts: CronStatus['executadoEm']): Date | null {
    if (!ts) return null;
    if (typeof ts === 'string') return new Date(ts);
    if (typeof ts === 'object' && '_seconds' in ts) return new Date(ts._seconds * 1000);
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

const CronCapturaBanner: React.FC<Props> = ({ currentUser }) => {
    const [status, setStatus] = useState<CronStatus | null>(null);
    const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');

    useEffect(() => {
        if (!currentUser || dismissed) return;
        let cancelled = false;

        (async () => {
            try {
                const user = getAuth().currentUser;
                if (!user) return;
                const token = await user.getIdToken();
                const res = await fetch('/api/admin/sefaz/cron-status', {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) return;
                const data: CronStatus = await res.json();
                if (!cancelled) setStatus(data);
            } catch {
                // silently ignore — banner is non-critical
            }
        })();

        return () => { cancelled = true; };
    }, [currentUser, dismissed]);

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
        <div style={styles.container(accentColor, bgColor, borderColor)}>
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
