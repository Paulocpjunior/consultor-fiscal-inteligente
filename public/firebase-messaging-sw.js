/* ============================================================================
 * Service worker do PUSH do SP Connect (Firebase Cloud Messaging).
 * ----------------------------------------------------------------------------
 * É ele que mostra a notificação quando o app está FECHADO — o caso que o
 * som e o pop-up da aba não cobrem, e o que a Ultra Fox faz hoje no celular.
 *
 * A config do Firebase chega por QUERY STRING no registro (o SW roda fora do
 * bundle e não enxerga as VITE_*). São chaves PÚBLICAS por design (a mesma
 * config que vai no HTML do app) — o que protege o dado são as rules, não o
 * segredo da config.
 * ========================================================================== */
/* global importScripts, firebase, clients */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const params = new URL(self.location.href).searchParams;
const cfg = {
    apiKey: params.get('apiKey'),
    authDomain: params.get('authDomain'),
    projectId: params.get('projectId'),
    messagingSenderId: params.get('messagingSenderId'),
    appId: params.get('appId'),
};

if (cfg.projectId && cfg.messagingSenderId) {
    firebase.initializeApp(cfg);
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
        const n = payload.notification || {};
        const d = payload.data || {};
        self.registration.showNotification(n.title || '💬 SP Connect', {
            body: n.body || 'Nova mensagem',
            icon: '/connect-icon-192.png',
            badge: '/connect-icon-192.png',
            // Mesma conversa ATUALIZA o aviso em vez de empilhar 5 na barra.
            tag: d.tag || 'spconnect',
            data: { link: d.link || '/connect' },
        });
    });
}

// Clicar no aviso abre a CONVERSA — e reaproveita a aba já aberta em vez de
// abrir uma nova a cada clique.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const destino = (event.notification.data && event.notification.data.link) || '/connect';
    event.waitUntil((async () => {
        const abas = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const aba of abas) {
            if (aba.url.includes('/connect')) {
                await aba.focus();
                if ('navigate' in aba) await aba.navigate(destino);
                return;
            }
        }
        await clients.openWindow(destino);
    })());
});
