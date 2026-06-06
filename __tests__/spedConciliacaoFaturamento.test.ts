/**
 * Testes da conciliação SPED Fiscal × faturamento declarado pelo contador.
 * Engine puro. Cobertura sintética.
 */
// @ts-expect-error — módulo .js puro
import { parseSpedFiscalParaEdicao } from '../sefaz-backend/sped-fiscal-editor-parser.js';
// @ts-expect-error — módulo .js puro
import { conciliarFaturamento } from '../sefaz-backend/sped-conciliacao-faturamento.js';

const chave = (n: number) => String(n).padStart(44, '0');

function c100(chv: string, vlDoc: string, o: { codSit?: string; numDoc?: string; indOper?: string } = {}): string {
    const { codSit = '00', numDoc = '1', indOper = '1' } = o;
    return `|C100|${indOper}|0|PART|55|${codSit}|1|${numDoc}|${chv}|01012026|01012026|${vlDoc}|0|0,00|0,00|${vlDoc}|9|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`;
}

function spedFiscal(c100s: string[]): any {
    const txt = [
        '|0000|017|0|01012026|31012026|EMP|12345678000190|SP|123|3550308||A|',
        '|0001|0|', '|C001|0|', ...c100s, '|C990|1|',
        '|E001|0|', '|E110|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|', '|E990|2|',
    ].join('\r\n') + '\r\n';
    return parseSpedFiscalParaEdicao(txt);
}

describe('conciliarFaturamento — cenários centrais', () => {
    const sped = spedFiscal([
        c100(chave(1), '5000,00', { indOper: '1', numDoc: '100' }), // saída
        c100(chave(2), '3000,00', { indOper: '1', numDoc: '101' }), // saída
        c100(chave(3), '2000,00', { indOper: '0', numDoc: '200' }), // entrada (ignora)
        c100(chave(4), '999,00', { indOper: '1', codSit: '02' }),    // cancelada (ignora)
    ]);

    it('faturamento declarado bate com soma SPED saída -> ok', () => {
        const r = conciliarFaturamento(sped, 8000);
        expect(r.aplicavel).toBe(true);
        expect(r.totalSpedSaida).toBe(8000);
        expect(r.faturamentoDeclarado).toBe(8000);
        expect(r.diferenca).toBe(0);
        expect(r.severidade).toBe('ok');
        expect(r.sentido).toBe('ok');
    });

    it('SPED maior que declarado por >1% -> ERRO (DAS a menor, risco)', () => {
        const r = conciliarFaturamento(sped, 6000); // declarou 6000, SPED tem 8000
        expect(r.diferenca).toBe(2000);
        expect(r.diferencaPct).toBe(25);
        expect(r.sentido).toBe('sped-maior');
        expect(r.severidade).toBe('erro');
    });

    it('SPED maior por <1% -> AVISO (provavel arredondamento)', () => {
        const r = conciliarFaturamento(sped, 7950); // 0.625% de diferença
        expect(r.sentido).toBe('sped-maior');
        expect(r.severidade).toBe('aviso');
    });

    it('declarado maior que SPED -> sempre AVISO (DAS a maior, perda mas não risco fiscal)', () => {
        const r = conciliarFaturamento(sped, 10000);
        expect(r.diferenca).toBe(-2000);
        expect(r.sentido).toBe('declarado-maior');
        expect(r.severidade).toBe('aviso');
    });

    it('tolerância 2 centavos -> ok', () => {
        const r = conciliarFaturamento(sped, 8000.02);
        expect(r.severidade).toBe('ok');
    });

    it('resumo SPED conta saída/entrada/canceladas corretamente', () => {
        const r = conciliarFaturamento(sped, 8000);
        expect(r.resumoSped.qtdSaida).toBe(2);
        expect(r.resumoSped.qtdEntrada).toBe(1);
        expect(r.resumoSped.ignorados).toBe(1);
        expect(r.resumoSped.totalEntrada).toBe(2000);
    });
});

describe('conciliarFaturamento — guardas', () => {
    it('SPED Contribuições -> não aplicável', () => {
        const txt = '|0000|006|0|01012026|31012026|EMP|12345678000190|SP|3550308|0|0|\r\n'
            + '|0001|0|\r\n|M001|0|\r\n|M200|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|\r\n|M990|3|\r\n';
        const r = conciliarFaturamento(parseSpedFiscalParaEdicao(txt), 5000);
        expect(r.aplicavel).toBe(false);
    });

    it('faturamento declarado 0 + SPED 0 -> ok', () => {
        const r = conciliarFaturamento(spedFiscal([]), 0);
        expect(r.severidade).toBe('ok');
        expect(r.totalSpedSaida).toBe(0);
    });

    it('faturamento declarado 0 mas SPED tem notas -> erro (declaração zerada errada)', () => {
        const sped = spedFiscal([c100(chave(99), '1000,00')]);
        const r = conciliarFaturamento(sped, 0);
        expect(r.severidade).toBe('erro');
        expect(r.sentido).toBe('sped-maior');
    });
});
