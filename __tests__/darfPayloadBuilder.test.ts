/**
 * Testes do builder do payload SERPRO de DARF (montarPayloadDarfSerpro).
 * O mesmo builder serve o envio real E o preview (dry-run) — entao travar
 * a estrutura aqui garante que o que o admin vê no preview é exatamente o
 * que sera enviado.
 *
 * Catálogo OFICIAL (docs Integra Contador, 08/07/2026):
 *   SICALC / CONSOLIDARGERARDARF51 / versao "2.9" / acao Emitir
 *   dados: uf, municipio, codigoReceita, codigoReceitaExtensao, tipoPA,
 *          dataPA, vencimento (ISO), valorImposto, dataConsolidacao, observacao
 */

// @ts-expect-error — modulo .js puro
import { montarPayloadDarfSerpro, calcularVencimentoDarf, periodoApuracaoSicalc, resolverCodigoEExtensao, trimestreVencendoEsteMes } from '../sefaz-backend/darf-payload-builder.js';

describe('montarPayloadDarfSerpro (SICALC/CONSOLIDARGERARDARF51)', () => {
    it('monta o shape oficial do SICALC', () => {
        const p = montarPayloadDarfSerpro({
            empresaCnpj: '12345678000190', competencia: '2026-03', valor: 1500,
            codigoReceita: '2089', vencimento: '2026-04-30',
        });
        expect(p.idSistema).toBe('SICALC');
        expect(p.idServico).toBe('CONSOLIDARGERARDARF51');
        expect(p.versaoSistema).toBe('2.9');
        expect(p.acao).toBe('Emitir');
        expect(p.contribuinteCnpj).toBe('12345678000190');
        expect(p.dados.uf).toBeTruthy();
        expect(p.dados.municipio).toBeTruthy();
        expect(p.dados.codigoReceita).toBe('2089');
        expect(p.dados.codigoReceitaExtensao).toBe('01');
        expect(p.dados.tipoPA).toBe('TR');           // 2089 = IRPJ trimestral
        expect(p.dados.dataPA).toBe('01/2026');      // mar/2026 -> 1º trimestre
        expect(p.dados.vencimento).toBe('2026-04-30T00:00:00');
        expect(p.dados.valorImposto).toBe('1500.00');
        expect(p.dados.dataConsolidacao).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00$/);
    });

    it('código de 6 dígitos (shape DCTFWeb) embute a extensão — 810902 vira 8109-02 mensal', () => {
        const p = montarPayloadDarfSerpro({
            empresaCnpj: '12345678000190', competencia: '2026-06', valor: 13,
            codigoReceita: '810902',
        });
        expect(p.dados.codigoReceita).toBe('8109');
        expect(p.dados.codigoReceitaExtensao).toBe('02');
        expect(p.dados.tipoPA).toBe('ME');
        expect(p.dados.dataPA).toBe('06/2026');
        // PIS: dia 25/07/2026 é sábado -> ANTECIPA pra sexta 24/07 (igual DARF real)
        expect(p.dados.vencimento).toBe('2026-07-24T00:00:00');
    });

    it('IRPJ/CSLL trimestral: vencimento no último dia útil do mês seguinte ao trimestre', () => {
        const p = montarPayloadDarfSerpro({
            empresaCnpj: '12345678000190', competencia: '2026-06', valor: 148.8,
            codigoReceita: '208901',
        });
        expect(p.dados.tipoPA).toBe('TR');
        expect(p.dados.dataPA).toBe('02/2026');      // jun/2026 -> 2º trimestre
        // 31/07/2026 é sexta (dia útil) — igual ao DARF real da DCTFWeb
        expect(p.dados.vencimento).toBe('2026-07-31T00:00:00');
    });

    it('consolidação em dia = o próprio vencimento (sem multa/juros)', () => {
        const p = montarPayloadDarfSerpro({
            empresaCnpj: '12345678000190', competencia: '2099-06', valor: 100,
            codigoReceita: '2172',
        });
        expect(p.dados.dataConsolidacao).toBe(p.dados.vencimento);
    });

    it('resolve codigo + extensão por regime/tributo quando nao informado', () => {
        const p = montarPayloadDarfSerpro({
            empresaCnpj: '12345678000190', competencia: '2026-03', valor: 1000,
            regime: 'Presumido', tributo: 'PIS', periodicidade: 'mensal',
        });
        expect(p.dados.codigoReceita).toBe('8109');
        expect(p.dados.codigoReceitaExtensao).toBe('02'); // extensão da tabela (PJ em geral)
    });


    it('observacao é truncada em 50 caracteres (limite do SICALC)', () => {
        const p = montarPayloadDarfSerpro({
            empresaCnpj: '12345678000190', competencia: '2026-06', valor: 100,
            codigoReceita: '2172',
            observacao: 'DCTFWeb GERAL_MENSAL 06/2026 - COFINS - CONTRIB P/ FIN. SEG. SOCIAL',
        });
        expect(p.dados.observacao.length).toBeLessThanOrEqual(50);
    });

    it('lanca em campos obrigatorios faltando', () => {
        expect(() => montarPayloadDarfSerpro({ competencia: '2026-03', valor: 100 } as any))
            .toThrow(/obrigatorios/);
        expect(() => montarPayloadDarfSerpro({ empresaCnpj: '123', valor: 100 } as any))
            .toThrow(/obrigatorios/);
        expect(() => montarPayloadDarfSerpro({ empresaCnpj: '123', competencia: '2026-03' } as any))
            .toThrow(/obrigatorios/);
    });

    it('lanca quando nao consegue resolver codigo (regime/tributo invalido)', () => {
        expect(() => montarPayloadDarfSerpro({
            empresaCnpj: '12345678000190', competencia: '2026-03', valor: 100,
            regime: 'XPTO', tributo: 'INEXISTENTE',
        } as any)).toThrow(/Codigo de receita/);
    });
});

describe('calcularVencimentoDarf — dias úteis', () => {
    it('PIS/COFINS: dia 25 antecipado quando cai em fim de semana', () => {
        // 25/07/2026 = sábado -> 24/07 (sexta)
        expect(calcularVencimentoDarf('2026-06', 'PIS', 'mensal')).toBe('2026-07-24');
        expect(calcularVencimentoDarf('2026-06', 'COFINS', 'mensal')).toBe('2026-07-24');
    });

    it('IRPJ trimestral: último dia útil do mês seguinte ao trimestre', () => {
        expect(calcularVencimentoDarf('2026-06', 'IRPJ', 'trimestral')).toBe('2026-07-31');
        // competência no meio do trimestre aponta pro mesmo fechamento
        expect(calcularVencimentoDarf('2026-05', 'IRPJ', 'trimestral')).toBe('2026-07-31');
        // 31/01/2027 = domingo -> antecipa pra sexta 29/01
        expect(calcularVencimentoDarf('2026-12', 'CSLL', 'trimestral')).toBe('2027-01-29');
    });

    it('código de receita sozinho define a periodicidade (2089 TR, 8109 ME)', () => {
        expect(calcularVencimentoDarf('2026-06', undefined, undefined, '2089')).toBe('2026-07-31');
        expect(calcularVencimentoDarf('2026-06', undefined, undefined, '8109')).toBe('2026-07-24');
    });
});

describe('periodoApuracaoSicalc', () => {
    it('mensal: ME mm/aaaa', () => {
        expect(periodoApuracaoSicalc('2026-06', 'PIS', 'mensal'))
            .toEqual({ tipoPA: 'ME', dataPA: '06/2026' });
    });
    it('trimestral: TR tt/aaaa', () => {
        expect(periodoApuracaoSicalc('2026-06', 'IRPJ', 'trimestral'))
            .toEqual({ tipoPA: 'TR', dataPA: '02/2026' });
        expect(periodoApuracaoSicalc('2026-12', undefined, undefined, '2372'))
            .toEqual({ tipoPA: 'TR', dataPA: '04/2026' });
    });
});

describe('resolverCodigoEExtensao', () => {
    it('6 dígitos embute extensão; 4 dígitos usa default 01', () => {
        expect(resolverCodigoEExtensao({ codigoReceita: '810902' }))
            .toEqual({ codigo: '8109', extensao: '02' });
        expect(resolverCodigoEExtensao({ codigoReceita: '2172' }))
            .toEqual({ codigo: '2172', extensao: '01' });
    });
    it('extensão explícita vence', () => {
        expect(resolverCodigoEExtensao({ codigoReceita: '2089', codigoReceitaExtensao: '03' }))
            .toEqual({ codigo: '2089', extensao: '03' });
    });
});

describe('trimestreVencendoEsteMes', () => {
    it('julho → 2º trimestre, competência 06, vence 31/07', () => {
        expect(trimestreVencendoEsteMes('2026-07-08')).toEqual({
            trimestre: 2, competenciaAno: 2026, competenciaMes: 6, vencimento: '2026-07-31',
        });
    });
    it('abril → 1º trimestre, competência 03, vence 30/04', () => {
        expect(trimestreVencendoEsteMes('2026-04-10')).toEqual({
            trimestre: 1, competenciaAno: 2026, competenciaMes: 3, vencimento: '2026-04-30',
        });
    });
    it('janeiro → 4º trimestre do ANO ANTERIOR, competência 12', () => {
        const r = trimestreVencendoEsteMes('2027-01-15');
        expect(r).toMatchObject({ trimestre: 4, competenciaAno: 2026, competenciaMes: 12 });
    });
    it('meses sem vencimento trimestral retornam null', () => {
        expect(trimestreVencendoEsteMes('2026-06-08')).toBeNull();
        expect(trimestreVencendoEsteMes('2026-08-08')).toBeNull();
    });
});
