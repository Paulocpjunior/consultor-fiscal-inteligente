// @ts-ignore modulo .js puro
import { criarErroDuplicidadeDas, encontrarConflitoDasAvulso } from '../sefaz-backend/das-duplicidade-utils.js';

const baseDoc = {
    id: 'das1',
    empresaId: 'emp1',
    empresaCnpj: '28810670000192',
    empresaNome: 'Empresa Teste',
    competencia: '2026-05',
    valor: 4652.41,
};

describe('das-duplicidade-utils', () => {
    it('bloqueia avulso quando ja existe regular pendente na competencia', () => {
        const conflito = encontrarConflitoDasAvulso([
            { ...baseDoc, tipo: 'regular', statusPagamento: 'pendente', valor: 500 },
        ], { competencia: '2026-05', valor: 4652.41 });

        expect(conflito?.id).toBe('das1');
    });

    it('bloqueia avulso quando ja existe regular pago com mesmo valor', () => {
        const conflito = encontrarConflitoDasAvulso([
            { ...baseDoc, tipo: 'regular', statusPagamento: 'pago', valor: '4.652,41' },
        ], { competencia: '2026-05', valor: 4652.41 });

        expect(conflito?.id).toBe('das1');
    });

    it('bloqueia avulso duplicado pendente com mesmo valor', () => {
        const conflito = encontrarConflitoDasAvulso([
            { ...baseDoc, tipo: 'avulso', statusPagamento: 'pendente', valor: 4652.41 },
        ], { competencia: '2026-05', valor: '4.652,41' });

        expect(conflito?.id).toBe('das1');
    });

    it('permite complemento avulso com valor diferente quando regular ja esta pago', () => {
        const conflito = encontrarConflitoDasAvulso([
            { ...baseDoc, tipo: 'regular', statusPagamento: 'pago', valor: 4652.41 },
        ], { competencia: '2026-05', valor: 120 });

        expect(conflito).toBeNull();
    });

    // ═══ 03/09: a competência era comparada `!==` CRUA ═════════════════════
    // Um DAS gravado `2026-05` e o pedido chegando `05/2026` nunca se
    // encontravam — a duplicata passava pela trava que existe para barrá-la.
    it('acha o conflito quando a competência vem em OUTRA forma', () => {
        for (const forma of ['05/2026', '202605', '2026-05-15']) {
            const conflito = encontrarConflitoDasAvulso([
                { ...baseDoc, tipo: 'regular', statusPagamento: 'pendente' },
            ], { competencia: forma, valor: 4652.41 });
            expect({ forma, id: conflito?.id }).toEqual({ forma, id: 'das1' });
        }
    });

    it('competência ilegível de um dos lados NÃO é "igual"', () => {
        expect(encontrarConflitoDasAvulso([
            { ...baseDoc, tipo: 'regular', statusPagamento: 'pendente', competencia: 'maio' },
        ], { competencia: 'maio', valor: 4652.41 })).toBeNull();
    });

    it('monta erro 409 com id da guia existente', () => {
        const err = criarErroDuplicidadeDas({ ...baseDoc, tipo: 'regular', statusPagamento: 'pendente' });
        expect(err.httpStatus).toBe(409);
        expect(err.code).toBe('DAS_DUPLICADO');
        expect(err.dasExistenteId).toBe('das1');
        expect(err.message).toMatch(/Ja existe DAS regular pendente/);
    });
});
