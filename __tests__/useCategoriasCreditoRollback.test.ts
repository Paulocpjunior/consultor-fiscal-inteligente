// ============================================================================
// 🌀 Rede que cai no meio do toggle não pode deixar o spinner preso nem o
// otimista de pé. `salvarCreditConfig` REJEITANDO (não só `ok:false`) tem de
// devolver a categoria ao estado anterior, zerar o "salvando" e avisar.
// ============================================================================
import { renderHook, act } from '@testing-library/react';

jest.mock('../services/categoriasCreditoService', () => ({ listarCustom: jest.fn(async () => []) }));
jest.mock('../services/analiseCreditoExtratoService', () => ({ CATEGORIAS_CREDITO: ['ENERGIA', 'ALUGUEL'] }));
const salvar = jest.fn();
jest.mock('../services/creditConfigService', () => ({
    carregarCreditConfig: jest.fn(async () => ({ categoriasNaoCreditaveis: [] })),
    salvarCreditConfig: (...a: unknown[]) => salvar(...a),
}));

import { useCategoriasCredito } from '../hooks/useCategoriasCredito';

describe('useCategoriasCredito: falha de rede no toggle', () => {
    it('desfaz o otimista, solta o spinner e diz o motivo', async () => {
        salvar.mockRejectedValueOnce(new Error('rede caiu'));
        const onErro = jest.fn();
        const { result } = renderHook(() => useCategoriasCredito('emp-1', onErro));
        await act(async () => { await Promise.resolve(); });

        await act(async () => { await result.current.toggleCategoriaCredito('ENERGIA'); });

        expect(result.current.categoriasNaoCreditaveis.has('ENERGIA')).toBe(false);
        expect(result.current.salvandoCategoriaCredito).toBeNull();
        expect(onErro).toHaveBeenCalledWith(expect.stringContaining('rede caiu'));
    });

    it('sucesso mantém o toggle', async () => {
        salvar.mockResolvedValueOnce({ ok: true });
        const { result } = renderHook(() => useCategoriasCredito('emp-1', jest.fn()));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await result.current.toggleCategoriaCredito('ENERGIA'); });
        expect(result.current.categoriasNaoCreditaveis.has('ENERGIA')).toBe(true);
        expect(result.current.salvandoCategoriaCredito).toBeNull();
    });
});
