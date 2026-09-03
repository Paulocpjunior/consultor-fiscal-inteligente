// ═══════════════════════════════════════════════════════════════════════════
// FERIADOS NACIONAIS (backend) — a segunda de Carnaval entrou em 03/09.
//
// Ela não é feriado por lei, mas os BANCOS não abrem — e guia não se paga com
// o banco fechado. Antecipar um vencimento para a segunda de Carnaval era
// mandar pagar num dia sem compensação. Feriado estadual/municipal continua
// FORA (documentado no módulo) — não está coberto, e cobrir é decisão do dono.
// ═══════════════════════════════════════════════════════════════════════════
// @ts-expect-error — modulo .js puro
import { feriadosDoAno, ehFeriadoNacional, ehDiaUtil } from '../sefaz-backend/feriados-nacionais.js';

describe('2027 — Páscoa 28/03/2027', () => {
    const f = feriadosDoAno(2027);
    it('Carnaval: segunda 08/02 e terça 09/02', () => {
        expect(f.has('02-08')).toBe(true);
        expect(f.has('02-09')).toBe(true);
    });
    it('Sexta Santa 26/03 e Corpus Christi 27/05', () => {
        expect(f.has('03-26')).toBe(true);
        expect(f.has('05-27')).toBe(true);
    });
    it('a segunda de Carnaval NÃO é dia útil de pagamento', () => {
        expect(ehDiaUtil(new Date(2027, 1, 8))).toBe(false);
        expect(ehFeriadoNacional(new Date(2027, 1, 8))).toBe(true);
        // A quarta-feira de cinzas continua útil (bancos abrem ao meio-dia,
        // compensação normal).
        expect(ehDiaUtil(new Date(2027, 1, 10))).toBe(true);
    });
});

describe('2026 — Páscoa 05/04/2026 (o ano corrente)', () => {
    it('segunda 16/02 e terça 17/02 de Carnaval', () => {
        const f = feriadosDoAno(2026);
        expect(f.has('02-16')).toBe(true);
        expect(f.has('02-17')).toBe(true);
    });
});

describe('escopo declarado', () => {
    it('9 de julho (feriado ESTADUAL de SP) NÃO é coberto — e o módulo diz isso', () => {
        expect(feriadosDoAno(2026).has('07-09')).toBe(false);
        const fs = require('fs');
        const src = fs.readFileSync(require('path').join(__dirname, '..', 'sefaz-backend', 'feriados-nacionais.js'), 'utf8');
        expect(src).toMatch(/ESTADUAIS[\s\S]*MUNICIPAIS[\s\S]*NÃO estão cobertos/);
    });
});
