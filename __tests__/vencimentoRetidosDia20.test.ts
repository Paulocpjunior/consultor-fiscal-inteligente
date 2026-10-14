/**
 * 📅 CSRF E IRRF RETIDOS VENCEM DIA 20 — TODOS OS CÓDIGOS (14/10).
 *
 * Paulo, CASA DA CRIANÇA BETINHO (62.827.860/0001-50) · 09/2026: os DARF
 * 5960 (COFINS retida) e 5979 (PIS retido) saíram com "pagar até 30/10" e
 * MULTA (785,85 + 25,93 = 811,78) — o código não estava na lista do dia 20 e
 * caía no "último dia útil do mês". A CSRF retida vence no dia 20 (Lei
 * 10.833/2003, art. 35), como o IRRF.
 *
 * Fatos cobrados: 5952/5960/5979/5987 e 1708/8045 vencem 20/10/2026 na
 * competência 09/2026 — inclusive quando o tributo vem nomeado "PIS"/"COFINS"
 * (o retido não é o de faturamento); o PIS/COFINS de faturamento segue no 25.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { calcularVencimentoDarf } from '../sefaz-backend/darf-payload-builder.js';

describe('retidos: dia 20 do mês seguinte', () => {
    it.each([
        ['5960', 'COFINS'], ['5979', 'PIS'], ['5987', 'CSLL'], ['5952', 'CSRF'], ['1708', 'IRRF'], ['8045', 'IRRF'],
    ])('%s (%s) · 09/2026 → 20/10/2026', (codigo, tributo) => {
        expect(calcularVencimentoDarf('2026-09', tributo, 'mensal', codigo)).toBe('2026-10-20');
    });
});

describe('o de faturamento não muda', () => {
    it.each([['8109', 'PIS'], ['2172', 'COFINS']])('%s (%s) · 09/2026 → dia 25, antecipado (23/10/2026)', (codigo, tributo) => {
        expect(calcularVencimentoDarf('2026-09', tributo, 'mensal', codigo)).toBe('2026-10-23');
    });
});
