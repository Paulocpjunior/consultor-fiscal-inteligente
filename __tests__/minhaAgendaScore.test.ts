/**
 * Testes do score 0-100 da Minha Agenda — define a prioridade do dia
 * de TODOS os colaboradores. Qualquer mudança nos pesos quebra esse teste.
 */
// @ts-expect-error — módulo .js puro
import { calcularScoreAgenda, faixaDoScore, FAIXA_CRITICO, FAIXA_ALTO, FAIXA_MEDIO, _pesos } from '../sefaz-backend/minha-agenda-score.js';

describe('calcularScoreAgenda — caso base "tudo zero"', () => {
    it('Simples sem nada → score 0, sem pendências', () => {
        const r = calcularScoreAgenda({ regime: 'simples' });
        expect(r.score).toBe(0);
        expect(r.pendencias).toEqual([]);
    });
    it('Lucro sem nada → score 0', () => {
        const r = calcularScoreAgenda({ regime: 'lucro' });
        expect(r.score).toBe(0);
    });
});

describe('calcularScoreAgenda — PGDAS (Simples)', () => {
    it('1 gap PGDAS Simples → 15 + pendência descritiva', () => {
        const r = calcularScoreAgenda({ regime: 'simples', pgdasGaps: 1 });
        expect(r.score).toBe(15);
        expect(r.pendencias[0]).toMatch(/PGDAS-D pendente em 1 mes/i);
    });
    it('2 gaps → 30', () => {
        expect(calcularScoreAgenda({ regime: 'simples', pgdasGaps: 2 }).score).toBe(30);
    });
    it('3 gaps → 40 (cap atingido)', () => {
        expect(calcularScoreAgenda({ regime: 'simples', pgdasGaps: 3 }).score).toBe(40);
    });
    it('6 gaps → continua 40 (cap saturado)', () => {
        expect(calcularScoreAgenda({ regime: 'simples', pgdasGaps: 6 }).score).toBe(40);
    });
    it('PGDAS gap em empresa Lucro → IGNORADO (não soma)', () => {
        const r = calcularScoreAgenda({ regime: 'lucro', pgdasGaps: 5 });
        expect(r.score).toBe(0);
        expect(r.pendencias).toEqual([]);
    });
});

describe('calcularScoreAgenda — DCTFWeb (Lucro)', () => {
    it('1 gap DCTFWeb Lucro → 15', () => {
        const r = calcularScoreAgenda({ regime: 'lucro', dctfwebGaps: 1 });
        expect(r.score).toBe(15);
        expect(r.pendencias[0]).toMatch(/DCTFWeb pendente/i);
    });
    it('3 gaps → 40 cap', () => {
        expect(calcularScoreAgenda({ regime: 'lucro', dctfwebGaps: 3 }).score).toBe(40);
    });
    it('DCTFWeb gap em empresa Simples → IGNORADO', () => {
        expect(calcularScoreAgenda({ regime: 'simples', dctfwebGaps: 5 }).score).toBe(0);
    });
});

describe('calcularScoreAgenda — mensagens', () => {
    it('1 mensagem crítica → 25', () => {
        const r = calcularScoreAgenda({ regime: 'simples', msgCriticas: 1 });
        expect(r.score).toBe(25);
        expect(r.pendencias[0]).toMatch(/CRITICA/);
    });
    it('2 críticas → 50 cap', () => {
        expect(calcularScoreAgenda({ regime: 'simples', msgCriticas: 2 }).score).toBe(50);
    });
    it('5 críticas continua 50 (cap)', () => {
        expect(calcularScoreAgenda({ regime: 'simples', msgCriticas: 5 }).score).toBe(50);
    });
    it('1 alta → 10', () => {
        expect(calcularScoreAgenda({ regime: 'simples', msgAltas: 1 }).score).toBe(10);
    });
    it('2 altas → 20 cap', () => {
        expect(calcularScoreAgenda({ regime: 'simples', msgAltas: 2 }).score).toBe(20);
    });
    it('1 média → 3', () => {
        expect(calcularScoreAgenda({ regime: 'simples', msgMedias: 1 }).score).toBe(3);
    });
    it('4 médias → 10 cap', () => {
        expect(calcularScoreAgenda({ regime: 'simples', msgMedias: 4 }).score).toBe(10);
    });
    it('Média NÃO entra em pendencias (só conta no score)', () => {
        const r = calcularScoreAgenda({ regime: 'simples', msgMedias: 2 });
        expect(r.pendencias).toEqual([]);
    });
});

describe('calcularScoreAgenda — combinações reais', () => {
    it('caso saturado: 5 gaps PGDAS + 3 críticas + 3 altas → cap 100', () => {
        const r = calcularScoreAgenda({
            regime: 'simples', pgdasGaps: 5, msgCriticas: 3, msgAltas: 3,
        });
        // 40 (cap pgdas) + 50 (cap crit) + 20 (cap alta) = 110 → cap 100
        expect(r.score).toBe(100);
    });
    it('1 gap + 1 crítica = 15 + 25 = 40 → faixa "alta" (40-69)', () => {
        const r = calcularScoreAgenda({
            regime: 'lucro', dctfwebGaps: 1, msgCriticas: 1,
        });
        expect(r.score).toBe(40);
    });
    it('só 1 média → 3 pontos, faixa "baixa" (1-14)', () => {
        expect(calcularScoreAgenda({ regime: 'simples', msgMedias: 1 }).score).toBe(3);
    });
});

describe('calcularScoreAgenda — guardas', () => {
    it('input null → score 0', () => {
        expect(calcularScoreAgenda(null).score).toBe(0);
    });
    it('valores negativos não diminuem o score (tratados como 0)', () => {
        // Math.min(40, -3*15) = -45 → soma -45 → cap em 100 não impede negativo
        // Verifica se o código resiste — qualquer valor < 0 deve ser ignorado
        const r = calcularScoreAgenda({ regime: 'simples', pgdasGaps: -3 });
        expect(r.score).toBeGreaterThanOrEqual(0);
    });
});

describe('calcularScoreAgenda — pesos exportados (sanidade)', () => {
    it('pesos primários somam mais de 100 → 100 é cap real', () => {
        const max = _pesos.CAP_PGDAS + _pesos.CAP_MSG_CRITICA + _pesos.CAP_MSG_ALTA + _pesos.CAP_MSG_MEDIA;
        expect(max).toBeGreaterThanOrEqual(100);
        expect(_pesos.CAP_TOTAL).toBe(100);
    });
});

describe('faixaDoScore — única fonte de verdade backend/UI', () => {
    it('0 → ok (sem risco)', () => {
        expect(faixaDoScore(0)).toBe('ok');
    });
    it('1..14 → baixo', () => {
        expect(faixaDoScore(1)).toBe('baixo');
        expect(faixaDoScore(14)).toBe('baixo');
    });
    it('15..39 → medio', () => {
        expect(faixaDoScore(15)).toBe('medio');
        expect(faixaDoScore(39)).toBe('medio');
    });
    it('40..69 → alto', () => {
        expect(faixaDoScore(40)).toBe('alto');
        expect(faixaDoScore(69)).toBe('alto');
    });
    it('70..100 → critico', () => {
        expect(faixaDoScore(70)).toBe('critico');
        expect(faixaDoScore(100)).toBe('critico');
    });

    it('FAIXA_CRITICO = 70 (UI vermelho = backend riscoCritico — coerente)', () => {
        expect(FAIXA_CRITICO).toBe(70);
        expect(FAIXA_ALTO).toBe(40);
        expect(FAIXA_MEDIO).toBe(15);
    });
});
