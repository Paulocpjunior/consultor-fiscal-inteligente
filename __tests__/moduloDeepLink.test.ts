/**
 * moduloDeepLink.test.ts — URL fixa por módulo (?modulo=<slug>).
 */
import { resolverModuloDeepLink, MODULO_SLUGS } from '../services/moduloDeepLink';
import { SearchType } from '../types';

describe('resolverModuloDeepLink', () => {
    it('?modulo=vencimentos → card Vencimentos & Obrigações (URL fixa)', () => {
        expect(resolverModuloDeepLink('?modulo=vencimentos')).toBe(SearchType.OBRIGACOES_FISCAIS);
    });
    it('aceita caixa alta e espaços', () => {
        expect(resolverModuloDeepLink('?modulo=VENCIMENTOS')).toBe(SearchType.OBRIGACOES_FISCAIS);
        expect(resolverModuloDeepLink('?modulo=%20vencimentos%20')).toBe(SearchType.OBRIGACOES_FISCAIS);
    });
    it('slug desconhecido, vazio ou ausente → null (fica no menu normal)', () => {
        expect(resolverModuloDeepLink('?modulo=nao-existe')).toBeNull();
        expect(resolverModuloDeepLink('')).toBeNull();
        expect(resolverModuloDeepLink('?outro=1')).toBeNull();
    });
    it('todo slug do mapa resolve', () => {
        for (const slug of Object.keys(MODULO_SLUGS)) {
            expect(resolverModuloDeepLink(`?modulo=${slug}`)).toBe(MODULO_SLUGS[slug]);
        }
    });
});
