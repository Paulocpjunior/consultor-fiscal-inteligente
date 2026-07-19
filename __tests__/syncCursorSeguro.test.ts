/**
 * Testes do cursor seguro do sync-orchestrator (calcularCursorSeguro).
 *
 * Regra central: NUNCA persistir um ultNSU além de um NSU que falhou ao importar
 * — senão o documento fica "atrás" do cursor e a SEFAZ nunca mais o reenvia (a
 * classe de bug "baixou algumas notas mas não todas"). Segura o cursor logo
 * antes do menor NSU falho pra retentar no próximo run; após MAX_TENTATIVAS_NSU
 * (=3) desiste do NSU poison, MAS sem pular os demais NSUs falhos do mesmo run.
 */

// @ts-expect-error — módulo .js puro
import { calcularCursorSeguro } from '../sefaz-backend/sync-orchestrator.js';

describe('calcularCursorSeguro — sem falha', () => {
  it('nenhum NSU falho → avança o cursor cheio e limpa a trava', () => {
    const r = calcularCursorSeguro({ reachedNSU: '000000000000500', nsusFalhos: [], travadoAnterior: null });
    expect(r).toEqual({ cursor: '000000000000500', travado: null, desistiu: false });
  });

  it('sem falha mesmo com trava anterior → segue em frente e limpa (falha se resolveu)', () => {
    const r = calcularCursorSeguro({
      reachedNSU: '510', nsusFalhos: [], travadoAnterior: { nsu: '505', tentativas: 2 },
    });
    expect(r.cursor).toBe('510');
    expect(r.travado).toBeNull();
    expect(r.desistiu).toBe(false);
  });
});

describe('calcularCursorSeguro — segura no menor NSU falho', () => {
  it('1ª falha (sem trava anterior) → segura em (falho-1), tentativa 1', () => {
    const r = calcularCursorSeguro({ reachedNSU: '520', nsusFalhos: ['505'], travadoAnterior: null });
    expect(r.cursor).toBe('504');       // reprocessa a partir de 504 → 505 volta
    expect(r.travado).toEqual({ nsu: '505', tentativas: 1 });
    expect(r.desistiu).toBe(false);
  });

  it('vários falhos → segura no MENOR deles', () => {
    const r = calcularCursorSeguro({ reachedNSU: '600', nsusFalhos: ['540', '505', '580'], travadoAnterior: null });
    expect(r.cursor).toBe('504');
    expect(r.travado).toEqual({ nsu: '505', tentativas: 1 });
  });

  it('2ª falha no MESMO menor NSU → incrementa tentativas, continua segurando', () => {
    const r = calcularCursorSeguro({
      reachedNSU: '520', nsusFalhos: ['505'], travadoAnterior: { nsu: '505', tentativas: 1 },
    });
    expect(r.cursor).toBe('504');
    expect(r.travado).toEqual({ nsu: '505', tentativas: 2 });
    expect(r.desistiu).toBe(false);
  });

  it('menor falho DIFERENTE do travado → reseta tentativas para 1', () => {
    const r = calcularCursorSeguro({
      reachedNSU: '600', nsusFalhos: ['540'], travadoAnterior: { nsu: '505', tentativas: 2 },
    });
    expect(r.cursor).toBe('539');
    expect(r.travado).toEqual({ nsu: '540', tentativas: 1 });
    expect(r.desistiu).toBe(false);
  });
});

describe('calcularCursorSeguro — desiste do poison NSU', () => {
  it('3ª falha no poison, SEM outros falhos → desiste e avança cursor cheio', () => {
    const r = calcularCursorSeguro({
      reachedNSU: '520', nsusFalhos: ['505'], travadoAnterior: { nsu: '505', tentativas: 2 },
    });
    expect(r.cursor).toBe('520');       // avança de vez (pula só o 505)
    expect(r.travado).toBeNull();
    expect(r.desistiu).toBe(true);
    expect(r.nsuDesistido).toBe('505');
  });

  it('REGRESSÃO: desiste do poison MAS há outro falho depois → NÃO pula o outro', () => {
    // Poison 505 (3ª tentativa) desiste; NSU 545 falhou 1ª vez no mesmo run.
    // Antes o cursor saltava pra 550 e o 545 sumia; agora para em 544 e trava 545.
    const r = calcularCursorSeguro({
      reachedNSU: '550', nsusFalhos: ['505', '545'], travadoAnterior: { nsu: '505', tentativas: 2 },
    });
    expect(r.desistiu).toBe(true);
    expect(r.nsuDesistido).toBe('505');
    expect(r.cursor).toBe('544');                              // não salta pra 550
    expect(r.travado).toEqual({ nsu: '545', tentativas: 1 });  // 545 vira a nova trava
  });
});
