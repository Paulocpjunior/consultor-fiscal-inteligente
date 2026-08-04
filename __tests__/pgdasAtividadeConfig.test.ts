/**
 * Cadastro do código da atividade "ISS fixo (SUP)".
 *
 * O que esta trava protege: o número vai NA DECLARAÇÃO ao SERPRO e entrega ao
 * PGDAS-D não se desfaz. Cadastrar de memória é o mesmo erro que a trava do
 * bloqueio existe pra impedir — por isso a validação recusa código de retenção,
 * código já usado e número que não aparece na declaração lida.
 */
import {
    validarIdAtividadeSup, IDS_RETENCAO_ISS,
} from '../sefaz-backend/pgdas-atividade-config.js';

describe('validarIdAtividadeSup', () => {
    it('aceita um inteiro novo lido de uma declaração', () => {
        const r = validarIdAtividadeSup(16, { origem: 'declaracao', idsDeclarados: [16, 14] });
        expect(r).toEqual({ ok: true, id: 16 });
    });

    it('RECUSA os ids que já significam ISS retido pelo tomador', () => {
        for (const id of IDS_RETENCAO_ISS) {
            const r = validarIdAtividadeSup(id, { origem: 'ecac' });
            expect(r.ok).toBe(false);
            expect(r.erro).toContain('retido');
        }
    });

    it('RECUSA id que o app já usa para outra atividade', () => {
        const r = validarIdAtividadeSup(1, { origem: 'ecac' });
        expect(r.ok).toBe(false);
        expect(r.erro).toContain('já é usado');
    });

    it('RECUSA número que não aparece na declaração lida', () => {
        const r = validarIdAtividadeSup(16, { origem: 'declaracao', idsDeclarados: [14, 15] });
        expect(r.ok).toBe(false);
        expect(r.erro).toContain('não aparece na declaração');
    });

    it('sem lista de declaração, o cadastro pelo e-CAC passa (a origem fica auditada)', () => {
        expect(validarIdAtividadeSup(16, { origem: 'ecac' }).ok).toBe(true);
    });

    it('RECUSA origem desconhecida — código fiscal não se cadastra de memória', () => {
        const r = validarIdAtividadeSup(16, { origem: 'achismo' });
        expect(r.ok).toBe(false);
        expect(r.erro).toContain('de onde veio');
    });

    it('RECUSA não-inteiro, zero, negativo e texto', () => {
        for (const v of [0, -3, 16.5, 'dezesseis', null, undefined, 1000]) {
            expect(validarIdAtividadeSup(v, { origem: 'ecac' }).ok).toBe(false);
        }
    });
});
