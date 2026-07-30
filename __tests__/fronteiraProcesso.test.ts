/**
 * O CORTE oficial CFI × e-Fiscal (Paulo, 30/07: "tem que ter um corte").
 * Trava a integridade da fonte única: toda tarefa diz onde e como; o Simples
 * tem UMA exceção no e-Fiscal (DeSTDA); no Lucro, o que fica no e-Fiscal é
 * exatamente o bloco de escrituração/SPED.
 */
import { FRONTEIRA, REGRA_DE_BOLSO, resumoFronteira } from '../services/fronteiraProcesso';

describe('fronteiraProcesso — o corte CFI × e-Fiscal', () => {
    it('toda tarefa tem onde e como preenchidos (sem "procure em")', () => {
        for (const regime of ['simples', 'lucro'] as const) {
            for (const l of FRONTEIRA[regime]) {
                expect(l.tarefa.length).toBeGreaterThan(3);
                expect(['cfi', 'efiscal']).toContain(l.onde);
                expect(l.como.length).toBeGreaterThan(10);
            }
        }
    });

    it('Simples: e-Fiscal só na exceção DeSTDA — todo o resto é CFI', () => {
        const noEfiscal = FRONTEIRA.simples.filter((l) => l.onde === 'efiscal');
        expect(noEfiscal).toHaveLength(1);
        expect(noEfiscal[0].tarefa).toMatch(/DeSTDA/);
    });

    it('Lucro: o que fica no e-Fiscal é o bloco de escrituração/SPED', () => {
        const noEfiscal = FRONTEIRA.lucro.filter((l) => l.onde === 'efiscal').map((l) => l.tarefa);
        expect(noEfiscal).toHaveLength(4);
        expect(noEfiscal.join(' ')).toMatch(/livros ICMS\/IPI/i);
        expect(noEfiscal.join(' ')).toMatch(/EFD ICMS\/IPI/);
        expect(noEfiscal.join(' ')).toMatch(/EFD Contribuições/);
        expect(noEfiscal.join(' ')).toMatch(/Apuração de ICMS/);
    });

    it('a ponte (.FML) é tarefa do CFI, não do e-Fiscal', () => {
        const ponte = FRONTEIRA.lucro.find((l) => /FML/.test(l.tarefa));
        expect(ponte?.onde).toBe('cfi');
    });

    it('resumoFronteira soma certo (placar do corte)', () => {
        const s = resumoFronteira('simples');
        expect(s.cfi + s.efiscal).toBe(s.total);
        expect(s.cfi).toBe(FRONTEIRA.simples.length - 1);
        const l = resumoFronteira('lucro');
        expect(l.efiscal).toBe(4);
    });

    it('regra de bolso cita os dois sistemas', () => {
        expect(REGRA_DE_BOLSO).toMatch(/CFI/);
        expect(REGRA_DE_BOLSO).toMatch(/e-Fiscal/);
    });
});
