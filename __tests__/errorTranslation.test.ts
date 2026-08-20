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

    it('mensagem desconhecida preserva o motivo cru, mas com a acao', () => {
        // Mudou em 20/08: antes devolvia a frase crua e sem acao — e uma frase
        // neutra ("Falhou o passo X") o toast pintava de VERDE.
        const r = getFriendlyErrorMessage(new Error('Erro absurdo nao mapeado'));
        expect(r).toContain('Erro absurdo nao mapeado');
        expect(r).toContain('Não foi possível concluir');
        expect(r).toContain('avise o administrador');
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

describe('IA: crédito esgotado e chave recusada (casos reais de 20/08)', () => {
    it('crédito esgotado NÃO manda esperar — manda recarregar', () => {
        const msg = getFriendlyErrorMessage(new Error('429 Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing.'));
        expect(msg).toContain('créditos da IA acabaram');
        expect(msg).toContain('recarregar');
        expect(msg).not.toContain('aguarde alguns instantes');
    });

    it('cota de verdade (sem billing) continua mandando aguardar', () => {
        expect(getFriendlyErrorMessage(new Error('429 Quota exceeded')))
            .toContain('aguarde alguns instantes');
    });

    it('chave irrestrita/recusada aponta o painel de chaves', () => {
        for (const m of ['API key not valid', 'API_KEY_INVALID', 'unrestricted API key']) {
            expect(getFriendlyErrorMessage(new Error(m))).toContain('aistudio.google.com/apikey');
        }
    });

    // INVARIANTE: tudo que o tradutor produz é falha, então o toast tem que
    // pintar de vermelho. Sem isto, uma mensagem nova sem palavra de erro
    // volta a sair com ✓ verde (foi o que aconteceu com "créditos acabaram").
    it('TODA saída do tradutor é classificada como ERRO pelo toast', () => {
        const { tomDoToast } = require('../services/toastTone');
        const entradas = [
            'Your prepayment credits are depleted.',
            'API key not valid',
            '429 Quota exceeded',
            '503 Service Unavailable',
            '400 Invalid argument',
            '405 Not Allowed',
            '500',
            'Failed to fetch',
            'DOMException pattern',
            'API Key contains invalid characters',
            'API Key must be set',
            'bloqueada pelo filtro de segurança SAFETY',
            'coisa totalmente desconhecida',
        ];
        for (const e of entradas) {
            const msg = getFriendlyErrorMessage(new Error(e));
            expect([msg, tomDoToast(msg)]).toEqual([msg, 'erro']);
        }
    });
});
