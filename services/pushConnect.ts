// ============================================================================
// services/pushConnect.ts — push do celular (FCM) no SP Connect
// ----------------------------------------------------------------------------
// Camada 3 do aviso: a que funciona com o app FECHADO (o que o som e o
// pop-up da aba não cobrem, e o que a Ultra Fox faz hoje no celular).
//
// O QUE FALTA PRA LIGAR: a chave **Web Push (VAPID)** do projeto Firebase —
// Console → Configurações do projeto → Cloud Messaging → "Certificados push
// da Web" → Gerar par de chaves, e colar em `VITE_FIREBASE_VAPID_KEY`.
// Sem ela o app NÃO finge: diz que o push está pendente dessa chave (som e
// pop-up seguem funcionando).
// ============================================================================
import { getAuth } from 'firebase/auth';
import app from './firebaseConfig';

export type EstadoPush =
    | { pronto: false; motivo: string; acao?: string }
    | { pronto: true; token: string; dispositivos: number };

const VAPID = (import.meta as any).env?.VITE_FIREBASE_VAPID_KEY as string | undefined;

/** O push está configurado? (a resposta é honesta, não um "em breve"). */
export function pushConfigurado(): { ok: boolean; motivo?: string; acao?: string } {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
        return { ok: false, motivo: 'Este navegador não suporta push.', acao: 'O som e o pop-up continuam funcionando com o app aberto.' };
    }
    if (!VAPID) {
        return {
            ok: false,
            motivo: 'O push no celular ainda não foi configurado (falta a chave Web Push do Firebase).',
            acao: 'Admin: Firebase Console → Configurações do projeto → Cloud Messaging → Certificados push da Web → gerar o par de chaves e publicar como VITE_FIREBASE_VAPID_KEY.',
        };
    }
    return { ok: true };
}

/**
 * Registra este dispositivo pra receber push. Só chame DEPOIS de a permissão
 * de notificação ter sido concedida — pedir permissão aqui esconderia o
 * gesto do usuário dentro de uma função técnica.
 */
export async function registrarDispositivo(): Promise<EstadoPush> {
    const cfg = pushConfigurado();
    if (!cfg.ok) return { pronto: false, motivo: cfg.motivo!, acao: cfg.acao };
    try {
        const { getMessaging, getToken } = await import('firebase/messaging');
        // A config viaja na URL do SW: ele roda fora do bundle e não enxerga
        // as VITE_*. São chaves públicas por design.
        // A config sai do app JÁ inicializado — segunda cópia dela
        // divergiria no dia em que o projeto mudasse.
        const o = app.options as Record<string, string | undefined>;
        const q = new URLSearchParams({
            apiKey: o.apiKey || '', authDomain: o.authDomain || '',
            projectId: o.projectId || '', messagingSenderId: o.messagingSenderId || '',
            appId: o.appId || '',
        }).toString();
        const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${q}`);
        const token = await getToken(getMessaging(app), { vapidKey: VAPID, serviceWorkerRegistration: registration });
        if (!token) return { pronto: false, motivo: 'O navegador não devolveu o token de push.', acao: 'Confira se as notificações estão permitidas e recarregue.' };

        const u = getAuth().currentUser;
        if (!u) return { pronto: false, motivo: 'Sessão expirada — entre novamente.' };
        const idToken = await u.getIdToken();
        const res = await fetch('/api/admin/whatsapp/push/token', {
            method: 'POST',
            headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { pronto: false, motivo: data.error || `HTTP ${res.status}` };
        return { pronto: true, token, dispositivos: data.dispositivos || 1 };
    } catch (e) {
        return {
            pronto: false,
            motivo: `Não foi possível ligar o push: ${(e as Error).message}`,
            acao: 'O som e o pop-up seguem funcionando com o app aberto.',
        };
    }
}

async function req<T>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' } as any;
    const token = await u.getIdToken();
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` } as any;
    return data;
}

export const lerPrefsPush = () =>
    req<{ prefs: Record<string, boolean>; dispositivos: number }>('/api/admin/whatsapp/push/prefs');

export const salvarPrefsPush = (prefs: Record<string, boolean>) =>
    req<{ prefs: Record<string, boolean> }>('/api/admin/whatsapp/push/prefs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefs }),
    });
