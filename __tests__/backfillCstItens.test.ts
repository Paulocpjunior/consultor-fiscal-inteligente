// @ts-nocheck — módulo .js do backend (sem tipos)
import { mesclarItensReprocessados, CAMPOS_BACKFILL } from '../sefaz-backend/backfill-cst-itens.js';

/**
 * BACKFILL DE CAMPO DE ITEM a partir do XML no Storage.
 *
 * Duas vezes o mesmo defeito (CST do IPI #563, CST de PIS/COFINS #586): o campo
 * SEMPRE esteve no XML e o importer não lia. Quem já estava capturado ficou sem.
 *
 * A mesclagem é onde mora o risco: reprocessar NÃO pode reescrever histórico
 * fiscal, só completá-lo. Estes testes travam as três regras.
 */
const item = (over = {}) => ({ nItem: '1', cfop: '1102', vProd: 100, ...over });

describe('mesclarItensReprocessados — só completa, nunca reescreve', () => {
    it('preenche o campo que faltava', () => {
        const r = mesclarItensReprocessados(
            [item()],
            [item({ cstPis: '50', vBcPis: 100 })],
        );
        expect(r.itens[0].cstPis).toBe('50');
        expect(r.itens[0].vBcPis).toBe(100);
        expect(r.camposPreenchidos).toBe(2);
    });

    // REGRA 1 — histórico fiscal não se reescreve.
    it('NÃO sobrescreve valor já gravado, mesmo se o XML disser outra coisa', () => {
        const r = mesclarItensReprocessados(
            [item({ cstPis: '70' })],
            [item({ cstPis: '50' })],
        );
        expect(r.itens).toBeNull();          // nada a fazer
        expect(r.camposPreenchidos).toBe(0);
    });

    // REGRA 2 — campo fiscal não recebe default.
    it('item cujo XML não traz o bloco continua SEM o campo (não vira "" nem 0)', () => {
        const r = mesclarItensReprocessados([item()], [item()]);
        expect(r.itens).toBeNull();
    });

    it('preserva os campos que já existiam no item', () => {
        const r = mesclarItensReprocessados(
            [item({ vProd: 999, cst: '00' })],
            [item({ cstPis: '50' })],
        );
        expect(r.itens[0].vProd).toBe(999);
        expect(r.itens[0].cst).toBe('00');
    });

    it('casa pelo nItem, não pela posição — item filtrado não desloca o resto', () => {
        const atuais = [item({ nItem: '2' }), item({ nItem: '5' })];
        const doXml = [
            item({ nItem: '1', cstPis: '70' }),
            item({ nItem: '2', cstPis: '50' }),
            item({ nItem: '5', cstPis: '73' }),
        ];
        const r = mesclarItensReprocessados(atuais, doXml);
        expect(r.itens[0].cstPis).toBe('50');
        expect(r.itens[1].cstPis).toBe('73');
    });

    it('item do XML sem correspondente no doc é IGNORADO — completar ≠ acrescentar', () => {
        const r = mesclarItensReprocessados(
            [item({ nItem: '1' })],
            [item({ nItem: '1', cstPis: '50' }), item({ nItem: '2', cstPis: '50' })],
        );
        expect(r.itens.length).toBe(1);
    });

    it('doc sem itens ou XML sem itens: não faz nada', () => {
        expect(mesclarItensReprocessados([], [item({ cstPis: '50' })]).itens).toBeNull();
        expect(mesclarItensReprocessados([item()], []).itens).toBeNull();
        expect(mesclarItensReprocessados(null, null).itens).toBeNull();
    });

    it('é IDEMPOTENTE — a segunda passada não muda nada', () => {
        const doXml = [item({ cstPis: '50', cstCofins: '50' })];
        const um = mesclarItensReprocessados([item()], doXml);
        const dois = mesclarItensReprocessados(um.itens, doXml);
        expect(dois.itens).toBeNull();
    });

    it('cobre também os campos do IPI (mesma armadilha, #563)', () => {
        const r = mesclarItensReprocessados(
            [item()],
            [item({ cstIpi: '50', cEnqIpi: '999', vBcIpi: 100 })],
        );
        expect(r.itens[0].cstIpi).toBe('50');
        expect(r.itens[0].cEnqIpi).toBe('999');
        expect(CAMPOS_BACKFILL).toContain('cstIpi');
    });
});
