/**
 * services/sessaoLocal.ts — o que a SESSÃO deixa no navegador, e quando uma
 * sessão é NOVA. Módulo PURO (o `authService` carrega `import.meta` e não roda
 * no jest — régua dentro dele é régua sem prova).
 *
 * 🧹 LOGOUT APAGA DADO DE CLIENTE E DE USUÁRIO. Antes só a sessão saía: o
 * próximo a entrar na mesma estação (o escritório compartilha máquina) via o
 * cache de empresas, notas e logs de quem saiu. Preferência de UI (banner
 * fechado, versão vista, aba lembrada) NÃO entra aqui — ela é do navegador,
 * não da pessoa.
 *
 * As chaves EXATAS espelham os donos (`simplesNacionalService`,
 * `lucroPresumidoService`, `authService`); o PREFIXO cobre a empresa ativa
 * (`empresaAtiva.ts` grava `cfi_empresa_ativa:<uid>`, uma por pessoa).
 */
export const CHAVES_LOCAIS_DE_DADOS = [
    'app_users',
    'app_access_logs',
    'simples_nacional_empresas',
    'simples_nacional_notas',
    'lucro_presumido_empresas',
];
export const PREFIXOS_LOCAIS_DE_DADOS = ['cfi_empresa_ativa'];

/** Quais chaves do storage o logout apaga — decidido sobre a LISTA, testável sem DOM. */
export function chavesParaLimpar(todas: string[]): string[] {
    return todas.filter(k => CHAVES_LOCAIS_DE_DADOS.includes(k) || PREFIXOS_LOCAIS_DE_DADOS.some(p => k.startsWith(p)));
}

export function limparDadosLocaisDaSessao(storage: Storage = localStorage): void {
    try {
        const todas: string[] = [];
        for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            if (k) todas.push(k);
        }
        for (const k of chavesParaLimpar(todas)) storage.removeItem(k);
    } catch { /* modo anônimo / storage indisponível */ }
}

/**
 * 🚨 'login' só quando a sessão NÃO existia. O `onAuthStateChanged` dispara
 * também no refresh de token e no F5 — e cada disparo gravava um 'login' em
 * `access_logs`, então o histórico dizia que a pessoa entrou dez vezes numa
 * manhã em que entrou uma. Quem responde é o cache da sessão: se ele já tem
 * este uid, é a MESMA sessão continuando.
 */
export function ehSessaoNova(sessaoAnterior: { id?: string } | null | undefined, uid: string): boolean {
    return !sessaoAnterior || !sessaoAnterior.id || sessaoAnterior.id !== uid;
}
