/**
 * Alocação Base × Isentos × Outras do Exportar SAGE — casos reais 01/08
 * (JOTASUL 06/2026): o E-Fiscal valida `Valor Contábil = Base + Isentos +
 * Outras` e o exportador mandava TUDO como Base (vProd), com as outras colunas
 * zeradas. Resultado: "O valor contábil desta nota não confere com os
 * lançamentos de ICMS digitados. Valor Contábil: 1.207,66 · Base: 1.097,52 ·
 * Diferença: 110,14" — nota a nota.
 */
import { alocarTributacaoIcms } from '../services/iobSageExportService';
import { parseLogEfiscal } from '../services/iobSageLogEfiscal';

const item = (over: any = {}) => ({
    nItem: '1', cProd: 'X', xProd: 'PEÇA', ncm: '84329000', cfop: '1102',
    uCom: 'UN', qCom: 1, vUnCom: 100, vProd: 100, vICMS: 0, vIPI: 0, cst: '',
    ...over,
});

describe('alocarTributacaoIcms', () => {
    it('caso JOTASUL: IPI/despesas fecham em OUTRAS — contábil bate com a soma', () => {
        // Itens somam 1.097,52 tributados; a nota vale 1.207,66 (110,14 de IPI).
        const a = alocarTributacaoIcms([
            item({ vProd: 1097.52, vBC: 1097.52, vICMS: 197.55, aliqIcms: 18, cst: '00', vIPI: 110.14 }),
        ], 1207.66);
        expect(a.base).toBe(1097.52);
        expect(a.icms).toBe(197.55);
        expect(a.outras).toBe(110.14);
        expect(a.base + a.isentos + a.outras).toBeCloseTo(1207.66, 2);
        expect(a.ipi).toBe(110.14);
    });

    it('compra ISENTA (produtor rural, CST 40/41): valor vai em ISENTOS, não na base', () => {
        // É como o SAGE lança (print 31/07): Base 0, Isentos 51.520,00.
        const a = alocarTributacaoIcms([
            item({ vProd: 51520, vICMS: 0, cst: '41' }),
        ], 51520);
        expect(a.base).toBe(0);
        expect(a.aliquota).toBe(0);
        expect(a.isentos).toBe(51520);
        expect(a.outras).toBe(0);
    });

    it('fornecedor do Simples (CSOSN, sem destaque): valor vai em OUTRAS', () => {
        const a = alocarTributacaoIcms([item({ vProd: 500, vICMS: 0, cst: '102' })], 500);
        expect(a.base).toBe(0);
        expect(a.outras).toBe(500);
    });

    it('base REDUZIDA (CST 20): base = vBC do XML, o resto cai em OUTRAS', () => {
        const a = alocarTributacaoIcms([
            item({ vProd: 1000, vBC: 600, vICMS: 108, aliqIcms: 18, cst: '20' }),
        ], 1000);
        expect(a.base).toBe(600);
        expect(a.outras).toBe(400);
        expect(a.base + a.isentos + a.outras).toBeCloseTo(1000, 2);
    });

    it('nota mista fecha EXATAMENTE no contábil', () => {
        const a = alocarTributacaoIcms([
            item({ vProd: 300, vBC: 300, vICMS: 54, cst: '00' }),
            item({ vProd: 200, vICMS: 0, cst: '40' }),
            item({ vProd: 100, vICMS: 0, cst: '60' }),   // ST → outras
        ], 650.5);  // 600 de itens + 50,50 de frete/IPI
        expect(a.base).toBe(300);
        expect(a.isentos).toBe(200);
        expect(a.outras).toBeCloseTo(150.5, 2);
        expect(a.base + a.isentos + a.outras).toBeCloseTo(650.5, 2);
    });

    it('contábil MENOR que os itens (desconto no total): abate de outras/isentos, nunca negativo', () => {
        const a = alocarTributacaoIcms([
            item({ vProd: 100, vICMS: 0, cst: '90' }),
        ], 90);
        expect(a.outras).toBe(90);
        expect(a.base).toBeGreaterThanOrEqual(0);
        expect(a.isentos).toBeGreaterThanOrEqual(0);
    });
});

describe('log do E-Fiscal — formatos da JOTASUL (01/08)', () => {
    // Linhas REAIS do rpt_importacao da empresa 0766.
    const LOG = [
        '(!) NF ENTRADA - N° 0000125929- CÓDIGO DO FORNECEDOR: 05467135000185- SÉRIE: 1   Linha 000024 - Registro E201 - Campo 14, lançamento incorreto para este tipo de empresa.',
        '(X) NF ENTRADA - N° 0000125929- CÓDIGO DO FORNECEDOR: 05467135000185- SÉRIE: 1   Linha 000026 - Registro E222 - Campo 56, deve ser informado 1, 2, 3 ou 4.',
        '(!) NF ENTRADA - N° 0000006831- CÓDIGO DO FORNECEDOR: 33739848000196- SÉRIE: 1   Linha 000032 - Registro E200 - O valor contábil desta nota não confere com os lançamentos de ICMS digitados.',
    ].join('\r\n');

    it('reconhece os três formatos novos, com a gravidade certa', () => {
        const erros = parseLogEfiscal(LOG);
        expect(erros).toHaveLength(3);
        expect(erros[0]).toMatchObject({ categoria: 'tipo-empresa', gravidade: 'aviso', registro: 'E201' });
        expect(erros[1]).toMatchObject({ categoria: 'redf', gravidade: 'recusa', registro: 'E222', linha: 26 });
        expect(erros[2]).toMatchObject({ categoria: 'valor-contabil', gravidade: 'aviso', registro: 'E200' });
    });
});
