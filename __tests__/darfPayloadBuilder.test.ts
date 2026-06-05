/**
 * Testes do builder do payload SERPRO de DARF (montarPayloadDarfSerpro).
 * O mesmo builder serve o envio real E o preview (dry-run) — entao travar
 * a estrutura aqui garante que o que o admin vê no preview é exatamente o
 * que sera enviado.
 */

// @ts-expect-error — modulo .js puro
import { montarPayloadDarfSerpro } from '../sefaz-backend/darf-payload-builder.js';

describe('montarPayloadDarfSerpro', () => {
    it('usa codigoReceita explicito quando informado', () => {
        const p = montarPayloadDarfSerpro({
            empresaCnpj: '12345678000190', competencia: '2026-03', valor: 1500,
            codigoReceita: '2089', vencimento: '2026-04-30',
        });
        expect(p.idServico).toBe('EMITEDARF61'); // default (override via env)
        expect(p.acao).toBe('Emitir');
        expect(p.contribuinteCnpj).toBe('12345678000190');
        expect(p.dados.codigoReceita).toBe('2089');
        expect(p.dados.periodoApuracao).toBe('202603');
        expect(p.dados.valorPrincipal).toBe(1500);
        expect(p.dados.vencimento).toBe('2026-04-30');
    });

    it('periodoApuracao = AAAAMM a partir de YYYY-MM', () => {
        const p = montarPayloadDarfSerpro({
            empresaCnpj: '12345678000190', competencia: '2026-12', valor: 100, codigoReceita: '2089',
        });
        expect(p.dados.periodoApuracao).toBe('202612');
    });

    it('resolve codigoReceita por regime/tributo quando nao informado', () => {
        // IRPJ Presumido trimestral tem codigo conhecido na tabela.
        const p = montarPayloadDarfSerpro({
            empresaCnpj: '12345678000190', competencia: '2026-03', valor: 1000,
            regime: 'Presumido', tributo: 'IRPJ', periodicidade: 'trimestral',
        });
        expect(p.dados.codigoReceita).toMatch(/^\d{4}$/); // codigo de 4 digitos
    });

    it('lanca em campos obrigatorios faltando', () => {
        expect(() => montarPayloadDarfSerpro({ competencia: '2026-03', valor: 100 } as any))
            .toThrow(/obrigatorios/);
        expect(() => montarPayloadDarfSerpro({ empresaCnpj: '123', valor: 100 } as any))
            .toThrow(/obrigatorios/);
        expect(() => montarPayloadDarfSerpro({ empresaCnpj: '123', competencia: '2026-03' } as any))
            .toThrow(/obrigatorios/);
    });

    it('lanca quando nao consegue resolver codigo (regime/tributo invalido)', () => {
        expect(() => montarPayloadDarfSerpro({
            empresaCnpj: '12345678000190', competencia: '2026-03', valor: 100,
            regime: 'XPTO', tributo: 'INEXISTENTE',
        } as any)).toThrow(/Codigo de receita/);
    });
});
