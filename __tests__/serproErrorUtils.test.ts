// @ts-nocheck
import {
    createSerproRetryableError,
    formatSerproRetryableMessage,
    hashSerproBody,
} from '../sefaz-backend/serpro-error-utils.js';
import { errorPayload } from '../sefaz-backend/das-error-payload.js';

describe('serpro retryable errors', () => {
    const rawSerproPayload = JSON.stringify({
        contratante: { numero: '44388152000189', tipo: 2 },
        autorPedidoDados: { numero: '44388152000189', tipo: 2 },
        contribuinte: { numero: '43212877000159', tipo: 2 },
        pedidoDados: { idSistema: 'PGDASD', idServico: 'TRANSDECLARACAO11' },
    });

    it('cria mensagem retryable sem vazar payload bruto', () => {
        const err = createSerproRetryableError(500, rawSerproPayload, {
            idSistema: 'PGDASD',
            idServico: 'TRANSDECLARACAO11',
        });

        expect(err.message).toBe(formatSerproRetryableMessage(500));
        expect(err.message).toContain('SERPRO 500');
        expect(err.message).not.toContain('44388152000189');
        expect(err.message).not.toContain('43212877000159');
        expect(err.message).not.toContain('contratante');
        expect(err.code).toBe('SERPRO_RETRYABLE_ERROR');
        expect(err.retryable).toBe(true);
        expect(err.httpStatus).toBe(502);
        expect(err.serproBodyHash).toBe(hashSerproBody(rawSerproPayload));
        expect(err.serproBodyBytes).toBe(Buffer.byteLength(rawSerproPayload));
    });

    it('mantem payload HTTP do DAS limpo para erro retryable', () => {
        const err = createSerproRetryableError(500, rawSerproPayload);
        const payload = errorPayload(err);

        expect(payload).toMatchObject({
            error: err.message,
            code: 'SERPRO_RETRYABLE_ERROR',
            retryable: true,
            serproStatus: 500,
        });
        expect(JSON.stringify(payload)).not.toContain('44388152000189');
        expect(JSON.stringify(payload)).not.toContain('pedidoDados');
    });

    it('sanitiza erro legado quando o payload bruto ja veio no message', () => {
        const err = new Error(`500: ${rawSerproPayload}`);
        err.status = 500;
        const payload = errorPayload(err);

        expect(payload.error).toMatch(/Erro interno \(ref [a-f0-9]{8}\)/);
        expect(payload.error).not.toContain('44388152000189');
        expect(payload.error).not.toContain('pedidoDados');
        expect(payload.requestId).toMatch(/^[a-f0-9]{8}$/);
    });
});
