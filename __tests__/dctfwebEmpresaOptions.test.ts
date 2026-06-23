import type { DctfwebDeclaracao } from '../types';
import type { DctfwebEmpresaOption } from '../services/dctfwebService';
import { buildDctfwebEmpresaOptions, normalizarCnpjDctfweb } from '../components/DCTFWeb/dctfwebEmpresaOptions';

const decl = (overrides: Partial<DctfwebDeclaracao>): DctfwebDeclaracao => ({
    id: 'd1',
    empresaCnpj: '11.222.333/0001-81',
    empresaId: 'decl-empresa',
    categoria: 'GERAL_MENSAL',
    anoPA: 2026,
    mesPA: 5,
    situacao: 'EM_ANDAMENTO',
    ...overrides,
});

describe('dctfwebEmpresaOptions', () => {
    it('normaliza CNPJ para comparacao e value de select', () => {
        expect(normalizarCnpjDctfweb('11.222.333/0001-81')).toBe('11222333000181');
    });

    it('mantem empresas vindas do cadastro backend', () => {
        const empresas: DctfwebEmpresaOption[] = [
            { id: 'l1', nome: 'Expert LTDA', cnpj: '11.222.333/0001-81', fonte: 'lucro' },
        ];

        expect(buildDctfwebEmpresaOptions(empresas, [])).toEqual([
            { id: 'l1', nome: 'Expert LTDA', cnpj: '11222333000181', fonte: 'lucro' },
        ]);
    });

    it('usa declaracoes como fallback quando o cadastro nao carregou', () => {
        const options = buildDctfwebEmpresaOptions([], [
            decl({ empresaId: 'l2', empresaCnpj: '22.333.444/0001-55' }),
        ]);

        expect(options).toEqual([
            { id: 'l2', nome: '22333444000155', cnpj: '22333444000155', fonte: 'lucro' },
        ]);
    });

    it('deduplica por CNPJ e preserva nome/id do cadastro', () => {
        const empresas: DctfwebEmpresaOption[] = [
            { id: 'l1', nome: 'Expert LTDA', cnpj: '11.222.333/0001-81', fonte: 'lucro' },
        ];
        const options = buildDctfwebEmpresaOptions(empresas, [
            decl({ empresaId: 'decl-empresa', empresaCnpj: '11222333000181' }),
        ]);

        expect(options).toHaveLength(1);
        expect(options[0].id).toBe('l1');
        expect(options[0].nome).toBe('Expert LTDA');
    });

    it('ignora CNPJ invalido para nao sincronizar payload incompleto', () => {
        const options = buildDctfwebEmpresaOptions([
            { id: 'l1', nome: 'Sem CNPJ', cnpj: '123', fonte: 'lucro' },
        ], [
            decl({ empresaCnpj: '' }),
        ]);

        expect(options).toEqual([]);
    });
});
