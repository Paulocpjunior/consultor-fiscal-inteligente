/**
 * 💸 03/10 — DARF dos retidos pela conferência EFD-Reinf × DCTFWeb. Paulo:
 * "1- ambos os casos (avulso e numerado); 2- sim, trava". A emissão só libera
 * quando a conferência FECHA; o evento que o CFI não lê (R-9015 evtRetCons)
 * trava, em vez de passar como "lido".
 */
import { cruzarRetencoes, decidirEmissaoRetidos, eventosNaoLidosDoLote } from '../services/efdReinfConference';
// @ts-expect-error — módulo .js puro (sem tipos)
import { obrigacaoDoTipo } from '../sefaz-backend/envio-imposto.js';

const conf = (reinf: any, dctf: any) => cruzarRetencoes(
    { INSS: 0, IRRF: 0, CSRF: 0, ...reinf }, { INSS: 0, IRRF: 0, CSRF: 0, ...dctf }, '2026-09');

describe('a trava da emissão', () => {
    it('Reinf e DCTFWeb batem: libera IRRF 1708 e CSRF 5952 pelo valor da DCTFWeb', () => {
        const d = decidirEmissaoRetidos({ resultado: conf({ IRRF: 50, CSRF: 208.09 }, { IRRF: 50, CSRF: 208.09 }), dctfwebLido: true, eventosNaoLidos: [] });
        expect(d.pode).toBe(true);
        expect(d.avulsos).toEqual([{ familia: 'IRRF', codigo: '1708', valor: 50 }, { familia: 'CSRF', codigo: '5952', valor: 208.09 }]);
    });

    it('o caso do condomínio (DCTFWeb tem CSRF, Reinf zerado): trava, nomeando a família', () => {
        const d = decidirEmissaoRetidos({ resultado: conf({}, { CSRF: 208.09 }), dctfwebLido: true, eventosNaoLidos: [] });
        expect(d.pode).toBe(false);
        expect(d.motivo).toMatch(/CSRF/);
    });

    it('evento que o CFI não lê no lote: trava, dizendo qual', () => {
        const d = decidirEmissaoRetidos({ resultado: conf({ CSRF: 1 }, { CSRF: 1 }), dctfwebLido: true, eventosNaoLidos: ['evtRetCons'] });
        expect(d.pode).toBe(false);
        expect(d.motivo).toMatch(/evtRetCons/);
    });

    it('DCTFWeb não lida, ou nada a recolher: trava', () => {
        expect(decidirEmissaoRetidos({ resultado: null, dctfwebLido: false, eventosNaoLidos: [] }).pode).toBe(false);
        expect(decidirEmissaoRetidos({ resultado: conf({}, {}), dctfwebLido: true, eventosNaoLidos: [] }).pode).toBe(false);
    });

    it('INSS retido: só no DARF numerado (não vira avulso)', () => {
        const d = decidirEmissaoRetidos({ resultado: conf({ INSS: 300 }, { INSS: 300 }), dctfwebLido: true, eventosNaoLidos: [] });
        expect(d.pode).toBe(true);
        expect(d.avulsos).toEqual([]);
        expect(d.inssSoNumerado).toBe(300);
    });
});

describe('evento não lido e o tipo do envio', () => {
    it('evento reconhecido só pelo nome (sem código) conta como NÃO lido', () => {
        expect(eventosNaoLidosDoLote([
            { codigo: 'R-4020', schemaToken: 'evt4020PagtoBeneficiarioPJ', ok: true },
            { codigo: null, schemaToken: 'evtRetCons', ok: true },
            { codigo: null, schemaToken: 'lixo', ok: false },
        ])).toEqual(['evtRetCons']);
    });

    it('"DARF RETIDOS" baixa a obrigação da DCTFWeb (e não PIS/COFINS nem CSLL)', () => {
        expect(obrigacaoDoTipo('DARF RETIDOS')).toBe('DCTFWEB');
    });
});
