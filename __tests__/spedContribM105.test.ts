/**
 * 📗 M105/M505 — o detalhamento da base do crédito, um por (natureza 4.3.7,
 * CST), filho de cada M100/M500 (ELS 08/2026, PVA de 28/09: "Deverá existir
 * um registro M105/M505 … para cada Código da Natureza da Base de Cálculo do
 * Crédito e Código de Situação Tributária" — 4 recusas).
 *
 * Fatos cobrados (Guia 1.35, M105): 10 campos; campo 04 = base; 05 = 0,00
 * (exclusivamente não-cumulativo); 06 = 04; 07 = 06 (CST 50/51/52); a soma
 * dos M105 de um M100 = campo 04 do M100; um M105 por natureza; o M105 vem
 * logo depois do seu M100 (nível 3, filho).
 */
// @ts-expect-error módulo .js puro sem tipos
import { buildBlocoM, montarM105 } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-expect-error módulo .js puro sem tipos
import { conferirContagemDeCampos } from '../sefaz-backend/sped-contrib-campos.js';

const campos = (l: string) => l.trim().split('|');
const num = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const nfe = (numero: number, direcao: 'saida' | 'entrada', itens: Array<{ vProd: number; ncm?: string }>, over: any = {}) => ({
    tipo: 'NFe', direcao, numero: String(numero),
    chave: `3526080000543000010455001000${String(numero).padStart(6, '0')}1000000001`,
    dataEmissao: '2026-08-10', cnpjEmit: '00005430000104', cnpjDest: '11222333000181',
    itens: itens.map((i, k) => ({
        nItem: k + 1, codigo: `P${k}`, descricao: 'Item', cfop: direcao === 'saida' ? '5102' : '1102', ncm: i.ncm || '08039000',
        unidade: 'KG', quantidade: 1, vUnCom: i.vProd, vProd: i.vProd, vDesc: 0,
        cstPis: direcao === 'saida' ? '01' : '50', cstCofins: direcao === 'saida' ? '01' : '50', vPIS: 0, vCOFINS: 0, vICMS: 0,
    })),
    ...over,
});
const venda = () => nfe(1, 'saida', [{ vProd: 100000 }]);
const bloco = (notas: any[], cadastroNcm: any[] = []) => buildBlocoM({ notas, regimeApuracao: '1', warnings: [], naturezaReceita: {}, cadastroNcm }) as string[];
const reg = (linhas: string[], r: string) => linhas.filter((l) => l.startsWith(`|${r}|`));

describe('montarM105 (puro)', () => {
    it('10 campos, uma linha por (natureza, CST), 05 = 0,00, 06 = 04, 07 = 06; base zero não sai', () => {
        const linhas: string[] = montarM105({ registro: 'M105', porNatCst: {
            '01|50': { natBcCred: '01', cst: '50', bc: 1500 },
            '02|50': { natBcCred: '02', cst: '50', bc: 250.5 },
            '03|50': { natBcCred: '03', cst: '50', bc: 0 },
        } });
        expect(linhas).toHaveLength(2);
        const c = campos(linhas[0]);
        expect(c.length - 2).toBe(10);
        expect([c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10]]).toEqual(['M105', '01', '50', '1500,00', '0,00', '1500,00', '1500,00', '', '', '']);
        expect(campos(linhas[1])[2]).toBe('02');
        expect(montarM105({ registro: 'M505', porNatCst: {} })).toEqual([]);
    });
});

describe('o bloco M emite M105/M505 como filhos do M100/M500', () => {
    it('só CST 50, natureza 01 (o caso da ELS): M100 → M105 logo abaixo, e a soma dos M105 é o campo 04 do M100', () => {
        const linhas = bloco([venda(), nfe(2, 'entrada', [{ vProd: 1000 }, { vProd: 500 }])]);
        const i100 = linhas.findIndex((l) => l.startsWith('|M100|'));
        expect(i100).toBeGreaterThan(-1);
        expect(linhas[i100 + 1].startsWith('|M105|')).toBe(true);
        const m105 = reg(linhas, 'M105');
        expect(m105).toHaveLength(1);
        const c = campos(m105[0]);
        expect([c[2], c[3]]).toEqual(['01', '50']);
        expect(num(c[4])).toBeCloseTo(1500, 2);
        expect(num(c[4])).toBeCloseTo(num(campos(linhas[i100])[4]), 2);
        const i500 = linhas.findIndex((l) => l.startsWith('|M500|'));
        expect(linhas[i500 + 1].startsWith('|M505|')).toBe(true);
        expect(campos(reg(linhas, 'M505')[0])[3]).toBe('50');
        expect(conferirContagemDeCampos(linhas).erros.filter((e: any) => /M105|M505/.test(e.mensagem))).toEqual([]);
    });

    it('natureza pelo cadastro NCM (02 insumo) separa o M105 — dois M105 sob o mesmo M100, somando a base dele', () => {
        const linhas = bloco(
            [venda(), nfe(2, 'entrada', [{ vProd: 1000 }]), nfe(3, 'entrada', [{ vProd: 300, ncm: '84212300' }])],
            [{ ncm: '84212300', cstPisCofinsEntrada: '50', natBcCred: '02' }],
        );
        expect(reg(linhas, 'M100')).toHaveLength(1);
        const m105 = reg(linhas, 'M105');
        expect(m105.map((l) => campos(l)[2])).toEqual(['01', '02']);
        const soma = m105.reduce((s, l) => s + num(campos(l)[7]), 0);
        expect(soma).toBeCloseTo(num(campos(reg(linhas, 'M100')[0])[4]), 2);
    });

    it('sem crédito (cadastro 73, pessoa física) não há M100 nem M105', () => {
        const pf = nfe(2, 'entrada', [{ vProd: 5000 }], { cnpjEmit: '12345678909' });
        const zero = nfe(3, 'entrada', [{ vProd: 800, ncm: '08039000' }]);
        const linhas = bloco([venda(), pf, zero], [{ ncm: '08039000', cstPisCofinsEntrada: '73' }]);
        expect(reg(linhas, 'M100')).toEqual([]);
        expect(reg(linhas, 'M105')).toEqual([]);
        expect(reg(linhas, 'M505')).toEqual([]);
    });
});
