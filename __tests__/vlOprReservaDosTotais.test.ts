// ============================================================================
// 🚨 O VL_OPR DO C190 SAÍA A MENOR NA NOTA IMPORTADA PELO NAVEGADOR — e o
// "Total da operação" do PVA não fechava com o Vlr. Contábil do Livro
//
// 12/09, Paulo (DISTRIBUIDORA DE BANANAS ELS · 08/2026): *"os valores TOTAL DA
// OPERAÇÃO não bate com meu valor Contábil, e somando CFOP por CFOP bate um
// com o outro, será que ele está pegando descontos de alguma nota?"* — Livro
// 957.467,11 × PVA 955.593,91 (diferença 1.873,20).
//
// MEDIDO: o Livro lê o `vNF` do DOCUMENTO; o C190 soma os ITENS pela régua do
// Guia (mercadorias + frete + seguro + outras + ST + FCP-ST + IPI − desconto).
// O importer do backend grava frete/seguro/outras/FCP-ST POR ITEM desde 04/08;
// o parser do NAVEGADOR (`xmlParserService.ts`) não gravava nenhum dos quatro.
// Nota importada à mão entrava no C190 sem eles — a MENOR pelo valor das
// despesas acessórias — e o PVA aceita: é livro a menor, só a fiscalização vê.
//
// Três metades, no mesmo PR: a FONTE (parser do navegador em paridade com o
// importer), o ACERVO (♻️ Reler itens dos XMLs recupera os quatro campos) e o
// GERADOR (a reserva dos totais quando NENHUM item traz o campo, dita no aviso).
// ============================================================================
import {
    reservaDosTotais, valorOperacaoDosItens, valorOperacaoDoItem, CAMPOS_DA_RESERVA,
} from '../sefaz-backend/valor-operacao-c190.js';
import { CAMPOS_RECUPERAVEIS, mesclarItensRelidos } from '../sefaz-backend/backfill-itens-fiscais.js';
import { VERSAO_RELEITURA_ITENS, extrairItens } from '../sefaz-backend/xml-importer.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';
// @ts-ignore — módulo JS do backend, sem `.d.ts`
import { buildBlocoC, avisosDoValorDaOperacao } from '../sefaz-backend/sped-fiscal-blocoC.js';
import { parseNFeXml } from '../services/xmlParserService';
import { readFileSync } from 'fs';
import { join } from 'path';

const r14 = (linhas: string[]) =>
    (prevalidarSpedFiscal(linhas).erros as any[]).filter(e => e.regra === 'c100-x-c190-totais');

const nota = (over: Record<string, unknown> = {}) => ({
    chaveAcesso: '35260826767102000120550010000000071000000078',
    numero: '7', serie: '1', modelo: '55', direcao: 'entrada', status: 'autorizado',
    dataEmissao: '2026-08-24', cnpjEmit: '26767102000120', xNomeEmit: 'FORNECEDOR',
    cnpjDest: '31947349000169', xNomeDest: 'ELS', ...over,
});
const gerar = (notas: Record<string, unknown>[]) => {
    const dados: any = {
        empresa: { cnpj: '31947349000169', dadosFiscais: { uf: 'SP' } },
        competencia: '2026-08', competenciaInicio: '2026-08', competenciaFim: '2026-08',
        notas, warnings: [],
    };
    const linhas = (buildBlocoC(dados) as string[]).map(l => l.trim());
    return { linhas, warnings: dados.warnings as string[] };
};
const campo = (linha: string, pos: number) => Number(linha.split('|')[pos].replace(/\./g, '').replace(',', '.'));
const vlOprTotal = (linhas: string[]) => linhas.filter(l => l.startsWith('|C190|')).reduce((s, l) => s + campo(l, 5), 0);

// Item como o NAVEGADOR gravava antes de 12/09: sem vFrete/vSeg/vOutro/vFCPST.
const itemNavegador = (n: number, vProd: number, cfop = '5102', cst = '040') => ({
    nItem: String(n), cProd: `P${n}`, xProd: `PRODUTO ${n}`, NCM: '08030000', CFOP: cfop, cfop,
    uCom: 'KG', qCom: 1, vProd, CST: cst, cst, vBC: 0, pICMS: 0, vICMS: 0, vICMSST: 0, vIPI: 0,
});
// Item como o IMPORTER do backend grava: os campos existem, mesmo zerados.
const itemBackend = (n: number, vProd: number, extra: Record<string, unknown> = {}) => ({
    ...itemNavegador(n, vProd), vFrete: 0, vSeg: 0, vOutro: 0, vFCPST: 0, vDesc: null, ...extra,
});

describe('o DONO: a reserva dos totais quando NENHUM item traz o campo', () => {
    it('item sem o campo + total com valor ⇒ reserva; item COM o campo (mesmo zero) ⇒ o item manda', () => {
        const semCampo = { itens: [itemNavegador(1, 1000)], totais: { vFrete: 120, vOutro: 15.71, vNF: 1135.71 } };
        expect(reservaDosTotais(semCampo)).toEqual({
            campos: [
                { campo: 'vFrete', total: 'vFrete', rotulo: 'frete', valor: 120 },
                { campo: 'vOutro', total: 'vOutro', rotulo: 'outras despesas', valor: 15.71 },
            ],
            valor: 135.71,
        });
        // 0 é RESPOSTA: o importer do backend gravou "frete zero" no item, e o
        // total do documento não pode contradizer o item.
        const comCampo = { itens: [itemBackend(1, 1000)], totais: { vFrete: 120, vNF: 1120 } };
        expect(reservaDosTotais(comCampo).valor).toBe(0);
        expect(reservaDosTotais({ itens: [], totais: { vFrete: 120 } }).valor).toBe(0);
    });

    it('o DESCONTO só no total entra com sinal negativo (a outra ponta: VL_OPR a MAIOR)', () => {
        const n = { itens: [itemNavegador(1, 18741.24)], totais: { vDesc: 562.24, vNF: 18179 } };
        expect(reservaDosTotais(n).valor).toBe(-562.24);
        expect(valorOperacaoDosItens(n).porItem).toEqual([18179]);
    });

    it('um item: exato, não rateado; vários: proporcional ao valor, sobra no último, e a soma FECHA', () => {
        const um = valorOperacaoDosItens({ itens: [itemNavegador(1, 1000)], totais: { vFrete: 200, vNF: 1200 } });
        expect(um).toMatchObject({ porItem: [1200], rateado: false });

        const varios = valorOperacaoDosItens({
            itens: [itemNavegador(1, 100), itemNavegador(2, 200), itemNavegador(3, 33.33)],
            totais: { vFrete: 10, vNF: 343.33 },
        });
        expect(varios.rateado).toBe(true);
        const soma = varios.porItem.reduce((a: number, b: number) => a + b, 0);
        expect(Math.round(soma * 100) / 100).toBe(343.33);
        expect(varios.porItem[0]).toBe(103);            // 100 + 10 × 100/333,33 = 3,00
        expect(varios.porItem[1]).toBe(206);            // 200 + 6,00
        expect(varios.porItem[2]).toBe(34.33);          // 33,33 + a sobra (1,00)
    });

    it('sem reserva, nada muda: VL_OPR por item é o de sempre', () => {
        const it = itemBackend(1, 500, { vFrete: 20, vICMSST: 30, vIPI: 5, vDesc: 10 });
        const r = valorOperacaoDosItens({ itens: [it], totais: { vFrete: 20, vST: 30, vIPI: 5, vDesc: 10 } });
        expect(r.porItem).toEqual([valorOperacaoDoItem(it)]);
        expect(r.porItem).toEqual([545]);
        expect(r.reserva.valor).toBe(0);
    });

    it('os sete campos da reserva são os do Guia (campo 05 do C190) e nada mais', () => {
        expect(CAMPOS_DA_RESERVA.map((c) => c.item)).toEqual(['vFrete', 'vSeg', 'vOutro', 'vICMSST', 'vFCPST', 'vIPI', 'vDesc']);
    });
});

describe('o GERADOR: a nota importada pelo navegador entra com o VL_OPR do documento', () => {
    it('um item: VL_OPR = VL_DOC, R14 muda, e o aviso DIZ o que foi levado do total', () => {
        const { linhas, warnings } = gerar([nota({
            valorTotal: 1135.71, totais: { vProd: 1000, vFrete: 120, vOutro: 15.71, vNF: 1135.71 },
            itens: [itemNavegador(1, 1000)],
        })]);
        expect(vlOprTotal(linhas)).toBe(1135.71);
        expect(campo(linhas.find(l => l.startsWith('|C100|'))!, 12)).toBe(1135.71);
        expect(r14(linhas)).toEqual([]);
        const aviso = warnings.find(w => w.startsWith('VL_OPR do C190:'));
        expect(aviso).toContain('1 nota(s)');
        expect(aviso).toContain('frete R$ 120,00 + outras despesas R$ 15,71');
        expect(aviso).not.toContain('nº 7 (frete R$ 120,00 + outras despesas R$ 15,71, rateado');
        expect(aviso).toContain('♻️ Reler itens dos XMLs');
        expect(warnings.find(w => w.startsWith('Total da operação:'))).toBeUndefined();
    });

    it('vários itens em grupos diferentes: a reserva é rateada, dita como rateada, e o C100 continua fechando', () => {
        const { linhas, warnings } = gerar([nota({
            valorTotal: 1010, totais: { vProd: 1000, vFrete: 10, vNF: 1010 },
            itens: [itemNavegador(1, 600, '5102', '040'), itemNavegador(2, 400, '5405', '060')],
        })]);
        const c190 = linhas.filter(l => l.startsWith('|C190|'));
        expect(c190).toHaveLength(2);
        expect(vlOprTotal(linhas)).toBe(1010);
        expect(r14(linhas)).toEqual([]);
        expect(warnings.find(w => w.startsWith('VL_OPR do C190:'))).toContain('rateado');
    });

    it('nota do importer do backend (campos no item) NÃO ganha aviso — o arquivo normal fica mudo', () => {
        const { linhas, warnings } = gerar([nota({
            valorTotal: 1120, totais: { vProd: 1000, vFrete: 120, vNF: 1120 },
            itens: [itemBackend(1, 1000, { vFrete: 120 })],
        })]);
        expect(vlOprTotal(linhas)).toBe(1120);
        expect(warnings.filter(w => /^(VL_OPR do C190|Total da operação)/.test(w))).toEqual([]);
    });

    it('quando NÃO fecha, o aviso diz o total da diferença e nomeia a nota (é a conta que o Paulo fez)', () => {
        // Item do backend com frete ZERO e o total do documento com frete: o
        // item manda (zero é resposta), então o C190 não leva o frete — e o
        // VL_DOC do C100 (que lê o total) fica maior. Isto é o que o PVA mostra
        // como "Total da operação" menor que o Livro; agora vem DITO.
        const { warnings } = gerar([nota({
            valorTotal: 1120, totais: { vProd: 1000, vFrete: 120, vNF: 1120 },
            itens: [itemBackend(1, 1000)],
        })]);
        const aviso = warnings.find(w => w.startsWith('Total da operação:'));
        expect(aviso).toContain('1 nota(s)');
        expect(aviso).toContain('diferença total R$ 120,00');
        expect(aviso).toContain('nº 7 (VL_DOC 1.120,00 × Σ VL_OPR 1.000,00)');
    });

    it('avisosDoValorDaOperacao nasce MUDO', () => {
        expect(avisosDoValorDaOperacao([], [])).toEqual([]);
    });
});

describe('a FONTE: o parser do navegador grava os quatro campos por item (paridade com o importer)', () => {
    const XML = `<?xml version="1.0"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe35260826767102000120550010000000071000000078" versao="4.00">
<ide><cUF>35</cUF><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>7</nNF><dhEmi>2026-08-24T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>
<emit><CNPJ>26767102000120</CNPJ><xNome>FORNECEDOR</xNome><enderEmit><UF>SP</UF></enderEmit></emit>
<dest><CNPJ>31947349000169</CNPJ><xNome>ELS</xNome><enderDest><UF>SP</UF></enderDest></dest>
<det nItem="1"><prod><cProd>1</cProd><xProd>BANANA</xProd><NCM>08030000</NCM><CFOP>5102</CFOP><uCom>KG</uCom><qCom>10</qCom><vUnCom>100</vUnCom><vProd>1000.00</vProd><vFrete>120.00</vFrete><vSeg>3.50</vSeg><vOutro>15.71</vOutro></prod>
<imposto><ICMS><ICMS10><orig>0</orig><CST>10</CST><vBC>1000.00</vBC><pICMS>18.00</pICMS><vICMS>180.00</vICMS><vBCST>1500.00</vBCST><pICMSST>18.00</pICMSST><vICMSST>90.00</vICMSST><vFCPST>30.00</vFCPST></ICMS10></ICMS></imposto></det>
<total><ICMSTot><vBC>1000.00</vBC><vICMS>180.00</vICMS><vST>90.00</vST><vFCPST>30.00</vFCPST><vProd>1000.00</vProd><vFrete>120.00</vFrete><vSeg>3.50</vSeg><vDesc>0.00</vDesc><vIPI>0.00</vIPI><vOutro>15.71</vOutro><vNF>1259.21</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;

    it('vFrete, vSeg, vOutro e vFCPST chegam ao item — e o VL_OPR do item fecha com o vNF', () => {
        const p = parseNFeXml(XML);
        const [it] = p.itens as any[];
        expect(it).toMatchObject({ vFrete: 120, vSeg: 3.5, vOutro: 15.71, vFCPST: 30, vICMSST: 90 });
        expect(valorOperacaoDoItem(it)).toBe(1259.21);
        // paridade com o importer do backend, campo a campo
        const [doBackend] = extrairItens(XML) as any[];
        for (const c of ['vFrete', 'vSeg', 'vOutro', 'vFCPST', 'vICMSST', 'vIPI']) {
            expect(it[c]).toBe(doBackend[c]);
        }
        expect(reservaDosTotais(p as any).valor).toBe(0);
    });
});

describe('o ACERVO: o ♻️ Reler itens recupera os quatro campos do XML guardado', () => {
    it('os quatro entram em CAMPOS_RECUPERAVEIS e a versão da releitura subiu (a nota carimbada v1 passa de novo)', () => {
        for (const c of ['vFrete', 'vSeg', 'vOutro', 'vFCPST']) expect(CAMPOS_RECUPERAVEIS).toContain(c);
        expect(VERSAO_RELEITURA_ITENS).toBeGreaterThanOrEqual(2);
    });

    it('preenche só o que está VAZIO — o item que já tem frete zero não é tocado', () => {
        const gravados = [{ nItem: '1', vProd: 1000 }, { nItem: '2', vProd: 500, vFrete: 0 }];
        const doXml = [{ nItem: '1', vFrete: 120, vSeg: 0, vOutro: 15.71, vFCPST: 0 }, { nItem: '2', vFrete: 7 }];
        const r = mesclarItensRelidos(gravados, doXml);
        expect(r.itens[0]).toMatchObject({ vFrete: 120, vSeg: 0, vOutro: 15.71, vFCPST: 0 });
        expect(r.itens[1].vFrete).toBe(0);
        expect(r.campos.vFrete).toBe(1);
    });

    it('a aba ✏️ CFOP por nota oferece o botão — é para lá que o aviso da geração aponta', () => {
        const tela = readFileSync(join(__dirname, '..', 'components', 'Relatorios', 'index.tsx'), 'utf8');
        expect(tela).toContain("'♻️ Reler itens dos XMLs'");
        expect(tela).toContain('relerItensFiscais(empresa.id, competencia)');
    });
});

describe('a LIGAÇÃO (prova por varredura): o C190 soma pela régua com a reserva', () => {
    it('o bloco C lê valorOperacaoDosItens e nunca mais soma o item cru', () => {
        const src = readFileSync(join(__dirname, '..', 'sefaz-backend', 'sped-fiscal-blocoC.js'), 'utf8');
        expect(src).toContain('g.vlOpr += vlOprPorItem[idx];');
        expect(src).not.toMatch(/g\.vlOpr \+= valorOperacaoDoItem\(/);
        expect(src).toContain('avisosDoValorDaOperacao(comReserva, divergentes)');
    });
});
