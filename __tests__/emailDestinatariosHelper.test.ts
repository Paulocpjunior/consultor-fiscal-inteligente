import { parseDestinatarios } from '../sefaz-backend/email-destinatarios-helper.js';

const FALLBACK = 'junior@spassessoriacontabil.com.br';

describe('parseDestinatarios', () => {
    it('e-mail único continua funcionando (retrocompatível)', () => {
        expect(parseDestinatarios('a@sp.com.br', FALLBACK)).toEqual(['a@sp.com.br']);
    });

    it('lista com vírgula, ponto-e-vírgula e espaços', () => {
        expect(parseDestinatarios('a@sp.com.br, b@sp.com.br; c@sp.com.br', FALLBACK))
            .toEqual(['a@sp.com.br', 'b@sp.com.br', 'c@sp.com.br']);
    });

    it('remove duplicatas (case-insensitive)', () => {
        expect(parseDestinatarios('a@sp.com.br,A@SP.com.br', FALLBACK)).toEqual(['a@sp.com.br']);
    });

    it('descarta itens inválidos, mantém os válidos', () => {
        expect(parseDestinatarios('a@sp.com.br, lixo, b@sp', FALLBACK)).toEqual(['a@sp.com.br']);
    });

    it('env var vazia/undefined → fallback', () => {
        expect(parseDestinatarios(undefined, FALLBACK)).toEqual([FALLBACK]);
        expect(parseDestinatarios('', FALLBACK)).toEqual([FALLBACK]);
        expect(parseDestinatarios(' , ; ', FALLBACK)).toEqual([FALLBACK]);
    });

    it('só inválidos → fallback', () => {
        expect(parseDestinatarios('lixo, mais-lixo', FALLBACK)).toEqual([FALLBACK]);
    });

    it('sem fallback e nada válido → lista vazia (enviarEmail já barra)', () => {
        expect(parseDestinatarios('lixo')).toEqual([]);
    });
});
