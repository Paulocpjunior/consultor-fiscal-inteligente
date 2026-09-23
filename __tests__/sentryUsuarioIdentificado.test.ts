/**
 * 🚨 MATA-BURRO: FUNÇÃO PRONTA SEM QUEM A LIGUE É CÓDIGO MORTO COM CARA DE ENTREGA.
 *
 * O caso (auditoria de 04/09, ao fechar o PR #56 "set Sentry user context from
 * auth state"): `setUser` existia em `services/sentry.ts` — LGPD-safe, testada
 * por leitura, com o comentário dizendo *"chamar após login"* — e **ninguém a
 * chamava**. O Sentry recebia todo erro do app e nenhum chegava identificado:
 * quando um aparecia, não dava para saber QUEM o viu nem em qual escritório,
 * e a única saída era pedir print.
 *
 * É a "rota sem botão" de 13/08, na versão função. A régua da casa: a ligação
 * entra no MESMO PR, e ela se prova por varredura — este teste é a varredura.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const semComentarios = (src: string) => src
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const auth = semComentarios(readFileSync(join(__dirname, '..', 'services/authService.ts'), 'utf8'));

describe('🔌 o usuário logado chega ao Sentry', () => {
    it('authService importa o setUser do Sentry', () => {
        expect(auth).toMatch(/import \{ setUser as setSentryUser \} from '\.\/sentry'/);
    });

    it('carimba no LOGIN — com id e e-mail (o módulo só manda hash + domínio)', () => {
        expect(auth).toMatch(/setSentryUser\(\{ id: user\.id, email: user\.email \}\)/);
    });

    it('LIMPA no logout — senão o próximo erro sai com o usuário anterior', () => {
        expect(auth).toMatch(/setSentryUser\(null\)/);
    });

    it('as duas chamadas ficam DENTRO do onAuthStateChanged, não num lugar que só roda uma vez', () => {
        const i0 = auth.indexOf('onAuthStateChanged(auth, async');
        const fim = auth.indexOf('// ─── CURRENT USER');
        const trecho = auth.slice(i0, fim);
        expect((trecho.match(/setSentryUser\(/g) || []).length).toBe(2);
    });
});
