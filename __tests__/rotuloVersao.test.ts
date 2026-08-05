import { rotuloVersao } from '../version';

describe('rotuloVersao — o número da tela precisa MUDAR a cada entrega', () => {
    it('mostra o nº do build junto da versão semântica', () => {
        expect(rotuloVersao('1.2.1', '300')).toBe('1.2.1 · build 300');
    });

    it('build novo dá rótulo DIFERENTE com a mesma versão semântica', () => {
        // É este o ponto: 1.2.1 ficou meses igual enquanto o app era entregue
        // várias vezes por dia — "Versão 1.2.1" não denunciava deploy nenhum.
        expect(rotuloVersao('1.2.1', '300')).not.toBe(rotuloVersao('1.2.1', '301'));
    });

    it('sem nº de build (dev local) diz "local" — não inventa número', () => {
        expect(rotuloVersao('1.2.1', '')).toBe('1.2.1 · local');
        expect(rotuloVersao('1.2.1', '   ')).toBe('1.2.1 · local');
    });

    it('valor não numérico não vira build (não passa por entrega publicada)', () => {
        expect(rotuloVersao('1.2.1', 'undefined')).toBe('1.2.1 · local');
        expect(rotuloVersao('1.2.1', 'v300')).toBe('1.2.1 · local');
    });

    it('aceita nº com espaços em volta (vem de variável de ambiente)', () => {
        expect(rotuloVersao('1.2.1', ' 42 ')).toBe('1.2.1 · build 42');
    });
});
