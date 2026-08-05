/**
 * Código de serviço DARE da ANTECIPAÇÃO do art. 426-A.
 *
 * A antecipação é rubrica PRÓPRIA. O erro que estes testes impedem é o caro:
 * emitir a guia no 04602 (DIFAL do Simples) porque era o código que o app já
 * tinha à mão — o valor cairia na receita errada e a SEFAZ não desfaz
 * emissão. Mesma regra do idAtividade do PGDAS-D e do COD_AJ da 5.3: código
 * de tributo não se chuta, vem da fonte.
 */
import {
    validarCodigoAntecipacao, servicoAntecipacao, CODIGOS_JA_USADOS,
} from '../sefaz-backend/dare-antecipacao-config.js';
import { montarDare } from '../sefaz-backend/dare-sp.js';

describe('validarCodigoAntecipacao', () => {
    it('aceita um código plausível quando não há lista pra conferir', () => {
        expect(validarCodigoAntecipacao('06301')).toEqual({ ok: true, codigo: '06301' });
    });

    it('RECUSA os códigos que já são de outro tributo — o erro caro', () => {
        for (const c of CODIGOS_JA_USADOS) {
            const r = validarCodigoAntecipacao(c);
            expect(r.ok).toBe(false);
            expect((r as any).erro).toMatch(/rubrica PRÓPRIA/);
        }
        expect((validarCodigoAntecipacao('04602') as any).erro).toMatch(/DIFAL do Simples/);
    });

    it('recusa lixo digitado, com a ação prática', () => {
        const r = validarCodigoAntecipacao('abc');
        expect(r.ok).toBe(false);
        expect((r as any).erro).toMatch(/Serviços da SEFAZ/);
    });

    it('com a lista REAL da SEFAZ, código fora dela é recusado', () => {
        const receitas = [{ codigoServicoDARE: 6301 }, { codigoServicoDARE: 4602 }];
        expect(validarCodigoAntecipacao('06301', { receitasSefaz: receitas }).ok).toBe(true);
        const r = validarCodigoAntecipacao('09999', { receitasSefaz: receitas });
        expect(r.ok).toBe(false);
        expect((r as any).erro).toMatch(/não aparece na lista/);
    });
});

describe('servicoAntecipacao + montarDare', () => {
    it('sem código cadastrado, a guia da antecipação é RECUSADA', () => {
        expect(servicoAntecipacao(null)).toBeNull();
        expect(() => montarDare({
            cnpj: '44388152000189', razaoSocial: 'X LTDA', codigoServico: '06301',
            referencia: '2026-07', valor: 100, vencimento: '2026-08-20',
        })).toThrow(/desconhecido/);
    });

    it('com o código do banco, monta a guia com a natureza da ANTECIPAÇÃO', () => {
        const svc = servicoAntecipacao({ codigoServico: '06301', codigoReceita: '063-2' })!;
        const p = montarDare({
            cnpj: '44388152000189', razaoSocial: 'X LTDA', codigoServico: '06301',
            referencia: '2026-07', valor: 1234.56, vencimento: '2026-08-20',
            codigosExtras: { '06301': svc },
        });
        expect(p.derivacao).toBe('antecipacao');
        expect(p.descricao).toMatch(/426-A/);
        expect(p.valor).toBe(1234.56);
    });

    it('o código do banco NÃO contamina os outros: 04602 segue sendo DIFAL', () => {
        const svc = servicoAntecipacao({ codigoServico: '06301' })!;
        const p = montarDare({
            cnpj: '44388152000189', razaoSocial: 'X LTDA', codigoServico: '04602',
            referencia: '2026-07', valor: 10, vencimento: '2026-08-20',
            codigosExtras: { '06301': svc },
        });
        expect(p.derivacao).toBe('difal');
    });
});
