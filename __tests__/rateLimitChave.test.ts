// 🔑 A chave do limite de requisições (auditoria 26/09): token forjado NÃO
// ganha balde próprio; token válido é contado pelo uid; o cache tem validade
// e teto. As asserções cobram o FATO (qual chave sai), nunca a redação.
// @ts-expect-error módulo .js puro sem tipos
import { criarGeradorDeChave, CacheDeToken, tokenDoHeader } from '../sefaz-backend/rate-limit-chave.js';

const req = (authorization?: string, ip = '10.0.0.1') => ({ headers: authorization ? { authorization } : {}, ip });

describe('🔑 chave do limite', () => {
    it('sem token: IP', async () => {
        const chave = criarGeradorDeChave({ verificar: async () => 'nunca' });
        expect(await chave(req())).toBe('ip:10.0.0.1');
        expect(await chave(req('Basic abc'))).toBe('ip:10.0.0.1');
    });

    it('token que verifica: uid — e dois tokens do mesmo uid caem no MESMO balde', async () => {
        const chave = criarGeradorDeChave({ verificar: async (t: string) => (t.startsWith('ok') ? 'uid-1' : null) });
        expect(await chave(req('Bearer ok-a'))).toBe('u:uid-1');
        expect(await chave(req('Bearer ok-b', '10.0.0.2'))).toBe('u:uid-1');
    });

    it('🚨 token forjado ou expirado cai no IP — nunca ganha balde novo', async () => {
        let chamadas = 0;
        const chave = criarGeradorDeChave({ verificar: async () => { chamadas++; throw new Error('auth/id-token-expired'); } });
        const chaves = await Promise.all(['x1', 'x2', 'x3'].map((t) => chave(req(`Bearer ${t}`))));
        expect(new Set(chaves)).toEqual(new Set(['ip:10.0.0.1']));
        expect(chamadas).toBe(3);
    });

    it('o cache poupa a verificação e expira', async () => {
        let agora = 1_000_000;
        let chamadas = 0;
        const cache = new CacheDeToken({ ttlMs: 1000, max: 2, agora: () => agora });
        const chave = criarGeradorDeChave({ cache, verificar: async () => { chamadas++; return 'uid-9'; } });
        await chave(req('Bearer t1')); await chave(req('Bearer t1'));
        expect(chamadas).toBe(1);
        agora += 1001;
        await chave(req('Bearer t1'));
        expect(chamadas).toBe(2);
        // teto: o mais antigo sai
        await chave(req('Bearer t2')); await chave(req('Bearer t3'));
        expect(cache.size).toBe(2);
        expect(cache.get('t1')).toBeNull();
    });

    it('tokenDoHeader aceita "Bearer" em qualquer caixa e ignora o resto', () => {
        expect(tokenDoHeader('Bearer abc')).toBe('abc');
        expect(tokenDoHeader('bearer abc')).toBe('abc');
        expect(tokenDoHeader('Token abc')).toBeNull();
        expect(tokenDoHeader(undefined)).toBeNull();
    });
});
