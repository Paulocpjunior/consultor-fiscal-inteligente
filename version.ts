// Constantes injetadas no bundle pelo Vite (vite.config.ts → define).
// Em desenvolvimento, caem para valores padrão.
declare const __APP_VERSION__: string;
declare const __APP_RELEASE__: string;
declare const __APP_BUILD_TIME__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILD_NUMBER__: string;

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
export const APP_COMMIT: string = safe(() => __APP_COMMIT__, 'dev');
/** Nº da execução do deploy (GITHUB_RUN_NUMBER). Vazio fora do CI. */
export const APP_BUILD_NUMBER: string = safe(() => __APP_BUILD_NUMBER__, '');

/**
 * Rótulo da versão para a TELA.
 *
 * A versão semântica sozinha mente por omissão: ela fica meses no mesmo número
 * enquanto o app é entregue várias vezes por dia, então "Versão 1.2.1" era
 * idêntica antes e depois de um deploy — quem olhava não tinha como saber se
 * estava vendo a tela nova ou o HTML velho do navegador. O nº do build SOBE a
 * cada entrega e resolve isso sem depender de alguém lembrar de bumpar versão.
 *
 * Fora do CI (dev local) não existe nº de build: aí o rótulo diz "local",
 * porque inventar um número faria a tela de desenvolvimento se passar por uma
 * entrega publicada.
 */
export const rotuloVersao = (
    versao: string = APP_VERSION,
    build: string = APP_BUILD_NUMBER,
): string => {
    const n = String(build || '').trim();
    return /^\d+$/.test(n) ? `${versao} · build ${n}` : `${versao} · local`;
};

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
