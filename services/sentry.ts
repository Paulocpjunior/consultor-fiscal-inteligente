/**
 * services/sentry.ts
 *
 * Wrapper isolado em volta do @sentry/react. Centraliza init e captura,
 * pra o resto do app (ErrorBoundary, error handlers) NAO precisar conhecer
 * o SDK diretamente. Trocar de provider = mexer só neste arquivo.
 *
 * Comportamento:
 *  - Sem VITE_SENTRY_DSN: virtualmente todas as funcoes viram NO-OP.
 *    Dev local roda sem precisar de DSN nem rede pra Sentry.
 *  - Com DSN: init com release (__APP_RELEASE__), environment, sem performance
 *    monitoring nem session replay (so erros — economiza quota).
 *
 * Por que assim:
 *  - 74 console.error espalhados em services/components hoje sao invisiveis
 *    em producao. Sem isso, a unica forma de saber que um colaborador caiu
 *    em uma tela com erro era ele reportar. Agora qualquer exception captada
 *    pelo ErrorBoundary ou capturada manualmente chega no Sentry.
 */
import * as Sentry from '@sentry/react';
import { APP_RELEASE } from '../version';

let _initialized = false;

export function initSentry() {
    if (_initialized) return;
    const dsn = import.meta.env.VITE_SENTRY_DSN;
    if (!dsn) {
        // Sem DSN setado — NO-OP. App roda normal, erros viram console.error
        // como antes. Dev local sem Sentry, e build sem secret tambem sao
        // suportados sem precisar setar nada.
        return;
    }
    try {
        Sentry.init({
            dsn,
            release: APP_RELEASE,
            environment: import.meta.env.VITE_SENTRY_ENV
                || (import.meta.env.PROD ? 'production' : 'development'),
            // So erros — sem performance/replay (quota free do Sentry cobre).
            tracesSampleRate: 0,
            replaysSessionSampleRate: 0,
            replaysOnErrorSampleRate: 0,
            // Filtra ruido conhecido. Adicione aqui erros que dao false-positive
            // (ex: extensoes de browser, telemetria de adblock).
            ignoreErrors: [
                // ResizeObserver loop benigno — gerado por chart.js/lucide em layouts dinamicos.
                'ResizeObserver loop limit exceeded',
                'ResizeObserver loop completed with undelivered notifications',
                // Cancelamento de promise quando usuario troca de rota durante fetch.
                'AbortError',
                // Firebase quando offline temporariamente — nao vale reportar.
                'Failed to fetch',
                'NetworkError when attempting to fetch resource',
            ],
            beforeSend(event) {
                // Filtros adicionais: descarta se for de uma extensao browser
                // (chrome-extension://) e nao do nosso bundle.
                const frames = event.exception?.values?.[0]?.stacktrace?.frames || [];
                if (frames.some(f => f.filename?.startsWith('chrome-extension://')
                                  || f.filename?.startsWith('moz-extension://'))) {
                    return null;
                }
                return event;
            },
        });
        _initialized = true;
        // eslint-disable-next-line no-console
        console.log('[sentry] inicializado release=' + APP_RELEASE);
    } catch (e) {
        // Falha ao iniciar Sentry NUNCA deve quebrar o app.
        // eslint-disable-next-line no-console
        console.error('[sentry] falha ao inicializar (seguindo sem):', e);
    }
}

/**
 * Captura uma exception. NO-OP se Sentry nao estiver inicializado.
 */
export function captureException(err: unknown, context?: Record<string, unknown>) {
    if (!_initialized) return;
    try {
        Sentry.captureException(err, context ? { extra: context } : undefined);
    } catch {
        /* swallow */
    }
}

/**
 * Define identidade do usuario logado pra correlacionar erros.
 * Chamar apos login. Passar `null` no logout.
 */
export function setUser(user: { id?: string; email?: string; username?: string } | null) {
    if (!_initialized) return;
    try {
        Sentry.setUser(user || null);
    } catch {
        /* swallow */
    }
}
