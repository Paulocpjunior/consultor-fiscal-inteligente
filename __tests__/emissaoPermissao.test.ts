/**
 * Testes de temPermissaoEmissao (sefaz-backend/emissao-permissao.js) —
 * regra usada pelo middleware requireEmissao nas rotas /emitir* de
 * DAS/DARF/Central de Emissões.
 *
 * Regra: admin sempre pode; colaborador precisa de PERM_EMISSAO_TRIBUTOS
 * em modulosPermitidos (liberada pelo admin via Gerenciar Usuários).
 */
import { temPermissaoEmissao, PERM_EMISSAO_TRIBUTOS } from '../sefaz-backend/emissao-permissao.js';
import { PERMISSOES_FUNCIONAIS } from '../config/menuConfig';
import { SearchType } from '../types';

describe('temPermissaoEmissao', () => {
    it('admin pode emitir mesmo sem modulosPermitidos', () => {
        expect(temPermissaoEmissao('admin', undefined)).toBe(true);
        expect(temPermissaoEmissao('admin', [])).toBe(true);
    });

    it('colaborador sem a permissão NÃO pode emitir', () => {
        expect(temPermissaoEmissao('colaborador', undefined)).toBe(false);
        expect(temPermissaoEmissao('colaborador', [])).toBe(false);
        expect(temPermissaoEmissao('colaborador', [SearchType.NFP_PRO_CLOUD])).toBe(false);
    });

    it('colaborador com a permissão liberada pode emitir', () => {
        expect(temPermissaoEmissao('colaborador', [PERM_EMISSAO_TRIBUTOS])).toBe(true);
        expect(temPermissaoEmissao(
            'colaborador',
            [SearchType.NFP_PRO_CLOUD, PERM_EMISSAO_TRIBUTOS],
        )).toBe(true);
    });

    it('role desconhecido/ausente nega mesmo com a permissão na lista', () => {
        expect(temPermissaoEmissao(null, [PERM_EMISSAO_TRIBUTOS])).toBe(false);
        expect(temPermissaoEmissao('viewer', [PERM_EMISSAO_TRIBUTOS])).toBe(false);
    });
});

describe('sincronia front × backend', () => {
    it('PERM_EMISSAO_TRIBUTOS (backend) === SearchType.EMISSAO_TRIBUTOS (front)', () => {
        expect(PERM_EMISSAO_TRIBUTOS).toBe(SearchType.EMISSAO_TRIBUTOS);
    });

    it('PERMISSOES_FUNCIONAIS expõe o toggle de Emissão de Tributos no modal', () => {
        expect(PERMISSOES_FUNCIONAIS.some(p => p.type === SearchType.EMISSAO_TRIBUTOS)).toBe(true);
    });
});
