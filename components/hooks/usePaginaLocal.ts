/**
 * components/hooks/usePaginaLocal.ts
 *
 * Paginação LOCAL ("Mostrar mais") para qualquer lista já em memória: a tela
 * continua com o array inteiro (totais, CSV e contagens seguem completos) e
 * só DESENHA `porPagina` linhas por vez. Quando a identidade do array muda
 * (novo filtro, nova carga), volta para a primeira página.
 *
 * Régua pura em `services/paginaLocal.ts`; botão em `components/MostrarMais.tsx`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LINHAS_POR_PAGINA_PADRAO, linhasVisiveis, textoDaContagem } from '../../services/paginaLocal';

export interface PaginaLocal<T> {
    visiveis: T[];          // a fatia desenhada
    total: number;          // o array inteiro
    restantes: number;      // o que ainda não foi desenhado
    mostrarMais: () => void;
    reiniciar: () => void;  // volta à primeira página
    textoContagem: string;  // "mostrando X de N <rótulo>" ou "N <rótulo>"
}

export function usePaginaLocal<T>(
    itens: T[],
    porPagina: number = LINHAS_POR_PAGINA_PADRAO,
    rotulo: string = 'linhas',
): PaginaLocal<T> {
    const [paginas, setPaginas] = useState(1);

    // Novo array (filtro, recarga) => primeira página.
    useEffect(() => { setPaginas(1); }, [itens]);

    const total = itens.length;
    const quantidade = linhasVisiveis(total, paginas, porPagina);
    const visiveis = useMemo(
        () => (quantidade >= itens.length ? itens : itens.slice(0, quantidade)),
        [itens, quantidade],
    );
    const mostrarMais = useCallback(() => setPaginas(p => p + 1), []);
    const reiniciar = useCallback(() => setPaginas(1), []);

    return {
        visiveis,
        total,
        restantes: total - quantidade,
        mostrarMais,
        reiniciar,
        textoContagem: textoDaContagem({ visiveis: quantidade, total, rotulo }),
    };
}

export default usePaginaLocal;
