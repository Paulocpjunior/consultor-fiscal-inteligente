/**
 * 🧾 ICMS-ST POR OPERAÇÃO — o E250 de quem NÃO tem IE de substituto no destino
 * (14/10).
 *
 * Paulo, FASTWELD, exemplo real do PVA, MG 09/2026: E210 com VL_ICMS_RECOL_ST
 * 642,40 e DOIS E250 — COD_OR 002, 185,98 vencendo 08/09/2026 e 456,42
 * vencendo 16/09/2026, os dois com COD_REC 100099 ("ICMS Subst. Tributária
 * por Operação", 10009-9) e MES_REF 092026. A apuração é mensal; a guia é
 * paga a cada saída.
 *
 * Fatos cobrados: o cadastro aceita a forma "por operação" sem dia de
 * vencimento; forma e código que se contradizem são recusados; o gerador real
 * do bloco E solta UM E250 POR NOTA, vencimento = data de emissão, somando o
 * E210; e quando não dá para afirmar nota a nota (data ilegível, soma que não
 * fecha) nada é inventado — vai dito.
 */
import {
    validarCadastroStUf, obrigacoesStDoCadastro, codigoReceitaStPorOperacao,
} from '../sefaz-backend/st-cadastro-uf.js';
import { montarLinhasStBlocoE } from '../sefaz-backend/sped-bloco-e-st.js';

const MG_OPERACAO = { uf: 'MG', ie: '', codOr: '002', codRec: '100099', forma: 'operacao' };

/** Saída com ST retido para MG — a forma da nota capturada (`ufDest` achatado). */
const saidaMg = (numero: string, dhEmi: string, vST: number) => ({
    numero, dhEmi,
    direcao: 'saida', status: 'autorizado', modelo: '55', tpNF: '1',
    ufDest: 'MG', empresaCnpj: '11222333000181',
    totais: { vST },
    itens: [{ cfop: '6403', vST }],
});

const gerar = (notas: any[], obrigacoesPorUf: any) => montarLinhasStBlocoE({
    notas, ufEmpresa: 'SP', ajustes: [], dtIni: '01092026', dtFin: '30092026', obrigacoesPorUf,
});

describe('o cadastro aceita a UF por operação', () => {
    it('sem dia de vencimento: grava, com forma e dia nulo', () => {
        expect(validarCadastroStUf([MG_OPERACAO])).toEqual({
            ok: true, ufs: { MG: { ie: '', codOr: '002', codRec: '100099', forma: 'operacao', diaVencimento: null } },
        });
    });

    it('mensal e por operação convivem na mesma empresa', () => {
        const v = validarCadastroStUf([MG_OPERACAO, { uf: 'PR', codOr: '002', codRec: '100048', diaVencimento: 9 }]);
        expect(v.ok).toBe(true);
    });

    it.each([
        ['100099 marcado como mensal', { ...MG_OPERACAO, forma: 'mensal', diaVencimento: 9 }, /POR OPERAÇÃO e a UF está como "mensal"/],
        ['100048 marcado como por operação', { ...MG_OPERACAO, codRec: '100048' }, /por APURAÇÃO/],
        ['forma que não existe', { ...MG_OPERACAO, forma: 'trimestral' }, /forma de recolhimento/],
    ])('%s: recusa e diz', (_n, linha, erro) => {
        const v = validarCadastroStUf([linha]);
        expect(v.ok).toBe(false);
        expect(!v.ok && v.erros.join(' ')).toMatch(erro as RegExp);
    });

    it('o código 10009-9, com dígito e traço, é o da GNRE por operação', () => {
        expect(codigoReceitaStPorOperacao('10009-9')).toBe(true);
        expect(codigoReceitaStPorOperacao('100048')).toBe(false);
    });

    it('a obrigação da competência é "por operação", sem vencimento único', () => {
        expect(obrigacoesStDoCadastro({ ufs: { MG: MG_OPERACAO } }, '2026-09').obrigacoes).toEqual({
            MG: { dtVcto: '', codRec: '100099', codOr: '002', origem: 'cadastro', porOperacao: true },
        });
    });
});

describe('o gerador real do bloco E — exemplo da FASTWELD, MG 09/2026', () => {
    const { obrigacoes } = obrigacoesStDoCadastro({ ufs: { MG: MG_OPERACAO } }, '2026-09');
    // Fora de ordem de propósito: quem ordena é o gerador, pela data.
    const notas = [saidaMg('2210', '2026-09-16T09:12:00-03:00', 456.42), saidaMg('2187', '2026-09-08T15:40:00-03:00', 185.98)];
    const r = gerar(notas, obrigacoes);
    const e250 = r.linhas.filter((l: any) => l[0] === 'E250');
    const e210 = r.linhas.find((l: any) => l[0] === 'E210') as string[];

    it('o E210 apura o mês: 642,40', () => {
        expect(e210[12]).toBe('642,40');   // [0]=REG … [12]=VL_ICMS_RECOL_ST
    });

    it('um E250 por nota, vencimento = data de emissão, receita 100099', () => {
        expect(e250).toEqual([
            ['E250', '002', '185,98', '08092026', '100099', '', '', '', '', '092026'],
            ['E250', '002', '456,42', '16092026', '100099', '', '', '', '', '092026'],
        ]);
    });

    it('os E250 somam o VL_ICMS_RECOL_ST do E210', () => {
        const soma = e250.reduce((t: number, l: any) => t + Number(String(l[2]).replace(',', '.')), 0);
        expect(soma.toFixed(2)).toBe('642.40');
    });

    it('o aviso diz que saiu por operação', () => {
        expect(r.avisos.join(' ')).toMatch(/2 E250 por operação/);
    });

    it('o código 100099 lançado SÓ na competência também sai por nota', () => {
        const so = gerar(notas, { MG: { dtVcto: '30092026', codRec: '100099' } });
        expect(so.linhas.filter((l: any) => l[0] === 'E250').map((l: any) => l[3])).toEqual(['08092026', '16092026']);
    });
});

describe('quando não dá para afirmar nota a nota, nada é inventado', () => {
    const { obrigacoes } = obrigacoesStDoCadastro({ ufs: { MG: MG_OPERACAO } }, '2026-09');

    it('nota sem data legível: sem E250, e o aviso nomeia a nota', () => {
        const r = gerar([saidaMg('2187', '2026-09-08', 185.98), saidaMg('2210', '', 456.42)], obrigacoes);
        expect(r.linhas.find((l: any) => l[0] === 'E250')).toBeUndefined();
        expect(r.avisos.join(' ')).toMatch(/sem data de emissão legível \(nº 2210\)/);
    });

    it('com vencimento lançado na competência, cai na linha única e diz por quê', () => {
        const r = gerar([saidaMg('2210', '', 456.42)], { MG: { dtVcto: '30092026', codRec: '100099', codOr: '002' } });
        expect(r.linhas.filter((l: any) => l[0] === 'E250')).toEqual([
            ['E250', '002', '456,42', '30092026', '100099', '', '', '', '', '092026'],
        ]);
        expect(r.avisos.join(' ')).toMatch(/linha única/);
    });

    it('a UF mensal do mesmo cadastro segue com uma guia só', () => {
        const cad = obrigacoesStDoCadastro({
            ufs: { MG: MG_OPERACAO, PR: { codOr: '002', codRec: '100048', diaVencimento: 9 } },
        }, '2026-09').obrigacoes;
        const pr = { ...saidaMg('3000', '2026-09-10', 100), ufDest: 'PR' };
        const r = gerar([pr, saidaMg('2187', '2026-09-08', 185.98)], cad);
        expect(r.linhas.filter((l: any) => l[0] === 'E250')).toEqual([
            ['E250', '002', '185,98', '08092026', '100099', '', '', '', '', '092026'],
            ['E250', '002', '100,00', '09102026', '100048', '', '', '', '', '092026'],
        ]);
    });
});
