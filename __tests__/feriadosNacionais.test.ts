import { feriadosDoAno, ehFeriadoNacional, ehDiaUtil, prorrogarParaDiaUtil } from '../services/feriadosNacionais';

describe('feriadosNacionais', () => {
    describe('feriadosDoAno', () => {
        it('inclui feriados fixos', () => {
            const f = feriadosDoAno(2026);
            expect(f.has('01-01')).toBe(true);  // Confraternização
            expect(f.has('04-21')).toBe(true);  // Tiradentes
            expect(f.has('05-01')).toBe(true);  // Trabalho
            expect(f.has('09-07')).toBe(true);  // Independência
            expect(f.has('10-12')).toBe(true);  // N. Sra. Aparecida
            expect(f.has('11-02')).toBe(true);  // Finados
            expect(f.has('11-15')).toBe(true);  // República
            expect(f.has('11-20')).toBe(true);  // Consciência Negra
            expect(f.has('12-25')).toBe(true);  // Natal
        });

        it('calcula Páscoa 2026 corretamente (05/04/2026)', () => {
            // Domingo de Páscoa 2026 = 5 de abril
            // Sexta Santa = 03/04, Carnaval (terça) = 17/02, Corpus Christi = 04/06
            const f = feriadosDoAno(2026);
            expect(f.has('04-03')).toBe(true);  // Sexta-feira Santa
            expect(f.has('02-17')).toBe(true);  // Carnaval (terça)
            expect(f.has('06-04')).toBe(true);  // Corpus Christi
        });

        it('calcula Páscoa 2024 corretamente (31/03/2024)', () => {
            // Páscoa 2024 = 31/03 → Sexta Santa 29/03, Carnaval 13/02, Corpus 30/05
            const f = feriadosDoAno(2024);
            expect(f.has('03-29')).toBe(true);
            expect(f.has('02-13')).toBe(true);
            expect(f.has('05-30')).toBe(true);
        });
    });

    describe('ehDiaUtil', () => {
        it('sábado e domingo não são úteis', () => {
            expect(ehDiaUtil(new Date(2026, 5, 6))).toBe(false);   // sábado
            expect(ehDiaUtil(new Date(2026, 5, 7))).toBe(false);   // domingo
        });
        it('feriado nacional não é útil', () => {
            expect(ehDiaUtil(new Date(2026, 11, 25))).toBe(false); // Natal (sex)
        });
        it('dia útil normal retorna true', () => {
            expect(ehDiaUtil(new Date(2026, 5, 8))).toBe(true);    // segunda 08/06
        });
    });

    describe('prorrogarParaDiaUtil', () => {
        it('mantém dia útil normal', () => {
            const r = prorrogarParaDiaUtil(new Date(2026, 5, 8));   // seg 08/06
            expect(r.getDate()).toBe(8);
            expect(r.getMonth()).toBe(5);
        });

        it('PRORROGA sábado para segunda (nunca antecipa)', () => {
            const r = prorrogarParaDiaUtil(new Date(2026, 5, 6));   // sáb 06/06
            expect(r.getDate()).toBe(8);
            expect(r.getDay()).toBe(1);
        });

        it('PRORROGA domingo para segunda', () => {
            const r = prorrogarParaDiaUtil(new Date(2026, 5, 7));   // dom 07/06
            expect(r.getDate()).toBe(8);
        });

        it('PRORROGA feriado nacional para próximo dia útil', () => {
            // 25/12/2026 é sexta (Natal) → próximo útil = segunda 28/12
            const r = prorrogarParaDiaUtil(new Date(2026, 11, 25));
            expect(r.getDate()).toBe(28);
            expect(r.getMonth()).toBe(11);
        });

        it('cenário real: DAS competência 04/2026, vencimento dia 20', () => {
            // 20/05/2026 cai em quarta-feira útil — sem alteração
            const r = prorrogarParaDiaUtil(new Date(2026, 4, 20));
            expect(r.getDate()).toBe(20);
            expect(r.getMonth()).toBe(4);
        });

        it('cenário real: FGTS competência 05/2026, vencimento dia 20/06 (sábado) → prorroga 22/06', () => {
            const r = prorrogarParaDiaUtil(new Date(2026, 5, 20));  // sáb
            expect(r.getDate()).toBe(22);
            expect(r.getMonth()).toBe(5);
        });

        it('cenário real: DCTFWeb competência 03/2026 dia 15/04 cai em quarta — sem alteração', () => {
            const r = prorrogarParaDiaUtil(new Date(2026, 3, 15));
            expect(r.getDate()).toBe(15);
        });
    });
});
