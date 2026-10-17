/**
 * 📕 REGISTRO DE APURAÇÃO DO ICMS-ST POR UF (17/10, modelo do e-Fiscal da REALITY).
 *
 * Paulo mandou o RAICMS-ST da REALITY 09/2026: saídas com ST no CFOP 5.401 e o
 * demonstrativo com 001 = 004 = 011 = 013 = 1.330,86 (ICMS-ST a recolher).
 *
 * Fatos cobrados: o livro lê as linhas do MESMO gerador do E200/E210 (nenhuma
 * conta própria); 001 = retenção, 011/013 = saldo devedor e a recolher; as
 * saídas por CFOP somam o 001; os ajustes E220 vão para 002/003/006/007 pelo
 * 4º caractere do código, com o histórico na Coluna Auxiliar; e a guia (E250)
 * vem junto.
 */
import { montarRaicmsSt } from '../sefaz-backend/apuracao-icms-st-raicms.js';
import { montarLinhasStBlocoE } from '../sefaz-backend/sped-bloco-e-st.js';

const saidaSp: any = {
    numero: '9001', direcao: 'saida', tpNF: '1', modelo: '55', status: 'autorizado',
    empresaCnpj: '00935141000104', cnpjEmit: '00935141000104', ufDest: 'SP', dataEmissao: '2026-09-15',
    totais: { vNF: 11330.86, vST: 1330.86 },
    itens: [{ cfop: '5401', vProd: 10000, vBCST: 13500, vICMSST: 1330.86 }],
};

describe('REALITY 09/2026 — ICMS-ST interno de SP', () => {
    const st = montarLinhasStBlocoE({
        notas: [saidaSp], ufEmpresa: 'SP', ajustes: [], dtIni: '01092026', dtFin: '30092026', obrigacoesPorUf: {},
    });
    const [sp] = montarRaicmsSt({ linhas: st.linhas, notas: [saidaSp] });

    it('uma seção para SP, com a saída 5.401', () => {
        expect(sp!.uf).toBe('SP');
        expect(sp!.saidas).toEqual([{ cfop: '5401', notas: 1, vlCont: 11330.86, bcSt: 13500, icmsSt: 1330.86, fcpSt: 0 }]);
    });

    it('demonstrativo: 001 = 004 = 011 = 013 = 1.330,86, como o e-Fiscal', () => {
        const d = Object.fromEntries(sp!.demonstrativo.map((l) => [l.codigo, l.soma]));
        expect(d).toMatchObject({ '001': 1330.86, '004': 1330.86, '005': 0, '008': 0, '009': 0, '010': 0, '011': 1330.86, '012': 0, '013': 1330.86, '014': 0 });
        expect(sp!.devedor).toBe(true);
        expect(sp!.impostoARecolher).toBe(1330.86);
        expect(sp!.avisos).toEqual([]);
    });
});

describe('ajustes E220 e guia E250 vão para o lugar certo', () => {
    // Linhas na forma do gerador (arrays de campos) — E210 com 100 de retenção,
    // 30 de outros débitos (E220 4º = '0') e 10 de outros créditos (4º = '2').
    const linhas = [
        ['E200', 'SP', '01092026', '30092026'],
        ['E210', '1', '0,00', '0,00', '0,00', '10,00', '0,00', '100,00', '30,00', '0,00', '120,00', '0,00', '120,00', '0,00', '0,00'],
        ['E220', 'SP100001', 'Débito de diferença de ST', '30,00'],
        ['E220', 'SP120001', 'Crédito de ressarcimento', '10,00'],
        ['E250', '001', '120,00', '09102026', '100048', '', '', '', '', '092026'],
    ];
    const [sp] = montarRaicmsSt({ linhas, notas: [] });

    it('E220 tipo 0 → 002 e tipo 2 → 006, cada um com o histórico na Coluna Auxiliar', () => {
        const por = Object.fromEntries(sp!.demonstrativo.map((l) => [l.codigo, l]));
        expect(por['002']).toMatchObject({ soma: 30, itens: [{ codigo: 'SP100001', historico: 'Débito de diferença de ST', valor: 30 }] });
        expect(por['006']).toMatchObject({ soma: 10, itens: [{ codigo: 'SP120001', valor: 10 }] });
        expect(por['004']!.soma).toBe(130);
        expect(por['013']!.soma).toBe(120);
    });

    it('a guia do E250 vem com valor, receita e vencimento', () => {
        expect(sp!.obrigacoes).toEqual([{ codOr: '001', valor: 120, vencimento: '09102026', codRec: '100048', mesRef: '092026' }]);
    });

    it('sem saídas com ST nos documentos, o 001 que não fecha é DITO', () => {
        expect(sp!.avisos.join(' ')).toMatch(/não fecha com o débito do E210/);
    });
});
