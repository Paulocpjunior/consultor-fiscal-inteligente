/**
 * services/paginaLocal.ts  (PURO — testável)
 *
 * 🧊 Dez telas desenhavam o array INTEIRO com `.map(` — nesta semana uma tabela
 * de 20.000 linhas travou a aba ("Esta página não está respondendo"). A régua
 * da lista de NFS-e SP (`nfseSpListaJanela.ts`) resolveu UMA tela; esta é a
 * versão genérica, sem teto de leitura nem período: só a paginação local e a
 * frase honesta do rodapé.
 *
 *  - `linhasVisiveis`: quantas linhas a tabela desenha agora (cresce de página
 *    em página, nunca passa do total);
 *  - `textoDaContagem`: farol honesto — lista cortada diz "mostrando X de N",
 *    lista inteira diz "N <rótulo>".
 *
 * Quem consome no React é `components/hooks/usePaginaLocal.ts`.
 */

export const LINHAS_POR_PAGINA_PADRAO = 200;

/** Quantas linhas a tabela desenha agora (cresce de página em página). */
export function linhasVisiveis(
    total: number,
    paginas: number,
    porPagina: number = LINHAS_POR_PAGINA_PADRAO,
): number {
    const p = Math.max(1, Math.floor(paginas || 1));
    const tamanho = Math.max(1, Math.floor(porPagina || LINHAS_POR_PAGINA_PADRAO));
    return Math.min(Math.max(0, Math.floor(total || 0)), p * tamanho);
}

export interface ContagemPaginaLocal {
    visiveis: number;    // o que está desenhado
    total: number;       // o que a tela tem em mãos (o array inteiro)
    filtradas?: number;  // quando a tela filtra em memória: o que sobrou do filtro
    rotulo: string;      // "tarefas", "empresas", "notas"…
}

/**
 * A frase do rodapé: nunca afirma completude que a tela não desenhou.
 *  - tudo visível, sem filtro:   "N <rótulo>"
 *  - tudo visível, com filtro:   "F de N <rótulo>"
 *  - cortada, sem filtro:        "mostrando X de N <rótulo>"
 *  - cortada, com filtro:        "mostrando X de F <rótulo> (N no total)"
 */
export function textoDaContagem(c: ContagemPaginaLocal): string {
    const total = Math.max(0, c.total || 0);
    const filtradas = c.filtradas === undefined ? total : Math.max(0, c.filtradas || 0);
    const visiveis = Math.max(0, Math.min(c.visiveis || 0, filtradas));
    const rotulo = c.rotulo || 'linhas';
    const comFiltro = c.filtradas !== undefined && filtradas !== total;
    if (visiveis < filtradas) {
        return comFiltro
            ? `mostrando ${visiveis} de ${filtradas} ${rotulo} (${total} no total)`
            : `mostrando ${visiveis} de ${filtradas} ${rotulo}`;
    }
    return comFiltro ? `${filtradas} de ${total} ${rotulo}` : `${filtradas} ${rotulo}`;
}
