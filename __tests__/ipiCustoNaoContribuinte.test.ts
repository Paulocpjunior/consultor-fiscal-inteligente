/**
 * 🏭 IPI DA COMPRA É CUSTO DE QUEM NÃO É CONTRIBUINTE DO IPI (13/10).
 *
 * Paulo, WALDESA 0005-02 (Lucro, comércio — cadastro "Contribuinte de IPI:
 * Não — comércio/serviço (IPI da compra é custo)"): a NF 4484116 da WEG, com
 * IPI destacado de R$ 136,52, saía no Livro de Entradas na coluna IPI — que é
 * a de IPI CREDITADO. A régua só tirava o crédito do Simples e ignorava o
 * campo do cadastro que promete justamente isso.
 *
 * Fatos cobrados: com "não" o IPI não é crédito (coluna zerada, valor dito
 * como custo, total da nota intacto); em branco o crédito fica (ausência não é
 * prova); "sim" credita; e o Simples continua sem crédito com o motivo dele.
 */
import { entradaGeraCreditoIpi } from '../sefaz-backend/credito-icms-entrada.js';
import { alocarTributacaoIcms, ctxAlocacaoDoDoc } from '../services/iobSageExportService';

/** A forma da NF 4484116 (WEG → WALDESA): 3 itens, ICMS destacado, IPI 136,52, ST 623,05. */
const WEG: any = {
    direcao: 'entrada',
    itens: [
        { nItem: '1', cfop: '6403', cst: '10', vProd: 378.88, vBC: 378.88, vICMS: 15.16, vIPI: 24.63, vICMSST: 112.29 },
        { nItem: '2', cfop: '6403', cst: '10', vProd: 360.68, vBC: 360.68, vICMS: 14.43, vIPI: 23.44, vICMSST: 106.89 },
        { nItem: '3', cfop: '6403', cst: '10', vProd: 1360.80, vBC: 1360.80, vICMS: 54.43, vIPI: 88.45, vICMSST: 403.87 },
    ],
    totais: { vNF: 2859.93, vIPI: 136.52, vST: 623.05 },
};
const livro = (cadastro: { regimeTributario?: string; contribuinteIpi?: string | null }) =>
    alocarTributacaoIcms(WEG.itens, WEG.totais.vNF, ctxAlocacaoDoDoc(WEG, cadastro as any));

describe('a régua do crédito de IPI na entrada', () => {
    it('NÃO contribuinte declarado: sem crédito, com motivo e base legal', () => {
        const r = entradaGeraCreditoIpi({ regime: 'LUCRO_PRESUMIDO', direcao: 'entrada', contribuinteIpi: 'nao' });
        expect(r.credita).toBe(false);
        expect(r.motivo).toMatch(/NÃO contribuinte do IPI/);
        expect(r.baseLegal).toMatch(/RIPI/);
    });
    it('em branco: o crédito fica (ausência não é prova)', () => {
        expect(entradaGeraCreditoIpi({ regime: 'LUCRO_PRESUMIDO', direcao: 'entrada', contribuinteIpi: '' }).credita).toBe(true);
        expect(entradaGeraCreditoIpi({ regime: 'LUCRO_PRESUMIDO', direcao: 'entrada' }).credita).toBe(true);
    });
    it('contribuinte: credita', () => {
        expect(entradaGeraCreditoIpi({ regime: 'LUCRO_REAL', direcao: 'entrada', contribuinteIpi: 'sim' }).credita).toBe(true);
    });
    it('Simples continua sem crédito, com o motivo do Simples', () => {
        expect(entradaGeraCreditoIpi({ regime: 'SIMPLES', direcao: 'entrada', contribuinteIpi: 'sim' }).motivo).toMatch(/Simples/);
    });
    it('a saída não é afetada', () => {
        expect(entradaGeraCreditoIpi({ regime: 'LUCRO_PRESUMIDO', direcao: 'saida', contribuinteIpi: 'nao' }).credita).toBe(true);
    });
});

describe('o Livro de Entradas da WALDESA (NF 4484116 da WEG)', () => {
    it('cadastro "não contribuinte": coluna IPI ZERADA, 136,52 dito como custo, contábil fecha', () => {
        const a = livro({ regimeTributario: 'LUCRO_PRESUMIDO', contribuinteIpi: 'nao' });
        expect(a.ipi).toBe(0);
        expect(a.ipiCusto).toBeCloseTo(136.52, 2);
        // O valor contábil continua fechando: o IPI (e o ST) estão dentro de ICMS Outras.
        expect(a.base + a.isentos + a.outras).toBeCloseTo(2859.93, 2);
    });
    it('sem o campo no cadastro: continua como estava (IPI creditado)', () => {
        const a = livro({ regimeTributario: 'LUCRO_PRESUMIDO' });
        expect(a.ipi).toBeCloseTo(136.52, 2);
        expect(a.ipiCusto).toBe(0);
    });
});
