import { sanitizeForFirestore } from '../services/firestoreSanitize';

describe('sanitizeForFirestore', () => {
    it('remove campos undefined de objetos aninhados', () => {
        const sanitized = sanitizeForFirestore({
            empresaId: 'prospect_46317827000124',
            competencia: undefined,
            obrigacoes: [{
                sigla: 'EFD',
                dataEntrega: undefined,
                observacao: 'Ausência do Bloco K em 01/2026',
            }],
            planoAcao: [{
                descricao: 'Regularizar obrigação',
                prazo: undefined,
            }],
        });

        expect(sanitized).toEqual({
            empresaId: 'prospect_46317827000124',
            obrigacoes: [{
                sigla: 'EFD',
                observacao: 'Ausência do Bloco K em 01/2026',
            }],
            planoAcao: [{
                descricao: 'Regularizar obrigação',
            }],
        });
    });

    it('preserva arrays convertendo itens undefined para null', () => {
        const sanitized = sanitizeForFirestore({
            valores: [1, undefined, { ok: true, vazio: undefined }],
        });

        expect(sanitized).toEqual({
            valores: [1, null, { ok: true }],
        });
    });
});
