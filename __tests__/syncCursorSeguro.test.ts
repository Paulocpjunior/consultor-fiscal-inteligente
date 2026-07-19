/**
 * Testes do cursor seguro do sync-orchestrator (calcularCursorSeguro).
 *
 * Regra central: NUNCA persistir um ultNSU além de um NSU que falhou ao importar
 * — senão o documento fica "atrás" do cursor e a SEFAZ nunca mais o reenvia (a
 * classe de bug "baixou algumas notas mas não todas"). Segura o cursor logo
 * antes do menor NSU falho pra retentar no próximo run; após MAX_TENTATIVAS_NSU
 * (=3) desiste do NSU poison pra não travar a captura do resto da empresa.
 */

// @ts-expect-error — módulo .js puro
import { calcularCursorSeguro } from '../sefaz-backend/sync-orchestrator.js';

describe('calcularCursorSeguro — sem falha', () => {
  it('nenhum NSU falho → avança o cursor cheio e limpa a trava', () => {
    const r = calcularCursorSeguro({ reachedNSU: '000000000000500', menorNsuFalho: null, travadoAnterior: null });
    expect(r).toEqual({ cursor: '000000000000500', travado: null, desistiu: false });
  });

  it('sem falha mesmo com trava anterior → segue em frente e limpa (falha se resolveu)', () => {
    const r = calcularCursorSeguro({
      reachedNSU: '510', menorNsuFalho: null, travadoAnterior: { nsu: '505', tentativas: 2 },
    });
    expect(r.cursor).toBe('510');
    expect(r.travado).toBeNull();
    expect(r.desistiu).toBe(false);
  });
});

describe('calcularCursorSeguro — segura no NSU falho', () => {
  it('1ª falha (sem trava anterior) → segura em (falho-1), tentativa 1', () => {
    const r = calcularCursorSeguro({ reachedNSU: '520', menorNsuFalho: '505', travadoAnterior: null });
    expect(r.cursor).toBe('504');       // reprocessa a partir de 504 → 505 volta
    expect(r.travado).toEqual({ nsu: '505', tentativas: 1 });
    expect(r.desistiu).toBe(false);
  });

  it('2ª falha no MESMO NSU → incrementa tentativas, continua segurando', () => {
    const r = calcularCursorSeguro({
      reachedNSU: '520', menorNsuFalho: '505', travadoAnterior: { nsu: '505', tentativas: 1 },
    });
    expect(r.cursor).toBe('504');
    expect(r.travado).toEqual({ nsu: '505', tentativas: 2 });
    expect(r.desistiu).toBe(false);
  });

  it('falha em NSU DIFERENTE do travado → reseta tentativas para 1', () => {
    const r = calcularCursorSeguro({
      reachedNSU: '600', menorNsuFalho: '540', travadoAnterior: { nsu: '505', tentativas: 2 },
    });
    expect(r.cursor).toBe('539');
    expect(r.travado).toEqual({ nsu: '540', tentativas: 1 });
    expect(r.desistiu).toBe(false);
  });
});

describe('calcularCursorSeguro — desiste do poison NSU', () => {
  it('3ª falha no mesmo NSU (atinge MAX=3) → desiste, avança cursor cheio', () => {
    const r = calcularCursorSeguro({
      reachedNSU: '520', menorNsuFalho: '505', travadoAnterior: { nsu: '505', tentativas: 2 },
    });
    expect(r.cursor).toBe('520');       // avança de vez (pula o 505)
    expect(r.travado).toBeNull();
    expect(r.desistiu).toBe(true);
    expect(r.nsuDesistido).toBe('505');
  });
});
