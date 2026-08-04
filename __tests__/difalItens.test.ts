/**
 * Classificação POR ITEM do DIFAL — caso NF 6831.
 *
 * Paulo, 04/08: "algumas notas podem ter mais de um CFOP, mais de um produto,
 * mais de um código de NCM, isso deve ser tratado OBRIGATORIAMENTE, não pode
 * aglutinar; alguns itens podem conter ST ou não."
 *
 * A nota real (UNIVERSAL IMPORTACAO RJ → JOTASUL SP, 17/06/2026):
 *   item 1 — CFOP 6102, CST 00, NCM 84834090 → SEM ST
 *   item 2 — CFOP 6403, CST 10, NCM 87089990 → COM ST
 *   item 3 — CFOP 6403, CST 10, NCM 87089990 → COM ST
 * Totais: BC ICMS 1.097,52 · ICMS 62,38 · BC ST 958,40 · ICMS ST 110,14
 */
import {
    itemTemSt, classificarItensDifal, encargosDoItem, linhasDeItem,
} from '../sefaz-backend/difal-itens.js';
import { montarDifalMensal } from '../sefaz-backend/difal-aquisicao.js';
import { apurarAntecipacoes426APorItem } from '../sefaz-backend/difal-426a.js';

const NF6831 = {
    chave: '33260633739848000196550010000068310218213820',
    numero: '6831',
    dhEmi: '2026-06-17T15:50:57',
    status: 'autorizado',
    direcao: 'entrada',
    cnpjEmit: '33739848000196',
    xNomeEmit: 'UNIVERSAL IMPORTACAO EXPORTACAO E COMERCIO LIMITADA',
    totais: { vProd: 1097.52, vBC: 1097.52, vICMS: 62.38, vBCST: 958.40, vST: 110.14, vNF: 1207.66 },
    itens: [
        {
            nItem: '1', cProd: 'UIEC-00012967', xProd: 'ENGRENAGEM ENT.HELIC.31D.H.E.',
            ncm: '84834090', cfop: '6102', cst: '00', orig: '0',
            vProd: 577.64, vBC: 577.64, vICMS: 0, aliqIcms: 0,
        },
        {
            nItem: '2', cProd: 'UIEC-00015032', xProd: 'TAMPA MCAL.ARTIC.',
            ncm: '87089990', cfop: '6403', cst: '10', orig: '0',
            vProd: 321.84, vBC: 321.84, vICMS: 38.62, aliqIcms: 12,
        },
        {
            nItem: '3', cProd: 'UIEC-00008810', xProd: 'CASTANHA CAPA',
            ncm: '87089990', cfop: '6403', cst: '10', orig: '0',
            vProd: 198.04, vBC: 198.04, vICMS: 23.76, aliqIcms: 12,
        },
    ],
};

describe('itemTemSt', () => {
    it('CST 10 (tributada com ST) tem ST', () => {
        expect(itemTemSt({ cst: '10' })).toBe(true);
    });

    it('CST 00 não tem', () => {
        expect(itemTemSt({ cst: '00' })).toBe(false);
    });

    it('CST 60 (ST já cobrada anteriormente) tem', () => {
        expect(itemTemSt({ cst: '60' })).toBe(true);
    });

    it('CSOSN do Simples (201/202/203/500) tem', () => {
        for (const c of ['201', '202', '203', '500']) {
            expect(itemTemSt({ cst: c })).toBe(true);
        }
    });

    it('CSOSN 102 (Simples sem ST) NÃO tem — três dígitos não é atalho', () => {
        expect(itemTemSt({ cst: '102' })).toBe(false);
    });

    it('valor destacado vence a classificação do emitente', () => {
        expect(itemTemSt({ cst: '00', vICMSST: 10 })).toBe(true);
        expect(itemTemSt({ cst: '00', vBCST: 100 })).toBe(true);
    });

    it('CFOP 6403 sinaliza ST mesmo sem CST', () => {
        expect(itemTemSt({ cfop: '6403' })).toBe(true);
        expect(itemTemSt({ cfop: '6102' })).toBe(false);
    });
});

describe('classificarItensDifal — a NF 6831 é MISTA', () => {
    const r = classificarItensDifal(NF6831);

    it('separa 1 item sem ST e 2 com ST', () => {
        expect(r.semSt.map(i => i.nItem)).toEqual(['1']);
        expect(r.comSt.map(i => i.nItem)).toEqual(['2', '3']);
    });

    it('marca a nota como MISTA — tratar no nível do documento estaria errado', () => {
        expect(r.mista).toBe(true);
    });

    it('preserva NCM e CFOP de cada item (nada é aglutinado)', () => {
        expect(r.semSt[0]).toMatchObject({ ncm: '84834090', cfop: '6102' });
        expect(r.comSt[0]).toMatchObject({ ncm: '87089990', cfop: '6403' });
        expect(r.comSt[1]).toMatchObject({ ncm: '87089990', cfop: '6403' });
    });

    it('a soma dos itens bate com o total de produtos da nota', () => {
        const soma = r.itens.reduce((s, i) => s + i.valorProduto, 0);
        expect(Math.round(soma * 100) / 100).toBe(1097.52);
    });
});

describe('encargosDoItem', () => {
    it('usa o valor do PRÓPRIO item quando a nota traz', () => {
        const e = encargosDoItem({ vProd: 100, vFrete: 10, vSeg: 2, vOutro: 1, vIPI: 5 }, NF6831);
        expect(e).toEqual({ frete: 10, seguro: 2, outros: 1, ipi: 5, rateados: false });
    });

    it('rateia o total proporcionalmente quando o item não tem — e AVISA', () => {
        const nota = {
            totais: { vFrete: 100, vSeg: 0, vOutro: 0 },
            itens: [{ vProd: 300 }, { vProd: 100 }],
        };
        const e = encargosDoItem(nota.itens[0], nota);
        expect(e.frete).toBe(75);          // 300/400 de 100
        expect(e.rateados).toBe(true);
    });

    it('nota sem encargo nenhum não vira aviso de rateio', () => {
        expect(encargosDoItem({ vProd: 100 }, NF6831).rateados).toBe(false);
    });
});

describe('montarDifalMensal com nota MISTA', () => {
    const r = montarDifalMensal({
        docs: [NF6831],
        empresa: { cnpj: '26929226000165', uf: 'SP' },
    });

    it('a nota aparece nas DUAS listas — cada uma com os seus itens', () => {
        expect(r.linhas).toHaveLength(1);
        expect(r.antecipacaoIndividual).toHaveLength(1);
        expect(r.linhas[0].chave).toBe(r.antecipacaoIndividual[0].chave);
    });

    it('o consolidado usa SÓ o item sem ST (577,64), não a nota inteira', () => {
        expect(r.linhas[0].base).toBe(577.64);
        expect(r.linhas[0].itensConsiderados).toBe(1);
        expect(r.linhas[0].itens[0].ncm).toBe('84834090');
    });

    it('o 426-A leva SÓ os itens com ST (321,84 + 198,04)', () => {
        const a = r.antecipacaoIndividual[0];
        expect(a.itensConsiderados).toBe(2);
        expect(a.base).toBe(519.88);
        expect(a.itens.map((i: any) => i.nItem)).toEqual(['2', '3']);
    });

    it('a nota fica marcada como mista, pra tela não parecer duplicidade', () => {
        expect(r.linhas[0].notaMista).toBe(true);
        expect(r.antecipacaoIndividual[0].notaMista).toBe(true);
    });

    it('a ressalva explica que aparecer nas duas listas é o certo', () => {
        expect(r.ressalvas.join(' ')).toMatch(/não é duplicidade/);
        expect(r.ressalvas.join(' ')).toMatch(/POR ITEM/);
    });
});

describe('apurarAntecipacoes426APorItem', () => {
    const comSt = montarDifalMensal({
        docs: [NF6831],
        empresa: { cnpj: '26929226000165', uf: 'SP' },
    }).antecipacaoIndividual;

    it('sem IVA-ST em NENHUM item: a guia NÃO é liberada e o total é zero', () => {
        const r = apurarAntecipacoes426APorItem(comSt, {}, 18);
        expect(r.documentos[0].guiaLiberada).toBe(false);
        expect(r.documentos[0].itensPendentes).toBe(2);
        expect(r.totalAntecipacao).toBe(0);
    });

    it('com IVA-ST em SÓ UM item, a guia continua bloqueada — sairia a menor', () => {
        const r = apurarAntecipacoes426APorItem(
            comSt, { [`${comSt[0].chave}|2`]: { ivaSt: 40 } }, 18,
        );
        expect(r.resumo.itensCalculados).toBe(1);
        expect(r.resumo.itensPendentes).toBe(1);
        expect(r.documentos[0].guiaLiberada).toBe(false);
        expect(r.totalAntecipacao).toBe(0);
    });

    it('com IVA-ST nos DOIS itens, a guia libera e o total é a soma dos itens', () => {
        const chave = comSt[0].chave;
        const r = apurarAntecipacoes426APorItem(
            comSt,
            { [`${chave}|2`]: { ivaSt: 40 }, [`${chave}|3`]: { ivaSt: 40 } },
            18,
        );
        expect(r.documentos[0].guiaLiberada).toBe(true);
        expect(r.resumo.itensCalculados).toBe(2);
        const soma = r.documentos[0].itens.reduce((s: number, i: any) => s + i.antecipacao, 0);
        expect(r.totalAntecipacao).toBeCloseTo(soma, 2);
        expect(r.totalAntecipacao).toBeGreaterThan(0);
    });

    it('NCMs diferentes podem receber IVA-ST diferentes — é o ponto da mudança', () => {
        const chave = comSt[0].chave;
        const r = apurarAntecipacoes426APorItem(
            comSt,
            { [`${chave}|2`]: { ivaSt: 40 }, [`${chave}|3`]: { ivaSt: 71.6 } },
            18,
        );
        const [i2, i3] = r.documentos[0].itens;
        expect(i2.ivaSt).toBe(40);
        expect(i3.ivaSt).toBe(71.6);
        expect(i2.ivaAplicado).not.toBe(i3.ivaAplicado);
    });

    it('deixa escrito que a guia só sai com o documento inteiro calculado', () => {
        const r = apurarAntecipacoes426APorItem(comSt, {}, 18);
        expect(r.ressalvas.join(' ')).toMatch(/TODOS os itens/);
        expect(r.ressalvas.join(' ')).toMatch(/NÃO é item isento/);
    });
});

describe('ST no total sem destaque por item (captura antiga)', () => {
    // Não dá pra partir com segurança. As duas saídas silenciosas são ruins:
    // mandar tudo pro consolidado IGNORA a ST; mandar tudo pro 426-A sem
    // avisar é a aglutinação que estamos consertando.
    const notaSemDetalhe = {
        ...NF6831,
        chave: '33260633739848000196550010000099990218213820',   // RJ na chave
        totais: { ...NF6831.totais, vST: 110.14 },
        itens: [{ nItem: '1', vProd: 1000, vBC: 1000, vICMS: 120, aliqIcms: 12 }],
    };

    const r = montarDifalMensal({
        docs: [notaSemDetalhe],
        empresa: { cnpj: '26929226000165', uf: 'SP' },
    });

    it('vai INTEIRA para o 426-A — o lado que não subtributa', () => {
        expect(r.linhas).toHaveLength(0);
        expect(r.antecipacaoIndividual).toHaveLength(1);
    });

    it('fica MARCADA para conferência humana, não passa calada', () => {
        expect(r.antecipacaoIndividual[0].stSemDetalhePorItem).toBe(true);
        expect(r.avisos.join(' ')).toMatch(/nenhum item traz o destaque/);
        expect(r.avisos.join(' ')).toMatch(/confira item a item/);
    });
});
