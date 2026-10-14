/**
 * 🧾 DARF DOS RETIDOS: UM POR CÓDIGO DECLARADO NA DCTFWEB (14/10).
 *
 * Paulo, contribuinte 62827860 · 09/2026: a DCTFWeb trazia 170806 (IRRF
 * 415,07), 595207 (525,98), 596007 (785,85) e 597907 (170,27) — e o
 * "Emitir DARF avulso" oferecia só 1708 e 5952, com a CSRF inteira (1.482,10)
 * num DARF 5952. E o IRRF de outra cliente era 8045, que o CFI nem lia.
 *
 * Fatos cobrados: com os débitos da DCTFWeb, sai um DARF por código (5952,
 * 5960, 5979 separados, valores da DCTFWeb); 8045 é IRRF e sai avulso; código
 * que o CFI não emite avulso é DITO, nunca somado a outro; INSS segue no
 * numerado; sem os débitos, o comportamento antigo (por família) continua.
 */
import { decidirEmissaoRetidos } from '../services/efdReinfConference';
// @ts-expect-error módulo .js puro (sem tipos)
import { familiaPorReceita } from '../sefaz-backend/dctfweb-retencao-normalizer.js';

const resultado = (irrf: number, csrf: number, inss = 0): any => ({
    competencia: '2026-09',
    totalDctfweb: irrf + csrf + inss,
    divergencias: [
        { familia: 'INSS', valorReinf: inss, valorDctfweb: inss, status: 'ok' },
        { familia: 'IRRF', valorReinf: irrf, valorDctfweb: irrf, status: 'ok' },
        { familia: 'CSRF', valorReinf: csrf, valorDctfweb: csrf, status: 'ok' },
    ],
});
const base = { dctfwebLido: true, eventosNaoLidos: [] as string[] };

describe('o caso do print (62827860 · 09/2026)', () => {
    const debitos = [
        { codReceita: '170806', familia: 'IRRF', valor: 415.07 },
        { codReceita: '595207', familia: 'CSRF', valor: 525.98 },
        { codReceita: '596007', familia: 'CSRF', valor: 785.85 },
        { codReceita: '597907', familia: 'CSRF', valor: 170.27 },
    ];
    it('um DARF por código, com o valor de cada débito', () => {
        const d = decidirEmissaoRetidos({ ...base, resultado: resultado(415.07, 1482.1), debitosDctfweb: debitos });
        expect(d.pode).toBe(true);
        expect(d.avulsos).toEqual([
            { familia: 'IRRF', codigo: '1708', valor: 415.07 },
            { familia: 'CSRF', codigo: '5952', valor: 525.98 },
            { familia: 'CSRF', codigo: '5960', valor: 785.85 },
            { familia: 'CSRF', codigo: '5979', valor: 170.27 },
        ]);
        // A soma dos DARF é a da DCTFWeb — nada some, nada duplica.
        expect(d.avulsos.reduce((t, a) => t + a.valor, 0)).toBeCloseTo(1897.17, 2);
    });
});

describe('8045 é IRRF e sai avulso', () => {
    it('a DCTFWeb reconhece 8045 como IRRF', () => {
        expect(familiaPorReceita('804506')).toBe('IRRF');
    });
    it('DARF 8045 com o valor declarado', () => {
        const d = decidirEmissaoRetidos({ ...base, resultado: resultado(300, 0), debitosDctfweb: [{ codReceita: '804506', familia: 'IRRF', valor: 300 }] });
        expect(d.avulsos).toEqual([{ familia: 'IRRF', codigo: '8045', valor: 300 }]);
    });
});

describe('bordas', () => {
    it('código sem DARF avulso no CFI: dito, nunca somado a outro', () => {
        const d = decidirEmissaoRetidos({ ...base, resultado: resultado(50, 0), debitosDctfweb: [{ codReceita: '328006', familia: 'IRRF', valor: 50 }] });
        expect(d.avulsos).toEqual([]);
        expect(d.foraDoAvulso).toEqual([{ codigo: '3280', valor: 50 }]);
    });
    it('INSS continua só no numerado', () => {
        const d = decidirEmissaoRetidos({ ...base, resultado: resultado(0, 0, 90), debitosDctfweb: [{ codReceita: '116201', familia: 'INSS', valor: 90 }] });
        expect(d.avulsos).toEqual([]);
        expect(d.inssSoNumerado).toBe(90);
    });
    it('sem os débitos da DCTFWeb: por família, como antes', () => {
        const d = decidirEmissaoRetidos({ ...base, resultado: resultado(415.07, 1482.1) });
        expect(d.avulsos.map((a) => a.codigo)).toEqual(['1708', '5952']);
    });
});
