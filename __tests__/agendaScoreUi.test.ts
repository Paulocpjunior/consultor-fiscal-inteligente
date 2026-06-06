/**
 * Testes do agendaScoreUi (frontend) + travamento da igualdade com o
 * backend (sefaz-backend/minha-agenda-score.js). Qualquer divergência
 * entre os 2 lados → CI quebra. Antes desse teste, o backend contava
 * "riscoCritico" em ≥50 e a UI pintava vermelho em ≥70 sem detectar.
 */
import {
    FAIXA_CRITICO_UI, FAIXA_ALTO_UI, FAIXA_MEDIO_UI,
    faixaDoScoreUi, FAIXA_LABEL, FAIXA_COR,
} from '../services/agendaScoreUi';
// @ts-expect-error — módulo .js puro
import { FAIXA_CRITICO, FAIXA_ALTO, FAIXA_MEDIO, faixaDoScore } from '../sefaz-backend/minha-agenda-score.js';

describe('agendaScoreUi — espelho do backend', () => {
    it('FAIXA_CRITICO UI === backend (70)', () => {
        expect(FAIXA_CRITICO_UI).toBe(FAIXA_CRITICO);
        expect(FAIXA_CRITICO_UI).toBe(70);
    });
    it('FAIXA_ALTO UI === backend (40)', () => {
        expect(FAIXA_ALTO_UI).toBe(FAIXA_ALTO);
        expect(FAIXA_ALTO_UI).toBe(40);
    });
    it('FAIXA_MEDIO UI === backend (15)', () => {
        expect(FAIXA_MEDIO_UI).toBe(FAIXA_MEDIO);
        expect(FAIXA_MEDIO_UI).toBe(15);
    });

    it('faixaDoScoreUi produz EXATAMENTE o mesmo resultado do backend para 0..100', () => {
        for (let s = 0; s <= 100; s++) {
            expect(faixaDoScoreUi(s)).toBe(faixaDoScore(s));
        }
    });

    it('faixaDoScoreUi cobre fronteiras críticas', () => {
        expect(faixaDoScoreUi(0)).toBe('ok');
        expect(faixaDoScoreUi(14)).toBe('baixo');
        expect(faixaDoScoreUi(15)).toBe('medio');
        expect(faixaDoScoreUi(40)).toBe('alto');
        expect(faixaDoScoreUi(70)).toBe('critico');
        expect(faixaDoScoreUi(100)).toBe('critico');
    });

    it('FAIXA_LABEL: todas as faixas têm label distinto', () => {
        const labels = Object.values(FAIXA_LABEL);
        expect(new Set(labels).size).toBe(labels.length);
    });

    it('FAIXA_COR: todas as faixas têm cor', () => {
        ['critico', 'alto', 'medio', 'baixo', 'ok'].forEach(f =>
            expect(FAIXA_COR[f as keyof typeof FAIXA_COR]).toBeTruthy(),
        );
    });
});
