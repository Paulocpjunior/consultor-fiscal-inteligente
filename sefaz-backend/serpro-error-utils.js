import { createHash } from 'crypto';

const DEFAULT_RETRYABLE_MESSAGE =
    'servico temporariamente indisponivel ou recusou a transmissao. ' +
    'Tente novamente em alguns minutos. Se persistir, confira a declaracao no PGDAS-D/e-CAC.';

export function hashSerproBody(body) {
    const txt = typeof body === 'string' ? body : JSON.stringify(body || '');
    if (!txt) return '';
    return createHash('sha256').update(txt).digest('hex').slice(0, 16);
}

export function formatSerproRetryableMessage(status) {
    const httpStatus = Number(status) || 0;
    if (httpStatus === 429) {
        return 'SERPRO 429: limite temporario de chamadas atingido. Aguarde alguns minutos e tente novamente.';
    }
    return `SERPRO ${httpStatus || 'indisponivel'}: ${DEFAULT_RETRYABLE_MESSAGE}`;
}

export function createSerproRetryableError(status, body, meta = {}) {
    const err = new Error(formatSerproRetryableMessage(status));
    const bodyTxt = typeof body === 'string' ? body : JSON.stringify(body || '');
    err.name = 'SerproRetryableError';
    err.status = Number(status) || 0;
    err.httpStatus = err.status === 429 ? 429 : 502;
    err.code = 'SERPRO_RETRYABLE_ERROR';
    err.retryable = true;
    err.serproStatus = err.status;
    err.serproMessage = err.message;
    err.serproBodyHash = hashSerproBody(bodyTxt);
    err.serproBodyBytes = Buffer.byteLength(bodyTxt);
    err.serproMeta = meta;
    return err;
}
