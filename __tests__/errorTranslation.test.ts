/**
 * Testes do tradutor de erros (mensagens cripticas → amigaveis).
 *
 * Validamos cada categoria de erro que o usuario pode receber consultando
 * a API Gemini ou tocando endpoints internos, garantindo que o usuario
 * VE uma mensagem util em vez do `error.message` cru.
 */
import { getFriendlyErrorMessage } from '../services/errorTranslation';

describe('getFriendlyErrorMessage', () => {
    it('traduz quota 429 em mensagem amigavel', () => {
        const r = getFriendlyErrorMessage(new Error('429 Quota exceeded'));
        expect(r).toContain('Limite de consultas excedido');
        expect(r).toContain('429');
    });

    it('traduz 503 service unavailable', () => {
        const r = getFriendlyErrorMessage(new Error('503 Service Unavailable'));
        expect(r).toContain('temporariamente indisponível');
    });

    it('traduz 400 invalid argument', () => {
        const r = getFriendlyErrorMessage(new Error('400 Invalid argument: foo'));
        expect(r).toContain('inválida ou incompleta');
    });

    it('traduz 500 generico', () => {
        const r = getFriendlyErrorMessage(new Error('500 Internal Server Error'));
        expect(r).toContain('Erro interno');
    });

    it('traduz Failed to fetch (offline)', () => {
        const r = getFriendlyErrorMessage(new Error('Failed to fetch'));
        expect(r).toContain('conexão');
    });

    it('traduz API key faltando', () => {
        const r = getFriendlyErrorMessage(new Error('API Key must be set'));
        expect(r).toContain('VITE_GEMINI_API_KEY');
    });

    it('traduz bloqueio do filtro de seguranca', () => {
        const r = getFriendlyErrorMessage(new Error('Resposta bloqueada por SAFETY filter'));
        expect(r).toContain('filtro de segurança');
    });

    it('mensagem desconhecida cai no fallback (retorna a propria)', () => {
        const r = getFriendlyErrorMessage(new Error('Erro absurdo nao mapeado'));
        expect(r).toBe('Erro absurdo nao mapeado');
    });

    it('error sem message usa fallback generico', () => {
        const r = getFriendlyErrorMessage({});
        expect(r).toContain('inesperado');
    });

    it('error null nao quebra', () => {
        const r = getFriendlyErrorMessage(null);
        expect(r).toContain('inesperado');
    });
});
