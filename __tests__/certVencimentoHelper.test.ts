/**
 * Testes da classificação de vencimento de certificados digitais.
 * Cert vencido = SERPRO/SEFAZ/e-CAC param sem aviso. Errar fronteira = não alerta.
 */
// @ts-expect-error — módulo .js puro
import { faixaDeVencimento, urgenciaFaixa, diasAteVencimento } from '../sefaz-backend/cert-vencimento-helper.js';

describe('faixaDeVencimento — fronteiras críticas', () => {
    it('dias > 30 → null (sem alerta)', () => {
        expect(faixaDeVencimento(31)).toBeNull();
        expect(faixaDeVencimento(365)).toBeNull();
    });

    it('dias = 30 → faixa "30"', () => {
        expect(faixaDeVencimento(30)).toBe('30');
    });

    it('dias = 16..30 → faixa "30"', () => {
        expect(faixaDeVencimento(16)).toBe('30');
        expect(faixaDeVencimento(20)).toBe('30');
    });

    it('dias = 15 → faixa "15"', () => {
        expect(faixaDeVencimento(15)).toBe('15');
    });

    it('dias 8..15 → faixa "15"', () => {
        expect(faixaDeVencimento(8)).toBe('15');
        expect(faixaDeVencimento(10)).toBe('15');
    });

    it('dias = 7 → faixa "7"', () => {
        expect(faixaDeVencimento(7)).toBe('7');
    });

    it('dias 4..7 → faixa "7"', () => {
        expect(faixaDeVencimento(4)).toBe('7');
        expect(faixaDeVencimento(5)).toBe('7');
    });

    it('dias 2..3 → faixa "3"', () => {
        expect(faixaDeVencimento(2)).toBe('3');
        expect(faixaDeVencimento(3)).toBe('3');
    });

    it('dias = 1 → faixa "1" (vence amanhã)', () => {
        expect(faixaDeVencimento(1)).toBe('1');
    });

    it('dias = 0 → expirado (vence hoje conta como expirado pra emissão)', () => {
        expect(faixaDeVencimento(0)).toBe('expirado');
    });

    it('dias < 0 → expirado', () => {
        expect(faixaDeVencimento(-1)).toBe('expirado');
        expect(faixaDeVencimento(-100)).toBe('expirado');
    });

    it('null/undefined/NaN → null', () => {
        expect(faixaDeVencimento(null)).toBeNull();
        expect(faixaDeVencimento(undefined)).toBeNull();
        expect(faixaDeVencimento(NaN)).toBeNull();
        expect(faixaDeVencimento(Infinity)).toBeNull();
    });
});

describe('urgenciaFaixa — visualização', () => {
    it('expirado → severidade crítica vermelha', () => {
        const u = urgenciaFaixa('expirado');
        expect(u.severidade).toBe('critica');
        expect(u.cor).toBe('#dc2626');
    });

    it('faixa "1" → CRÍTICO', () => {
        expect(urgenciaFaixa('1').label).toBe('CRÍTICO');
    });

    it('faixa "3" → CRÍTICO', () => {
        expect(urgenciaFaixa('3').label).toBe('CRÍTICO');
    });

    it('faixa "7" → URGENTE laranja', () => {
        expect(urgenciaFaixa('7').label).toBe('URGENTE');
        expect(urgenciaFaixa('7').severidade).toBe('alta');
    });

    it('faixa "15" → ATENÇÃO', () => {
        expect(urgenciaFaixa('15').label).toBe('ATENÇÃO');
    });

    it('faixa "30" → ATENÇÃO', () => {
        expect(urgenciaFaixa('30').label).toBe('ATENÇÃO');
    });

    it('null (cert >30d) → OK verde', () => {
        const u = urgenciaFaixa(null);
        expect(u.label).toBe('OK');
        expect(u.severidade).toBe('baixa');
    });
});

describe('diasAteVencimento — cálculo', () => {
    it('aceita string ISO e Date', () => {
        const agora = new Date('2026-06-06T12:00:00Z');
        expect(diasAteVencimento('2026-06-16T12:00:00Z', agora)).toBe(10);
        expect(diasAteVencimento(new Date('2026-06-16T12:00:00Z'), agora)).toBe(10);
    });

    it('data passada → negativo', () => {
        const agora = new Date('2026-06-06T12:00:00Z');
        expect(diasAteVencimento('2026-06-01T12:00:00Z', agora)).toBe(-5);
    });

    it('mesmo dia → 0', () => {
        const agora = new Date('2026-06-06T12:00:00Z');
        expect(diasAteVencimento('2026-06-06T12:00:00Z', agora)).toBe(0);
    });

    it('null/inválido → null', () => {
        expect(diasAteVencimento(null)).toBeNull();
        expect(diasAteVencimento('')).toBeNull();
        expect(diasAteVencimento('lixo')).toBeNull();
    });
});

describe('integração: cert real expirando em 5 dias', () => {
    const agora = new Date('2026-06-06T12:00:00Z');
    const notAfter = '2026-06-11T12:00:00Z'; // +5 dias

    it('classifica como faixa "7" → URGENTE', () => {
        const dias = diasAteVencimento(notAfter, agora);
        expect(dias).toBe(5);
        const faixa = faixaDeVencimento(dias);
        expect(faixa).toBe('7');
        expect(urgenciaFaixa(faixa).label).toBe('URGENTE');
    });
});
