import { useEffect, useRef, useState, useCallback } from 'react';
import { APP_RELEASE, APP_VERSION } from '../version';

export interface RemoteVersion {
    version: string;
    release: string;
    buildTime: string;
}

export interface VersionCheckState {
    updateAvailable: boolean;
    latest: RemoteVersion | null;
    current: { version: string; release: string };
    lastCheckedAt: Date | null;
    checkNow: () => Promise<void>;
    applyUpdate: () => Promise<void>;
    dismiss: () => void;
}

const VERSION_URL = '/version.json';
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DISMISS_KEY = 'sp:version:dismissed-release';

const fetchRemoteVersion = async (): Promise<RemoteVersion | null> => {
    try {
        // Cache-bust para garantir leitura fresca da versão deployada.
        const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as RemoteVersion;
        if (!data || typeof data.release !== 'string') return null;
        return data;
    } catch {
        return null;
    }
};

const purgeCachesAndReload = async (): Promise<void> => {
    try {
        if (typeof caches !== 'undefined') {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
        }
        if (navigator.serviceWorker?.getRegistrations) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister()));
        }
    } catch {
        // segue para reload mesmo se falhar
    }
    // Append cache-buster para forçar revalidação do HTML mesmo em proxies/CDN.
    const url = new URL(window.location.href);
    url.searchParams.set('_v', String(Date.now()));
    window.location.replace(url.toString());
};

export const useVersionCheck = (intervalMs: number = DEFAULT_INTERVAL_MS): VersionCheckState => {
    const [latest, setLatest] = useState<RemoteVersion | null>(null);
    const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
    const [dismissedRelease, setDismissedRelease] = useState<string | null>(() => {
        try {
            return localStorage.getItem(DISMISS_KEY);
        } catch {
            return null;
        }
    });
    const inFlight = useRef(false);

    const current = { version: APP_VERSION, release: APP_RELEASE };

    const checkNow = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        try {
            const remote = await fetchRemoteVersion();
            if (remote) {
                setLatest(remote);
                setLastCheckedAt(new Date());
            }
        } finally {
            inFlight.current = false;
        }
    }, []);

    const applyUpdate = useCallback(async () => {
        await purgeCachesAndReload();
    }, []);

    const dismiss = useCallback(() => {
        if (!latest) return;
        try {
            localStorage.setItem(DISMISS_KEY, latest.release);
        } catch {
            // ignore
        }
        setDismissedRelease(latest.release);
    }, [latest]);

    useEffect(() => {
        checkNow();
        const id = window.setInterval(checkNow, intervalMs);
        const onFocus = () => checkNow();
        window.addEventListener('focus', onFocus);
        return () => {
            window.clearInterval(id);
            window.removeEventListener('focus', onFocus);
        };
    }, [checkNow, intervalMs]);

    const updateAvailable =
        !!latest &&
        latest.release !== current.release &&
        latest.release !== dismissedRelease;

    return {
        updateAvailable,
        latest,
        current,
        lastCheckedAt,
        checkNow,
        applyUpdate,
        dismiss,
    };
};
