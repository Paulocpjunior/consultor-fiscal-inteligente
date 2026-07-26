/**
 * legalizacaoHelper.test.ts — farol, faixas de alerta e e-mail do módulo
 * Legalização (sefaz-backend/legalizacao-helper.js).
 */
import {
    classificarVencimento,
    faixaAlertaDevida,
    montarEmailAlerta,
    resumirPorFarol,
    acaoPratica,
    fmtCnpj,
    fmtDataBr,
    FAIXAS_ALERTA,
    DIAS_VENCIDO_HISTORICO,
} from '../sefaz-backend/legalizacao-helper.js';

describe('classificarVencimento', () => {
    it('classifica pelos limiares 0/7/30', () => {
        expect(classificarVencimento(-1)).toBe('vencido');
        expect(classificarVencimento(0)).toBe('critico');
        expect(classificarVencimento(7)).toBe('critico');
        expect(classificarVencimento(8)).toBe('atencao');
        expect(classificarVencimento(30)).toBe('atencao');
        expect(classificarVencimento(31)).toBe('ok');
    });

    it('sem data → sem_data (nunca finge verde)', () => {
        expect(classificarVencimento(null)).toBe('sem_data');
        expect(classificarVencimento(undefined)).toBe('sem_data');
        expect(classificarVencimento(NaN)).toBe('sem_data');
    });
});

describe('faixaAlertaDevida', () => {
    it('devolve a MENOR faixa que cobre os dias restantes', () => {
        expect(faixaAlertaDevida(30)).toBe(30);
        expect(faixaAlertaDevida(16)).toBe(30);
        expect(faixaAlertaDevida(15)).toBe(15);
        expect(faixaAlertaDevida(9)).toBe(15);
        expect(faixaAlertaDevida(7)).toBe(7);
        expect(faixaAlertaDevida(2)).toBe(3);
        expect(faixaAlertaDevida(1)).toBe(1);
        expect(faixaAlertaDevida(0)).toBe(0);
    });

    it('fim de semana sem cron não pula alerta: segunda pega a faixa corrente', () => {
        // Vencimento domingo; sexta dias=2 → faixa 3. Segunda dias=-1 → 'vencido'.
        expect(faixaAlertaDevida(2)).toBe(3);
        expect(faixaAlertaDevida(-1)).toBe('vencido');
    });

    it('vencido antigo é histórico (não alerta)', () => {
        expect(faixaAlertaDevida(-DIAS_VENCIDO_HISTORICO)).toBe('vencido');
        expect(faixaAlertaDevida(-(DIAS_VENCIDO_HISTORICO + 1))).toBeNull();
    });

    it('muito no futuro ou sem data → null', () => {
        expect(faixaAlertaDevida(31)).toBeNull();
        expect(faixaAlertaDevida(null)).toBeNull();
    });

    it('faixas default cobrem 30/15/7/3/1/0', () => {
        expect(FAIXAS_ALERTA).toEqual([30, 15, 7, 3, 1, 0]);
    });
});

describe('montarEmailAlerta', () => {
    const base = {
        categoria: 'certificado' as const,
        tipoDetalhe: 'e-CNPJ A1',
        empresaNome: 'HS PROJETOS LTDA',
        cnpj: '12345678000199',
        dataVencimento: '2026-08-05',
        diasRestantes: 7,
    };

    it('assunto tem empresa, documento e data BR', () => {
        const { assunto } = montarEmailAlerta(base);
        expect(assunto).toContain('HS PROJETOS LTDA');
        expect(assunto).toContain('Certificado Digital');
        expect(assunto).toContain('05/08/2026');
    });

    it('corpo tem CNPJ formatado, prazo e AÇÃO prática (padrão interpretarCstat)', () => {
        const { corpoHtml } = montarEmailAlerta(base);
        expect(corpoHtml).toContain('12.345.678/0001-99');
        expect(corpoHtml).toContain('7 dias');
        expect(corpoHtml).toContain('renovação do certificado');
    });

    it('vencido fala VENCIDO HÁ N DIAS', () => {
        const { corpoHtml } = montarEmailAlerta({ ...base, diasRestantes: -3 });
        expect(corpoHtml).toContain('VENCIDO HÁ 3 DIAS');
    });

    it('toda categoria tem ação prática não-vazia', () => {
        for (const cat of ['certificado', 'certidao', 'parcelamento', 'procuracao', 'processo']) {
            expect(acaoPratica(cat).length).toBeGreaterThan(20);
        }
    });
});

describe('resumirPorFarol', () => {
    it('agrupa por categoria × nível', () => {
        const r = resumirPorFarol([
            { categoria: 'certificado', diasRestantes: -1 },
            { categoria: 'certificado', diasRestantes: 5 },
            { categoria: 'certidao', diasRestantes: 100 },
            { categoria: 'certidao', diasRestantes: null },
        ]);
        expect(r.certificado).toMatchObject({ total: 2, vencido: 1, critico: 1 });
        expect(r.certidao).toMatchObject({ total: 2, ok: 1, sem_data: 1 });
    });
});

describe('formatação', () => {
    it('fmtCnpj', () => {
        expect(fmtCnpj('12345678000199')).toBe('12.345.678/0001-99');
        expect(fmtCnpj('123')).toBe('123');
        expect(fmtCnpj(null)).toBe('');
    });
    it('fmtDataBr sem off-by-one de fuso', () => {
        expect(fmtDataBr('2026-01-01')).toBe('01/01/2026');
        expect(fmtDataBr('x')).toBe('x');
    });
});
