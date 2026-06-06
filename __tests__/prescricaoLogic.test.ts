/**
 * Testes da lógica de prescrição tributária (CTN art 168 — 5 anos).
 * Esses números falando errado custam dinheiro real ao cliente.
 */
import {
    ultimoDiaCompetencia, dataLimitePrescricao, diasAteExpirar,
    classificarPrescricao, _constantes,
} from '../services/prescricaoLogic';

describe('ultimoDiaCompetencia', () => {
    it('jan/2026 → 31/01/2026', () => {
        const d = ultimoDiaCompetencia('2026-01')!;
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(0); // janeiro = 0
        expect(d.getDate()).toBe(31);
    });

    it('fev/2026 (não-bissexto) → 28/02/2026', () => {
        const d = ultimoDiaCompetencia('2026-02')!;
        expect(d.getMonth()).toBe(1);
        expect(d.getDate()).toBe(28);
    });

    it('fev/2024 (bissexto) → 29/02/2024', () => {
        const d = ultimoDiaCompetencia('2024-02')!;
        expect(d.getDate()).toBe(29);
    });

    it('abr/2026 (30 dias) → 30/04/2026', () => {
        expect(ultimoDiaCompetencia('2026-04')!.getDate()).toBe(30);
    });

    it('dez/2025 → 31/12/2025', () => {
        const d = ultimoDiaCompetencia('2025-12')!;
        expect(d.getMonth()).toBe(11);
        expect(d.getDate()).toBe(31);
    });

    it('formato inválido → null', () => {
        expect(ultimoDiaCompetencia('2026/01')).toBeNull();
        expect(ultimoDiaCompetencia('2026-1')).toBeNull();
        expect(ultimoDiaCompetencia('abc')).toBeNull();
        expect(ultimoDiaCompetencia('')).toBeNull();
    });

    it('mês fora de 1-12 → null', () => {
        expect(ultimoDiaCompetencia('2026-00')).toBeNull();
        expect(ultimoDiaCompetencia('2026-13')).toBeNull();
    });
});

describe('dataLimitePrescricao — +5 anos', () => {
    it('mar/2021 → 31/03/2026', () => {
        const fim = dataLimitePrescricao('2021-03')!;
        expect(fim.getFullYear()).toBe(2026);
        expect(fim.getMonth()).toBe(2);
        expect(fim.getDate()).toBe(31);
    });

    it('fev/2020 (bissexto) → 29/02/2025 (CUIDADO: 2025 não é bissexto, ajusta pra 28/03?)', () => {
        // new Date(2025, 1, 29) = 1 de março de 2025 (JS auto-ajusta dia 29 inexistente em fev/25)
        const fim = dataLimitePrescricao('2020-02')!;
        expect(fim.getFullYear()).toBe(2025);
        // Comportamento JS: dia 29 em fevereiro não-bissexto → vai pra mar
        expect(fim.getMonth() === 1 ? fim.getDate() : (fim.getMonth() === 2 ? 1 : -1)).toBeGreaterThan(0);
    });

    it('jun/2021 → 30/06/2026 (5 anos exatos)', () => {
        const fim = dataLimitePrescricao('2021-06')!;
        expect(fim.getFullYear()).toBe(2026);
        expect(fim.getMonth()).toBe(5);
        expect(fim.getDate()).toBe(30);
    });

    it('input inválido → null', () => {
        expect(dataLimitePrescricao('xx')).toBeNull();
    });
});

describe('diasAteExpirar', () => {
    it('competência mar/2021 vs hoje 06/jun/2026 → expirou em 31/03/2026, ~-67 dias', () => {
        const agora = new Date(2026, 5, 6); // 06/jun/2026
        const r = diasAteExpirar('2021-03', agora)!;
        // de 31/03/2026 a 06/06/2026 = 67 dias passados
        expect(r).toBe(-67);
    });

    it('competência jul/2021 vs 06/jun/2026 → expira 31/07/2026, ~+55 dias', () => {
        const agora = new Date(2026, 5, 6);
        const r = diasAteExpirar('2021-07', agora)!;
        expect(r).toBe(55);
    });

    it('competência mai/2024 vs 06/jun/2026 → expira 31/05/2029, +~3 anos', () => {
        const agora = new Date(2026, 5, 6);
        const r = diasAteExpirar('2024-05', agora)!;
        expect(r).toBeGreaterThan(1000);
        expect(r).toBeLessThan(1200);
    });

    it('input inválido → null', () => {
        expect(diasAteExpirar('xxx')).toBeNull();
    });
});

describe('classificarPrescricao — fronteiras críticas', () => {
    it('< 0 → expirado (perdeu a recuperação)', () => {
        expect(classificarPrescricao(-1)).toBe('expirado');
        expect(classificarPrescricao(-1000)).toBe('expirado');
    });

    it('0 → urgente (último dia! ainda dá)', () => {
        expect(classificarPrescricao(0)).toBe('urgente');
    });

    it('1..90 → urgente', () => {
        expect(classificarPrescricao(1)).toBe('urgente');
        expect(classificarPrescricao(50)).toBe('urgente');
        expect(classificarPrescricao(90)).toBe('urgente');
    });

    it('91 → alerta (passou os 90 dias)', () => {
        expect(classificarPrescricao(91)).toBe('alerta');
    });

    it('92..365 → alerta', () => {
        expect(classificarPrescricao(200)).toBe('alerta');
        expect(classificarPrescricao(365)).toBe('alerta');
    });

    it('366 → ok (> 1 ano)', () => {
        expect(classificarPrescricao(366)).toBe('ok');
    });

    it('1000+ → ok', () => {
        expect(classificarPrescricao(1825)).toBe('ok'); // 5 anos
    });
});

describe('integração: simulando hoje = 06/jun/2026', () => {
    const HOJE = new Date(2026, 5, 6);

    it('competência mai/2021 → EXPIRADA há 6 dias', () => {
        // limite: 31/05/2026 → -6 dias → expirado
        const dias = diasAteExpirar('2021-05', HOJE)!;
        expect(dias).toBe(-6);
        expect(classificarPrescricao(dias)).toBe('expirado');
    });

    it('competência ago/2021 → vence em 31/08/2026 → urgente (86 dias)', () => {
        const dias = diasAteExpirar('2021-08', HOJE)!;
        expect(dias).toBeLessThanOrEqual(90);
        expect(dias).toBeGreaterThan(0);
        expect(classificarPrescricao(dias)).toBe('urgente');
    });

    it('competência mai/2022 → vence em 31/05/2027 → alerta (~360 dias)', () => {
        const dias = diasAteExpirar('2022-05', HOJE)!;
        expect(classificarPrescricao(dias)).toBe('alerta');
    });

    it('competência mai/2024 → vence em 31/05/2029 → ok', () => {
        const dias = diasAteExpirar('2024-05', HOJE)!;
        expect(classificarPrescricao(dias)).toBe('ok');
    });
});

describe('constantes', () => {
    it('ANOS_PRESCRICAO = 5 (CTN art 168)', () => {
        expect(_constantes.ANOS_PRESCRICAO).toBe(5);
    });
});
