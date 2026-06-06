/**
 * Testes do cruzamento EFD-Reinf × DCTFWeb (retenções).
 * Mesma filosofia do dctfwebConference: 0×0 = ok (sem divergência fake);
 * Reinf>0 e DCTFWeb=0 -> 'sem-dctfweb' severidade alta (recolhimento a menor).
 */
import {
    extrairRetencoesReinf,
    cruzarRetencoes,
    type RetencoesPorFamilia,
} from '../services/efdReinfConference';

const zero: RetencoesPorFamilia = { INSS: 0, IRRF: 0, CSRF: 0 };

describe('extrairRetencoesReinf — mapeia totais do parser p/ famílias', () => {
    it('soma INSS principal + adicional; CSRF agrega CSLL+PIS+COFINS', () => {
        const r = extrairRetencoesReinf({ inssRetPrinc: 523.95, inssRetAdic: 10.00 });
        expect(r.INSS).toBe(533.95);
        expect(r.IRRF).toBe(0);
        expect(r.CSRF).toBe(0);
    });
    it('CSRF = CSLL + PIS + COFINS', () => {
        const r = extrairRetencoesReinf({ csll: 134.00, pis: 87.10, cofins: 401.85 });
        expect(r.CSRF).toBe(622.95);
    });
    it('totais nulos -> tudo 0', () => {
        expect(extrairRetencoesReinf(null)).toEqual(zero);
    });
});

describe('cruzarRetencoes — casos centrais', () => {
    it('INSS bate dos dois lados -> ok, sem divergência', () => {
        const reinf = { ...zero, INSS: 523.95 };
        const dctf = { ...zero, INSS: 523.95 };
        const r = cruzarRetencoes(reinf, dctf, '2026-04');
        expect(r.temDivergencia).toBe(false);
        expect(r.resumo.ok).toBe(3);
        expect(r.divergencias.find((d) => d.familia === 'INSS')!.status).toBe('ok');
    });

    it('Reinf declara INSS mas DCTFWeb não tem -> sem-dctfweb, severidade alta', () => {
        const reinf = { ...zero, INSS: 523.95 };
        const r = cruzarRetencoes(reinf, zero, '2026-04');
        const inss = r.divergencias.find((d) => d.familia === 'INSS')!;
        expect(inss.status).toBe('sem-dctfweb');
        expect(inss.severidade).toBe('alta');
        expect(r.temDivergencia).toBe(true);
    });

    it('DCTFWeb tem débito sem evento Reinf -> sem-reinf, severidade média', () => {
        const dctf = { ...zero, INSS: 523.95 };
        const r = cruzarRetencoes(zero, dctf, '2026-04');
        const inss = r.divergencias.find((d) => d.familia === 'INSS')!;
        expect(inss.status).toBe('sem-reinf');
        expect(inss.severidade).toBe('media');
    });

    it('diferença pequena (centavos) dentro da tolerância -> ok', () => {
        const r = cruzarRetencoes({ ...zero, INSS: 523.95 }, { ...zero, INSS: 523.96 }, '2026-04');
        expect(r.divergencias.find((d) => d.familia === 'INSS')!.status).toBe('ok');
    });

    it('divergência > 10% -> severidade alta', () => {
        const r = cruzarRetencoes({ ...zero, INSS: 1000 }, { ...zero, INSS: 800 }, '2026-04');
        const inss = r.divergencias.find((d) => d.familia === 'INSS')!;
        expect(inss.status).toBe('divergente');
        expect(inss.severidade).toBe('alta');
    });

    it('tudo zero -> 3 famílias ok, sem divergência fake', () => {
        const r = cruzarRetencoes(zero, zero, '2026-04');
        expect(r.resumo.ok).toBe(3);
        expect(r.temDivergencia).toBe(false);
        expect(r.totalReinf).toBe(0);
    });

    it('CSRF cruza igual às demais famílias', () => {
        const r = cruzarRetencoes({ ...zero, CSRF: 621.29 }, { ...zero, CSRF: 621.29 }, '2026-04');
        expect(r.divergencias.find((d) => d.familia === 'CSRF')!.status).toBe('ok');
    });
});
