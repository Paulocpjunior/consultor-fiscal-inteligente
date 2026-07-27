// @ts-expect-error modulo JS puro
import { classificarElegibilidadeAdn } from '../sefaz-backend/nfse-nacional-dfe-eligibility.js';

const NOW = Date.parse('2026-06-10T12:00:00Z');

function empresa(overrides: any = {}) {
    return {
        cnpj: '12345678000190',
        nfseNacionalDfeAtivo: true,
        ...overrides,
    };
}

function cert(overrides: any = {}) {
    return {
        tipoCert: 'A1',
        cnpj: '12345678000190',
        storagePath: 'certs/empresa.pfx.enc',
        passwordEnc: 'abc',
        notAfter: '2027-01-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('classificarElegibilidadeAdn', () => {
    it('bloqueia empresa ativa sem A1 proprio para evitar E2243 com cert do escritorio', () => {
        const r = classificarElegibilidadeAdn({ empresa: empresa(), cert: null, nowMs: NOW });

        expect(r.elegivel).toBe(false);
        expect(r.motivo).toContain('A1 proprio');
        expect(r.motivo).toContain('E2243');
    });

    it('libera empresa com A1 proprio valido e mesma raiz CNPJ', () => {
        const r = classificarElegibilidadeAdn({ empresa: empresa(), cert: cert(), nowMs: NOW });

        expect(r.elegivel).toBe(true);
        expect(r.tipoCert).toBe('A1');
    });

    it('bloqueia A1 de outra raiz CNPJ', () => {
        const r = classificarElegibilidadeAdn({
            empresa: empresa(),
            cert: cert({ cnpj: '87654321000190' }),
            nowMs: NOW,
        });

        expect(r.elegivel).toBe(false);
        expect(r.motivo).toContain('CNPJ-base diferente');
    });

    it('bloqueia certificado A3 no Cloud Run', () => {
        const r = classificarElegibilidadeAdn({
            empresa: empresa(),
            cert: cert({ tipoCert: 'A3' }),
            nowMs: NOW,
        });

        expect(r.elegivel).toBe(false);
        expect(r.motivo).toContain('A3');
    });

    // Regressão 22/07: 89 "elegíveis" com 0 docs NA HISTÓRIA — clientes de SP
    // capital não têm movimento no ADN (usam o portal da prefeitura).
    it('bloqueia empresa de SP capital (município com sistema próprio)', () => {
        const r = classificarElegibilidadeAdn({
            empresa: empresa({ codMunIBGE: '3550308' }),
            cert: cert(),
            nowMs: NOW,
        });
        expect(r.elegivel).toBe(false);
        expect(r.motivo).toMatch(/sistema próprio|portal/i);
    });

    // Regressão 24/07 (caso 4BZ/Jundiaí): a comparação antiga comparava o
    // OBJETO de caminhoNfseRecomendado com a string 'adn' — sempre true — e
    // bloqueava TODA empresa com município preenchido ("369 bloqueadas · 0
    // docs na história"). Empresa de município ADN TEM que ser elegível: é o
    // trilho que captura a NFS-e de quem não é da capital.
    it('LIBERA empresa de município no Padrão Nacional (Jundiaí — fora da tabela = ADN default)', () => {
        const r = classificarElegibilidadeAdn({
            empresa: empresa({ codMunIBGE: '3525904' }),
            cert: cert(),
            nowMs: NOW,
        });
        expect(r.elegivel).toBe(true);
        expect(r.tipoCert).toBe('A1');
    });

    it('LIBERA empresa de município catalogado como ADN (Guarulhos)', () => {
        const r = classificarElegibilidadeAdn({
            empresa: empresa({ codMunIBGE: '3518800' }),
            cert: cert(),
            nowMs: NOW,
        });
        expect(r.elegivel).toBe(true);
    });

    it('mantém elegível quando codMunIBGE ausente (não dá pra afirmar)', () => {
        const r = classificarElegibilidadeAdn({
            empresa: empresa({ codMunIBGE: null }),
            cert: cert(),
            nowMs: NOW,
        });
        expect(r.elegivel).toBe(true);
    });

    it('libera a propria S&P para usar o certificado global', () => {
        const r = classificarElegibilidadeAdn({
            empresa: empresa({ cnpj: '44388152000189' }),
            cert: null,
            nowMs: NOW,
        });

        expect(r.elegivel).toBe(true);
        expect(r.tipoCert).toBe('escritorio');
    });
});

// ── Matriz ↔ filial: filial usa o A1 da matriz até subir o próprio ──────────
// Paulo, 27/07 (J.N. VINATEX 0002-78 e 0003-59): as filiais já capturavam NFe
// com "A1 raiz" mas o ADN as bloqueava exigindo cert próprio. O E2243 barra
// raiz DIVERGENTE — mesma raiz é aceita.
describe('classificarElegibilidadeAdn — fallback de RAIZ (matriz ↔ filial)', () => {
    const MATRIZ = '32602701000178';
    const FILIAL = '32602701000259';
    const certMatriz = {
        empresaId: 'emp-matriz', tipoCert: 'A1', cnpj: MATRIZ,
        storagePath: 'certs/matriz.pfx.enc', passwordEnc: 'x',
        notAfter: '2027-10-22T00:00:00.000Z',
    };

    it('filial SEM cert próprio + A1 válido da matriz → ELEGÍVEL como A1-raiz', () => {
        const r = classificarElegibilidadeAdn({
            empresa: { id: 'emp-filial', cnpj: FILIAL, nfseNacionalDfeAtivo: true },
            cert: null,
            certsMeta: [certMatriz],
            nowMs: NOW,
        });
        expect(r.elegivel).toBe(true);
        expect(r.tipoCert).toBe('A1-raiz');
        expect(r.certEmpresaId).toBe('emp-matriz');
    });

    it('filial com A1 PRÓPRIO vencido → cai no da matriz (captura não para)', () => {
        const r = classificarElegibilidadeAdn({
            empresa: { id: 'emp-filial', cnpj: FILIAL, nfseNacionalDfeAtivo: true },
            cert: cert({ cnpj: FILIAL, notAfter: '2026-01-01T00:00:00.000Z' }),
            certsMeta: [certMatriz],
            nowMs: NOW,
        });
        expect(r.elegivel).toBe(true);
        expect(r.tipoCert).toBe('A1-raiz');
    });

    it('filial com A3 próprio + matriz A1 → captura em nuvem pelo da matriz', () => {
        const r = classificarElegibilidadeAdn({
            empresa: { id: 'emp-filial', cnpj: FILIAL, nfseNacionalDfeAtivo: true },
            cert: cert({ tipoCert: 'A3', cnpj: FILIAL }),
            certsMeta: [certMatriz],
            nowMs: NOW,
        });
        expect(r.elegivel).toBe(true);
        expect(r.tipoCert).toBe('A1-raiz');
    });

    it('cert de OUTRA raiz não serve de fallback (E2243 continua barrado)', () => {
        const r = classificarElegibilidadeAdn({
            empresa: { id: 'emp-x', cnpj: '11222333000181', nfseNacionalDfeAtivo: true },
            cert: null,
            certsMeta: [certMatriz],
            nowMs: NOW,
        });
        expect(r.elegivel).toBe(false);
        expect(r.motivo).toMatch(/E2243/);
    });

    it('sem certsMeta o comportamento antigo é preservado (sem cert = bloqueada)', () => {
        const r = classificarElegibilidadeAdn({
            empresa: { id: 'emp-filial', cnpj: FILIAL, nfseNacionalDfeAtivo: true },
            cert: null,
            nowMs: NOW,
        });
        expect(r.elegivel).toBe(false);
    });
});
