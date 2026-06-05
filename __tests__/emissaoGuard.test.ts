/**
 * Testes do freio de emergência de emissão (go-live gate).
 * Default: liberado (NO-OP). Bloqueio via env, global ou por tipo.
 */

// @ts-expect-error — modulo .js puro
import { assertEmissaoLiberada, statusEmissaoGuard, EmissaoBloqueadaError } from '../sefaz-backend/emissao-guard.js';

const ENV_KEYS = [
    'EMISSAO_BLOQUEADA',
    'EMISSAO_BLOQUEADA_DAS', 'EMISSAO_BLOQUEADA_DARF',
    'EMISSAO_BLOQUEADA_DCTFWEB', 'EMISSAO_BLOQUEADA_NFSE_NAC',
];
function limparEnv() { for (const k of ENV_KEYS) delete process.env[k]; }

describe('assertEmissaoLiberada', () => {
    beforeEach(limparEnv);
    afterAll(limparEnv);

    it('default (nenhuma env) → libera tudo (NO-OP)', () => {
        for (const t of ['DAS', 'DARF', 'DCTFWEB', 'NFSE_NAC']) {
            expect(() => assertEmissaoLiberada(t)).not.toThrow();
        }
    });

    it('EMISSAO_BLOQUEADA=true → bloqueia TODOS os tipos', () => {
        process.env.EMISSAO_BLOQUEADA = 'true';
        for (const t of ['DAS', 'DARF', 'DCTFWEB', 'NFSE_NAC']) {
            expect(() => assertEmissaoLiberada(t)).toThrow(EmissaoBloqueadaError);
        }
    });

    it('bloqueio por tipo afeta só aquele tipo', () => {
        process.env.EMISSAO_BLOQUEADA_DAS = 'true';
        expect(() => assertEmissaoLiberada('DAS')).toThrow(/BLOQUEADA/);
        expect(() => assertEmissaoLiberada('DARF')).not.toThrow();
        expect(() => assertEmissaoLiberada('NFSE_NAC')).not.toThrow();
    });

    it('erro carrega code + httpStatus 423', () => {
        process.env.EMISSAO_BLOQUEADA_NFSE_NAC = 'true';
        try {
            assertEmissaoLiberada('NFSE_NAC');
            throw new Error('deveria ter lançado');
        } catch (e: any) {
            expect(e).toBeInstanceOf(EmissaoBloqueadaError);
            expect(e.code).toBe('EMISSAO_BLOQUEADA');
            expect(e.httpStatus).toBe(423);
            expect(e.tipo).toBe('NFSE_NAC');
        }
    });

    it('case-insensitive no tipo', () => {
        process.env.EMISSAO_BLOQUEADA_DAS = 'true';
        expect(() => assertEmissaoLiberada('das')).toThrow();
    });

    it('valor diferente de "true" não bloqueia (só a string exata)', () => {
        process.env.EMISSAO_BLOQUEADA_DAS = '1';
        expect(() => assertEmissaoLiberada('DAS')).not.toThrow();
        process.env.EMISSAO_BLOQUEADA_DAS = 'TRUE';
        expect(() => assertEmissaoLiberada('DAS')).not.toThrow();
    });

    it('tipo desconhecido → fail-open (não quebra caminho novo)', () => {
        process.env.EMISSAO_BLOQUEADA = 'true';
        expect(() => assertEmissaoLiberada('TIPO_NOVO')).not.toThrow();
    });
});

describe('statusEmissaoGuard', () => {
    beforeEach(limparEnv);
    afterAll(limparEnv);

    it('reporta estado liberado por default', () => {
        const s = statusEmissaoGuard();
        expect(s.tudoBloqueado).toBe(false);
        expect(s.porTipo).toEqual({ DAS: false, DARF: false, DCTFWEB: false, NFSE_NAC: false });
    });

    it('global bloqueado reflete em todos os tipos', () => {
        process.env.EMISSAO_BLOQUEADA = 'true';
        const s = statusEmissaoGuard();
        expect(s.tudoBloqueado).toBe(true);
        expect(Object.values(s.porTipo).every(Boolean)).toBe(true);
    });

    it('bloqueio por tipo isolado', () => {
        process.env.EMISSAO_BLOQUEADA_DARF = 'true';
        const s = statusEmissaoGuard();
        expect(s.porTipo.DARF).toBe(true);
        expect(s.porTipo.DAS).toBe(false);
    });
});
