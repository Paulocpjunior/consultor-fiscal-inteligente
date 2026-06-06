/**
 * agendaScoreUi.ts — faixas de severidade e visualização do score da Minha
 * Agenda no FRONTEND. Espelho fiel das constantes em
 * sefaz-backend/minha-agenda-score.js — qualquer divergência é PEGA pelo
 * teste __tests__/agendaScoreUi.test.ts.
 *
 * Por que duplicar:
 *   - O backend roda em Node ESM; o frontend roda em Vite/TS.
 *   - Importar .js do sefaz-backend no client mistura camadas e adiciona
 *     dependência cruzada que dificulta o tree-shaking.
 *   - Custo da duplicação é zero: o teste garante coerência em tempo de CI.
 */

export const FAIXA_CRITICO_UI = 70;
export const FAIXA_ALTO_UI = 40;
export const FAIXA_MEDIO_UI = 15;

export type FaixaScore = 'critico' | 'alto' | 'medio' | 'baixo' | 'ok';

export function faixaDoScoreUi(score: number): FaixaScore {
    if (score >= FAIXA_CRITICO_UI) return 'critico';
    if (score >= FAIXA_ALTO_UI) return 'alto';
    if (score >= FAIXA_MEDIO_UI) return 'medio';
    if (score > 0) return 'baixo';
    return 'ok';
}

export const FAIXA_LABEL: Record<FaixaScore, string> = {
    critico: 'CRÍTICO',
    alto: 'ALTO',
    medio: 'MÉDIO',
    baixo: 'BAIXO',
    ok: 'OK',
};

export const FAIXA_COR: Record<FaixaScore, string> = {
    critico: 'var(--danger)',
    alto: '#ea580c',
    medio: 'var(--warning)',
    baixo: 'var(--text-muted)',
    ok: 'var(--success)',
};
