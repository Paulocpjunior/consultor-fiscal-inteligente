/**
 * Testes de podeAcessarCard / MODULOS_RESTRITOS (config/menuConfig.ts).
 *
 * Regra: card sem adminOnly é livre; card adminOnly exige role admin OU
 * o SearchType do card presente em modulosPermitidos (liberado pelo admin
 * via Gerenciar Usuários).
 */
import { MENU_GRUPOS, MODULOS_RESTRITOS, podeAcessarCard } from '../config/menuConfig';
import { SearchType } from '../types';

const cardRestrito = MENU_GRUPOS
    .flatMap(g => g.cards)
    .find(c => c.type === SearchType.NFP_PRO_CLOUD)!;

const cardLivre = MENU_GRUPOS
    .flatMap(g => g.cards)
    .find(c => !c.adminOnly)!;

describe('podeAcessarCard', () => {
    it('admin acessa card restrito mesmo sem modulosPermitidos', () => {
        expect(podeAcessarCard({ role: 'admin' }, cardRestrito)).toBe(true);
    });

    it('colaborador SEM liberação NÃO acessa card restrito', () => {
        expect(podeAcessarCard({ role: 'colaborador' }, cardRestrito)).toBe(false);
        expect(podeAcessarCard({ role: 'colaborador', modulosPermitidos: [] }, cardRestrito)).toBe(false);
        expect(podeAcessarCard(
            { role: 'colaborador', modulosPermitidos: [SearchType.CFOP] },
            cardRestrito,
        )).toBe(false);
    });

    it('colaborador COM liberação acessa card restrito', () => {
        expect(podeAcessarCard(
            { role: 'colaborador', modulosPermitidos: [SearchType.NFP_PRO_CLOUD] },
            cardRestrito,
        )).toBe(true);
    });

    it('card sem adminOnly é acessível a qualquer role', () => {
        expect(podeAcessarCard({ role: 'colaborador' }, cardLivre)).toBe(true);
        expect(podeAcessarCard({ role: 'admin' }, cardLivre)).toBe(true);
    });
});

describe('MODULOS_RESTRITOS', () => {
    it('inclui Consulta Situação Fiscal (NFP_PRO_CLOUD)', () => {
        expect(MODULOS_RESTRITOS.some(m => m.type === SearchType.NFP_PRO_CLOUD)).toBe(true);
    });

    it('só contém cards adminOnly', () => {
        expect(MODULOS_RESTRITOS.every(m => m.adminOnly)).toBe(true);
    });
});
