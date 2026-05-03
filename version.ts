// Constantes injetadas no bundle pelo Vite (vite.config.ts → define).
// Em desenvolvimento, caem para valores padrão.
declare const __APP_VERSION__: string;
declare const __APP_RELEASE__: string;
declare const __APP_BUILD_TIME__: string;

const safe = <T,>(fn: () => T, fallback: T): T => {
    try {
        return fn();
    } catch {
        return fallback;
    }
};

export const APP_VERSION: string = safe(() => __APP_VERSION__, '0.0.0-dev');
export const APP_RELEASE: string = safe(() => __APP_RELEASE__, 'dev');
export const APP_BUILD_TIME: string = safe(() => __APP_BUILD_TIME__, new Date().toISOString());

export const formatBuildDate = (iso: string = APP_BUILD_TIME): string => {
    try {
        const d = new Date(iso);
        return d.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return iso;
    }
};
