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

    it('monta erro 409 com id da guia existente', () => {
        const err = criarErroDuplicidadeDas({ ...baseDoc, tipo: 'regular', statusPagamento: 'pendente' });
        expect(err.httpStatus).toBe(409);
        expect(err.code).toBe('DAS_DUPLICADO');
        expect(err.dasExistenteId).toBe('das1');
        expect(err.message).toMatch(/Ja existe DAS regular pendente/);
    });
});
