/**
 * 📖 COD_CRED DO M100/M500 — TRÊS DÍGITOS DA TABELA 4.3.6, UM REGISTRO POR TIPO
 * DE CRÉDITO (ELS DISTRIBUIDORA DE BANANAS 08/2026, PVA de 25/09: "Tamanho do
 * campo inválido/incorreto — COD_CRED", M100 e M500, sobre `01`).
 *
 * Fatos cobrados: o grupo vem da CST da aquisição (50 → 1xx, 51 → 2xx,
 * 52 → 3xx); o tipo é 01 (alíquota básica, 0110 campo 04 = 1); crédito
 * comum (53–56), presumido (60–66) e sem direito (70+) ficam FORA, ditos; o
 * desconto do M200 é a soma dos M100; a prevalidação acusa o código curto.
 */
// @ts-expect-error módulo .js puro sem tipos
import { buildBlocoM, grupoDoCreditoPeloCst, codCredDoGrupo } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-expect-error módulo .js puro sem tipos
import { conferirCodCredDoM100, conferirContagemDeCampos, avisosDaPrevalidacaoContrib, CODIGOS_TIPO_CREDITO } from '../sefaz-backend/sped-contrib-campos.js';

const campos = (l: string) => l.trim().split('|');
const num = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

const nfe = (numero: number, direcao: 'saida' | 'entrada', itens: Array<{ vProd: number; cst: string }>) => ({
    tipo: 'NFe', direcao, numero: String(numero),
    chave: `3526080000543000010455001000${String(numero).padStart(6, '0')}1000000001`,
    dataEmissao: '2026-08-10', cnpjEmit: '00005430000104', cnpjDest: '11222333000181',
    itens: itens.map((i, k) => ({
        nItem: k + 1, codigo: `P${k}`, descricao: 'Banana', cfop: direcao === 'saida' ? '5102' : '1102', ncm: '08039000',
        unidade: 'KG', quantidade: 1, vUnCom: i.vProd, vProd: i.vProd, vDesc: 0,
        cstPis: i.cst, cstCofins: i.cst, vPIS: 0, vCOFINS: 0, vICMS: 0,
    })),
});
const venda = () => nfe(1, 'saida', [{ vProd: 100000, cst: '01' }]); // contribuição alta: o crédito é descontado por inteiro
const bloco = (notas: any[], warnings: string[] = []) => buildBlocoM({ notas, regimeApuracao: '1', warnings, naturezaReceita: {} }) as string[];
const reg = (linhas: string[], r: string) => linhas.filter((l) => l.startsWith(`|${r}|`));

describe('a régua: grupo pela CST, código de três dígitos', () => {
    it('50/51/52 → grupos 1/2/3; 53–56 comum; 60–66 presumido; 70+ nada', () => {
        expect(['50', '51', '52'].map(grupoDoCreditoPeloCst)).toEqual(['1', '2', '3']);
        for (const c of ['53', '54', '55', '56']) expect(grupoDoCreditoPeloCst(c)).toBe('comum');
        for (const c of ['60', '66']) expect(grupoDoCreditoPeloCst(c)).toBe('presumido');
        for (const c of ['70', '73', '98', '99', '', undefined]) expect(grupoDoCreditoPeloCst(c)).toBeNull();
        expect(codCredDoGrupo('1')).toBe('101');
        expect(codCredDoGrupo('2')).toBe('201');
        expect(codCredDoGrupo('3', '2')).toBe('302');
        expect(codCredDoGrupo('comum')).toBeNull();
        expect(CODIGOS_TIPO_CREDITO.has('101')).toBe(true);
        expect(CODIGOS_TIPO_CREDITO.has('01')).toBe(false);
    });
});

describe('o M100/M500 sai com COD_CRED de três dígitos, um por tipo de crédito', () => {
    it('só CST 50 (o caso da ELS): um M100 e um M500 com 101, 15 campos, crédito = base × alíquota', () => {
        const linhas = bloco([venda(), nfe(2, 'entrada', [{ vProd: 1000, cst: '50' }])]);
        const m100 = reg(linhas, 'M100'); const m500 = reg(linhas, 'M500');
        expect(m100).toHaveLength(1); expect(m500).toHaveLength(1);
        expect(campos(m100[0])[2]).toBe('101');
        expect(campos(m500[0])[2]).toBe('101');
        expect(campos(m100[0]).length - 2).toBe(15);
        expect(num(campos(m100[0])[4])).toBeCloseTo(1000, 2);
        expect(num(campos(m100[0])[8])).toBeCloseTo(16.5, 2);
        expect(num(campos(m500[0])[8])).toBeCloseTo(76, 2);
        expect(conferirContagemDeCampos(linhas).erros.filter((e: any) => /M100|M500/.test(e.mensagem))).toEqual([]);
        expect(avisosDaPrevalidacaoContrib(linhas).filter((a: string) => /COD_CRED/.test(a))).toEqual([]);
    });

    it('CST 50 e 51 no mês: dois M100 (101 e 201), e o desconto do M200 é a soma dos M100', () => {
        const linhas = bloco([venda(), nfe(2, 'entrada', [{ vProd: 1000, cst: '50' }]), nfe(3, 'entrada', [{ vProd: 2000, cst: '51' }])]);
        const m100 = reg(linhas, 'M100');
        expect(m100.map((l) => campos(l)[2])).toEqual(['101', '201']);
        expect(num(campos(m100[1])[8])).toBeCloseTo(33, 2);
        const somaDesc = m100.reduce((s, l) => s + num(campos(l)[14]), 0);
        const m200 = campos(reg(linhas, 'M200')[0]);
        expect(num(m200[3])).toBeCloseTo(somaDesc, 2); // 03 VL_TOT_CRED_DESC
    });

    it('nota com CST misturadas vai item a item: 50 e 52 na mesma nota viram 101 e 301', () => {
        const linhas = bloco([venda(), nfe(2, 'entrada', [{ vProd: 1000, cst: '50' }, { vProd: 500, cst: '52' }])]);
        expect(reg(linhas, 'M100').map((l) => campos(l)[2])).toEqual(['101', '301']);
        expect(num(campos(reg(linhas, 'M100')[1])[4])).toBeCloseTo(500, 2);
    });

    it('crédito comum (53) e sem direito (70) ficam FORA do M100 e do desconto — e o aviso diz quanto e o que fazer', () => {
        const warnings: string[] = [];
        const linhas = bloco([venda(), nfe(2, 'entrada', [{ vProd: 1000, cst: '50' }]), nfe(3, 'entrada', [{ vProd: 4000, cst: '53' }]), nfe(4, 'entrada', [{ vProd: 700, cst: '70' }])], warnings);
        const m100 = reg(linhas, 'M100');
        expect(m100).toHaveLength(1);
        expect(num(campos(m100[0])[8])).toBeCloseTo(16.5, 2);
        expect(num(campos(reg(linhas, 'M200')[0])[3])).toBeCloseTo(16.5, 2);
        const comum = warnings.find((w) => /CST 53–56/.test(w));
        expect(comum).toMatch(/4000\.00/);
        expect(comum).toMatch(/0110/);
        expect(warnings.find((w) => /sem direito a crédito/.test(w))).toMatch(/700\.00/);
    });

    it('sem crédito de entrada não sai M100 — nada muda no cumulativo', () => {
        expect(reg(bloco([venda()]), 'M100')).toEqual([]);
        expect(reg(buildBlocoM({ notas: [venda(), nfe(2, 'entrada', [{ vProd: 1000, cst: '50' }])], regimeApuracao: '2', warnings: [], naturezaReceita: {} }) as string[], 'M100')).toEqual([]);
    });
});

describe('a prevalidação acusa o COD_CRED fora da Tabela 4.3.6', () => {
    const m100 = (cod: string) => `|M100|${cod}|0|960187,11|1,6500|||15822,79|0,00|0,00|0,00|15822,79|1|0,00|15822,79|`;
    it("'01' (o que a ELS entregou) é acusado; 101/104/399 passam; 150 e vazio são acusados", () => {
        expect(conferirCodCredDoM100([m100('01')]).erros).toHaveLength(1);
        expect(conferirCodCredDoM100([m100('01')]).erros[0].mensagem).toMatch(/Tamanho do campo/);
        for (const ok of ['101', '104', '399']) expect(conferirCodCredDoM100([m100(ok)]).erros).toEqual([]);
        expect(conferirCodCredDoM100([m100('150')]).erros).toHaveLength(1);
        expect(conferirCodCredDoM100([m100('')]).erros).toHaveLength(1);
        expect(avisosDaPrevalidacaoContrib([m100('01')]).some((a: string) => /COD_CRED/.test(a))).toBe(true);
    });
});
