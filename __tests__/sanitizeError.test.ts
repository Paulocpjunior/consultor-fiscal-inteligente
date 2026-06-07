// @ts-nocheck
import { sanitizeError } from '../sefaz-backend/sanitize-error.js';

describe('sanitizeError', () => {
    it('mensagem fiscal curta passa intacta', () => {
        const r = sanitizeError(new Error('CNPJ duplicado'));
        expect(r.error).toBe('CNPJ duplicado');
        expect(r.requestId).toMatch(/^[a-f0-9]{8}$/);
    });

    it('mensagem com path absoluto vira generica', () => {
        const r = sanitizeError(new Error('ENOENT: no such file /opt/secrets/cert.pem'));
        expect(r.error).toMatch(/Erro interno \(ref [a-f0-9]{8}\)/);
        expect(r.error).not.toMatch(/opt/);
    });

    it('mensagem com token longo vira generica', () => {
        const r = sanitizeError(new Error('Auth failed: token abc1234567890123456789xyz invalido'));
        expect(r.error).toMatch(/Erro interno/);
    });

    it('mensagem mencionando Secret vira generica', () => {
        const r = sanitizeError(new Error('Secret cfi-cert-key nao encontrado'));
        expect(r.error).toMatch(/Erro interno/);
    });

    it('mensagem com path GCP secret vira generica', () => {
        const r = sanitizeError(new Error('Falha em projects/consultorfiscalapp/secrets/cert'));
        expect(r.error).toMatch(/Erro interno/);
    });

    it('mensagem muito longa vira generica', () => {
        const r = sanitizeError(new Error('a'.repeat(500)));
        expect(r.error).toMatch(/Erro interno/);
    });

    it('mensagem vazia vira generica', () => {
        const r = sanitizeError(new Error(''));
        expect(r.error).toMatch(/Erro interno/);
    });

    it('aceita string direto', () => {
        const r = sanitizeError('Saldo insuficiente');
        expect(r.error).toBe('Saldo insuficiente');
    });

    it('aceita objeto desconhecido sem quebrar', () => {
        const r = sanitizeError({ unknown: 'thing' });
        expect(r.error).toMatch(/Erro interno/);
    });

    it('requestIds diferentes em chamadas distintas', () => {
        const r1 = sanitizeError('a');
        const r2 = sanitizeError('a');
        expect(r1.requestId).not.toBe(r2.requestId);
    });
});
