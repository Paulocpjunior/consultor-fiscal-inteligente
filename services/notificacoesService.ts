/**
 * notificacoesService — cliente HTTP para o backend /api/admin/notificacoes.
 * Expõe o teste de e-mail via Microsoft Graph e notificações push no browser.
 *
 * Browser Notifications:
 *  - requestNotificationPermission() — pede permissão ao usuário (chamado no login)
 *  - sendBrowserNotification()       — envia notificação nativa (precisa HTTPS)
 *  - notifyCapturaSefaz()            — notifica captura automática SEFAZ
 *  - notifyCaixaPostalCritica()      — notifica pendências críticas na Caixa Postal
 */
import { getAuth } from 'firebase/auth';

const BASE = '/api/admin/notificacoes';

async function authHeaders(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Usuário não autenticado');
    const token = await u.getIdToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

// ─── Browser Push Notifications ──────────────────────────────────────────────

/** Pede permissão para notificações no browser. Não bloqueia — retorna false se indisponível. */
export async function requestNotificationPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const result = await Notification.requestPermission();
    return result === 'granted';
}

/** Envia uma notificação nativa do browser (requer HTTPS e permissão concedida). */
export function sendBrowserNotification(title: string, body: string, options?: {
    icon?: string;
    tag?: string;
    onClick?: () => void;
}) {
    if (Notification.permission !== 'granted') return;
    const notif = new Notification(title, {
        body,
        icon: options?.icon || '/favicon.ico',
        tag: options?.tag,
        badge: '/favicon.ico',
    });
    if (options?.onClick) {
        notif.onclick = () => {
            window.focus();
            options.onClick!();
            notif.close();
        };
    }
}

/** Chamado pelo CronCapturaBanner quando uma nova captura SEFAZ é detectada. */
export function notifyCapturaSefaz(novosXmls: number, falhas: number, empresas: number) {
    if (novosXmls === 0 && falhas === 0) return;
    const title = falhas > 0 ? 'Captura SEFAZ com falhas' : 'Captura SEFAZ concluída';
    const body = `${novosXmls} novos XMLs em ${empresas} empresas${falhas > 0 ? `, ${falhas} falha(s)` : ''}`;
    sendBrowserNotification(title, body, { tag: 'sefaz-capture' });
}

/** Chamado pelo AlertaPopup quando há pendências críticas na Caixa Postal. */
export function notifyCaixaPostalCritica(count: number) {
    if (count === 0) return;
    sendBrowserNotification(
        'Pendências críticas na Caixa Postal',
        `${count} mensagem(ns) crítica(s) aguardando atenção`,
        { tag: 'caixa-postal-critica' }
    );
}

// ─── E-mail / Backend ────────────────────────────────────────────────────────

/** Dispara um e-mail de teste. Sem remetente/para, o backend usa o e-mail do admin logado. */
export async function testarEmailGraph(): Promise<{ ok: boolean; error?: string; para?: string }> {
    try {
        const res = await fetch(`${BASE}/teste-email`, {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
            return { ok: true, para: data.para };
        }
        return { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (err: any) {
        return { ok: false, error: err?.message || 'Falha na chamada' };
    }
}

/** Dispara o resumo diário de capturas (coleta + envia e-mail). Backend usa o e-mail do admin logado. */
export async function testarResumoDiario(): Promise<{ ok: boolean; error?: string; resumo?: any }> {
    try {
        const res = await fetch(`${BASE}/teste-resumo`, {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
            return { ok: true, resumo: data.resumo };
        }
        return { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (err: any) {
        return { ok: false, error: err?.message || 'Falha na chamada' };
    }
}
