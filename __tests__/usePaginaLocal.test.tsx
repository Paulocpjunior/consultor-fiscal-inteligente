// 🧊 O hook de paginação local: desenha 200, cresce com "mostrar mais", volta
// à primeira página quando o array muda de identidade e nunca esconde o total.
import { renderHook, act } from '@testing-library/react';
import { usePaginaLocal } from '../components/hooks/usePaginaLocal';

const lista = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe('usePaginaLocal', () => {
    it('desenha 200 por padrão e mantém o total inteiro à disposição', () => {
        const itens = lista(1000);
        const { result } = renderHook(() => usePaginaLocal(itens));
        expect(result.current.visiveis).toHaveLength(200);
        expect(result.current.visiveis[0]).toEqual({ id: 0 });
        expect(result.current.total).toBe(1000);
        expect(result.current.restantes).toBe(800);
        expect(result.current.textoContagem).toBe('mostrando 200 de 1000 linhas');
    });

    it('"mostrar mais" cresce página a página sem passar do total', () => {
        const itens = lista(450);
        const { result } = renderHook(() => usePaginaLocal(itens));
        act(() => result.current.mostrarMais());
        expect(result.current.visiveis).toHaveLength(400);
        expect(result.current.restantes).toBe(50);
        act(() => result.current.mostrarMais());
        expect(result.current.visiveis).toHaveLength(450);
        expect(result.current.restantes).toBe(0);
        expect(result.current.textoContagem).toBe('450 linhas');
        act(() => result.current.mostrarMais());
        expect(result.current.visiveis).toHaveLength(450);
    });

    it('lista menor que a página sai inteira e é o MESMO array (sem cópia)', () => {
        const itens = lista(30);
        const { result } = renderHook(() => usePaginaLocal(itens));
        expect(result.current.visiveis).toBe(itens);
        expect(result.current.restantes).toBe(0);
    });

    it('array novo (filtro, recarga) volta à primeira página', () => {
        let itens = lista(1000);
        const { result, rerender } = renderHook(() => usePaginaLocal(itens));
        act(() => result.current.mostrarMais());
        act(() => result.current.mostrarMais());
        expect(result.current.visiveis).toHaveLength(600);
        itens = lista(700);
        rerender();
        expect(result.current.visiveis).toHaveLength(200);
        expect(result.current.total).toBe(700);
    });

    it('mesmo array re-renderizado NÃO perde a página', () => {
        const itens = lista(1000);
        const { result, rerender } = renderHook(() => usePaginaLocal(itens));
        act(() => result.current.mostrarMais());
        rerender();
        expect(result.current.visiveis).toHaveLength(400);
    });

    it('reiniciar volta à primeira página; tamanho de página e rótulo são parâmetros', () => {
        const itens = lista(120);
        const { result } = renderHook(() => usePaginaLocal(itens, 50, 'empresas'));
        act(() => result.current.mostrarMais());
        expect(result.current.visiveis).toHaveLength(100);
        expect(result.current.textoContagem).toBe('mostrando 100 de 120 empresas');
        act(() => result.current.reiniciar());
        expect(result.current.visiveis).toHaveLength(50);
    });
});
