/**
 * 🧪 RELATÓRIO PIS/COFINS MONOFÁSICO × TRIBUTADO — trava de 30/09 (UNIKE 08/2026).
 *
 * O arquivo que o Paulo acertou à mão no PVA é o espelho: M220 = 15,35 e
 * M620 = 70,85, ou seja 2.361,61 de devoluções (CFOP 1411) de NCM que a UNIKE
 * vende TRIBUTADO (rolamentos 8482) × 0,65% / 3%. Os 4.333,33 restantes são
 * devolução de NCM que ela vende MONOFÁSICO (radiador 8708.91). A fixture usa
 * esses números e passa pela MESMA leitura do arquivo (`linhasDoPeriodo` →
 * `lerPisCofinsDosItens`), não por uma conta paralela.
 */
import {
    linhasDoPeriodo, montarRelatorioMonofasico, csvDoRelatorio, ehCfopDevolucaoDeVenda, classeDoCstDeSaida,
} from '../sefaz-backend/relatorio-monofasico.js';
import { buildBlocoC_Contrib, aliquotasDoRegime } from '../sefaz-backend/sped-contrib-blocos.js';

const UNIKE = '31633553000105';
const CLIENTE = '69233583000105';
let seq = 0;
const chave = (cnpj: string) => `3526${'08'}${cnpj}55001${String(++seq).padStart(9, '0')}1${'0'.repeat(8)}`;
const item = (over: any) => ({
    nItem: 1, codigo: 'X', descricao: 'ITEM', unidade: 'PC', quantidade: 1, vDesc: 0, vICMS: 0, vPIS: 0, vCOFINS: 0, ...over,
});
/** Venda da UNIKE (NF-e própria, saída). */
const venda = (itens: any[]) => ({
    tipo: 'NFe', direcao: 'saida', numero: String(8000 + seq), modFrete: '9', tpNF: '1',
    chave: chave(UNIKE), dataEmissao: '2026-08-10', cnpjEmit: UNIKE, cnpjDest: CLIENTE, itens,
});
/** Devolução emitida pelo CLIENTE (5411 dele → 1411 na UNIKE), com o código de produto DELE. */
const devolucao = (itens: any[]) => ({
    tipo: 'NFe', direcao: 'entrada', numero: String(2800 + seq), modFrete: '9', tpNF: '1',
    chave: chave(CLIENTE), dataEmissao: '2026-08-20', cnpjEmit: CLIENTE, cnpjDest: UNIKE, itens,
});

const notas = [
    venda([
        item({ nItem: 1, codigo: 'IR18695', descricao: 'ROLAMENTO RODA', ncm: '84821010', cfop: '5405', vProd: 1000, cstPis: '01', cstCofins: '01' }),
        item({ nItem: 2, codigo: 'IR48233', descricao: 'RADIADOR', ncm: '87089100', cfop: '5405', vProd: 5000, cstPis: '04', cstCofins: '04' }),
        item({ nItem: 3, codigo: 'IR12223', descricao: 'ROLAMENTO DUPLO', ncm: '84822010', cfop: '5405', vProd: 400, cstPis: '01', cstCofins: '01' }),
        item({ nItem: 4, codigo: 'IR18650', descricao: 'CUBO', ncm: '87089990', cfop: '5405', vProd: 300, cstPis: '04', cstCofins: '04' }),
    ]),
    venda([item({ codigo: 'BRINDE', descricao: 'BONIFICACAO', ncm: '87089100', cfop: '5910', vProd: 50, cstPis: '49', cstCofins: '49' })]),
    devolucao([
        item({ nItem: 1, codigo: '185233', descricao: 'ROLAMENTO RODA IR18065', ncm: '84821010', cfop: '5411', vProd: 2016.21, cstPis: '99', cstCofins: '99' }),
        item({ nItem: 2, codigo: '57447', descricao: 'ROL RODA DIANT JUMPY', ncm: '84822010', cfop: '5411', vProd: 345.40, cstPis: '99', cstCofins: '99' }),
        item({ nItem: 3, codigo: 'PG 0377-IRB', descricao: 'RADIADOR DE AGUA', ncm: '87089100', cfop: '5411', vProd: 3528.73, cstPis: '99', cstCofins: '99' }),
        item({ nItem: 4, codigo: '1100158', descricao: 'CUBO RODA TRASEIRO', ncm: '87089990', cfop: '5411', vProd: 804.60, cstPis: '99', cstCofins: '99' }),
    ]),
    // Compra comum: não é receita nem devolução — fica fora do relatório.
    devolucao([item({ codigo: 'C1', ncm: '84821010', cfop: '5405', vProd: 999, cstPis: '01', cstCofins: '01' })]),
];

const dados = () => ({
    empresa: { cnpj: UNIKE }, regimeApuracao: '2', warnings: [] as string[],
    notas: JSON.parse(JSON.stringify(notas)),
});

describe('a régua da devolução de venda', () => {
    it('vem da descrição OFICIAL do CFOP de entrada', () => {
        for (const c of ['1201', '1202', '1411', '2202', '2411', '3202']) expect(ehCfopDevolucaoDeVenda(c)).toBe(true);
        for (const c of ['1403', '1102', '5411', '1949', '1910', '']) expect(ehCfopDevolucaoDeVenda(c)).toBe(false);
    });

    it('a classe da saída sai do CST', () => {
        expect(classeDoCstDeSaida('01')).toBe('tributada');
        expect(classeDoCstDeSaida('04')).toBe('monofasica');
        expect(classeDoCstDeSaida('06')).toBe('nao-tributada');
        expect(classeDoCstDeSaida('49')).toBe('outras');
    });
});

describe('UNIKE 08/2026 — o espelho do M220/M620 feito à mão', () => {
    const d = dados();
    const linhas = linhasDoPeriodo(d);
    const rel = montarRelatorioMonofasico(linhas, { aliquotas: aliquotasDoRegime('2') });

    it('lê só saídas e devoluções de venda (a compra comum fica fora)', () => {
        expect(linhas.filter((l) => l.tipo === 'saida')).toHaveLength(5);
        expect(linhas.filter((l) => l.tipo === 'devolucao')).toHaveLength(4);
        expect(linhas.every((l) => l.tipo === 'saida' || l.cfop === '1411')).toBe(true);
    });

    it('separa a receita tributada, a monofásica e a que não é receita', () => {
        expect(rel.receitas.tributada.valor).toBeCloseTo(1400, 2);
        expect(rel.receitas.monofasica.valor).toBeCloseTo(5300, 2);
        expect(rel.receitas.outras.valor).toBeCloseTo(50, 2);
    });

    it('a devolução herda a classe com que a EMPRESA vendeu o NCM — não o CST do cliente', () => {
        expect(rel.devolucoes.tributada.valor).toBeCloseTo(2361.61, 2);
        expect(rel.devolucoes.monofasica.valor).toBeCloseTo(4333.33, 2);
        expect(rel.pendentes.itens).toBe(0);
    });

    it('o ajuste de redução é o M220/M620 que o Paulo lançou no PVA: 15,35 e 70,85', () => {
        expect(rel.ajusteReducao).toEqual({ base: 2361.61, pis: 15.35, cofins: 70.85 });
    });

    it('o apurado é o do C170 do arquivo — o relatório não tem conta própria', () => {
        const c170 = buildBlocoC_Contrib(dados()).filter((l) => l.startsWith('|C170|')).map((l) => l.split('|'));
        const num = (s: string) => Number(String(s).replace(',', '.'));
        const saidas = c170.filter((c) => c[11].startsWith('5'));
        const pisArquivo = saidas.reduce((s, c) => s + num(c[30]), 0);
        expect(rel.apurado.pis).toBeCloseTo(pisArquivo, 2);
        expect(rel.aRecolher.pis).toBeCloseTo(rel.apurado.pis - 15.35, 2);
    });

    it('o CSV sai com uma linha por item e a classe de cada devolução dita', () => {
        const csv = csvDoRelatorio(rel).trim().split('\r\n');
        expect(csv).toHaveLength(1 + linhas.length);
        const rolamento = csv.find((l) => l.includes('185233')) as string;
        expect(rolamento).toMatch(/^DEVOLUÇÃO DE VENDA;/);
        expect(rolamento).toMatch(/;Tributada;/);
        expect(rolamento).toMatch(/2016,21/);
    });
});

describe('alerta, nunca contorno', () => {
    it('NCM sem venda no mês ou vendido com duas classes fica PENDENTE e fora do ajuste', () => {
        const base = [
            { tipo: 'saida', ncm: '1', liquido: 100, base: 100, pis: 0.65, cofins: 3, cstPis: '01' },
            { tipo: 'saida', ncm: '1', liquido: 100, base: 0, pis: 0, cofins: 0, cstPis: '04' },
            { tipo: 'devolucao', ncm: '1', liquido: 50, base: 50, pis: 0, cofins: 0, cstPis: '70' },
            { tipo: 'devolucao', ncm: '2', liquido: 30, base: 30, pis: 0, cofins: 0, cstPis: '70' },
        ] as any[];
        const rel = montarRelatorioMonofasico(base);
        expect(rel.linhas.filter((l) => l.tipo === 'devolucao').map((l) => l.pendencia)).toEqual(['ambigua', 'sem-venda']);
        expect(rel.pendentes).toMatchObject({ itens: 2, valor: 80 });
        expect(rel.ajusteReducao).toEqual({ base: 0, pis: 0, cofins: 0 });
        expect(rel.avisos.join(' ')).toMatch(/PENDENTE/);
    });
});
