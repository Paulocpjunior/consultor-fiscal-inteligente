/**
 * safeStorage — wrapper localStorage com try/catch.
 *
 * Problema resolvido:
 *   - `localStorage.setItem` lanca QuotaExceededError quando o storage estoura
 *   - Safari modo privado nega acesso a localStorage e tambem lanca
 *   - JSON.parse de valor corrompido derrubava o boot do App
 *
 * Antes, varios pontos do App.tsx atribuiam `localStorage.theme = 'dark'`
 * direto ou faziam JSON.parse sem catch. Em modo privado o App quebrava
 * com tela branca antes de mostrar o login. Aqui centralizamos.
 */

export const safeStorage = {
    /**
     * Le uma chave do localStorage. Devolve null se chave nao existe,
     * storage indisponivel, ou erro de quota/permissao.
     */
    getItem(key: string): string | null {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    },

    /**
     * Escreve uma chave no localStorage. Devolve true se OK, false se
     * falhou (quota, modo privado, etc). NUNCA lanca.
     */
    setItem(key: string, value: string): boolean {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (e) {
            console.warn(`[safeStorage] setItem("${key}") falhou:`, e instanceof Error ? e.message : e);
            return false;
        }
    },

    /** Remove uma chave. Nao lanca se chave nao existe ou storage indisponivel. */
    removeItem(key: string): void {
        try {
            localStorage.removeItem(key);
        } catch {
            /* ignore */
        }
    },

    /**
     * Le e tenta fazer JSON.parse. Se parse falhar (valor corrompido) ou
     * chave nao existe, devolve `fallback`. Garante que dados ruins em
     * localStorage NUNCA derrubam a app.
     */
    getJSON<T>(key: string, fallback: T): T {
        const raw = this.getItem(key);
        if (raw === null) return fallback;
        try {
            return JSON.parse(raw) as T;
        } catch {
            return fallback;
        }
    },

    /** Stringify + setItem em um helper. Devolve true se gravou. */
    setJSON(key: string, value: unknown): boolean {
        try {
            return this.setItem(key, JSON.stringify(value));
        } catch {
            return false;
        }
    },
};
