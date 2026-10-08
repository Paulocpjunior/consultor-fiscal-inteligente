/**
 * 🏛️ IE DE SUBSTITUTO POR UF — o E250 do recolhimento MENSAL do ICMS-ST (08/10).
 *
 * Paulo, FLANACAR (IE de ST em todos os estados), exemplo real do PVA, PR
 * 09/2026: E210 com VL_ICMS_RECOL_ST 6.345,59 e E250 COD_OR 002, valor
 * 6.345,59, vencimento 09/10/2026, COD_REC 100048, MES_REF 092026. O E250 só
 * saía com vencimento e código digitados EM CADA competência.
 *
 * Fatos cobrados: o cadastro fixo gera a obrigação de qualquer competência
 * (vencimento no dia informado do mês seguinte, virando o ano em dezembro); o
 * lançado na competência vence o cadastro; o E250 do gerador real sai com o
 * COD_OR do cadastro; e o que é inválido não vira guia.
 */
import {
    validarCadastroStUf, vencimentoNoMesSeguinte, obrigacoesStDoCadastro, mesclarObrigacoesSt,
} from '../sefaz-backend/st-cadastro-uf.js';
import { montarLinhasStBlocoE } from '../sefaz-backend/sped-bloco-e-st.js';

const PR = { uf: 'PR', ie: '9012345678', codOr: '002', codRec: '100048', diaVencimento: 9 };

/** Saída com ST retido para o PR — a forma do fixture de R26. */
const saidaPr = (vST: number) => ({
    direcao: 'saida', status: 'autorizado', modelo: '55', tpNF: '1',
    ufDest: 'PR', empresaCnpj: '96312889000111',
    totais: { vST },
    itens: [{ cfop: '6403', vST }],
});

describe('o cadastro confere antes de gravar', () => {
    it('a linha do exemplo real passa', () => {
        expect(validarCadastroStUf([PR])).toEqual({
            ok: true, ufs: { PR: { ie: '9012345678', codOr: '002', codRec: '100048', diaVencimento: 9 } },
        });
    });

    it.each([
        ['UF que não existe', { ...PR, uf: 'XX' }, /não existe/],
        ['sem código da obrigação', { ...PR, codOr: '' }, /código da obrigação/],
        ['código fora da tabela', { ...PR, codOr: '123' }, /código da obrigação/],
        ['sem código de receita', { ...PR, codRec: ' ' }, /código de receita/],
        ['dia 0', { ...PR, diaVencimento: 0 }, /dia do vencimento/],
        ['dia 31 (não existe em todo mês)', { ...PR, diaVencimento: 31 }, /dia do vencimento/],
    ])('%s: recusa e diz', (_n, linha, erro) => {
        const v = validarCadastroStUf([linha]);
        expect(v.ok).toBe(false);
        expect(!v.ok && v.erros.join(' ')).toMatch(erro as RegExp);
    });

    it('a mesma UF duas vezes: recusa', () => {
        const v = validarCadastroStUf([PR, PR]);
        expect(!v.ok && v.erros.join(' ')).toMatch(/duas vezes/);
    });
});

describe('o vencimento é no mês SEGUINTE à competência', () => {
    it('09/2026, dia 9 → 09/10/2026 (o exemplo real)', () => {
        expect(vencimentoNoMesSeguinte('2026-09', 9)).toBe('09102026');
    });
    it('12/2026 vira o ano', () => {
        expect(vencimentoNoMesSeguinte('2026-12', 9)).toBe('09012027');
    });
    it('competência ilegível não vira data', () => {
        expect(vencimentoNoMesSeguinte('09/2026', 9)).toBe('');
    });
});

describe('cadastro × lançado na competência', () => {
    const cadastro = { ufs: { PR: { ie: '', codOr: '002', codRec: '100048', diaVencimento: 9 } } };

    it('o cadastro gera a obrigação da competência', () => {
        expect(obrigacoesStDoCadastro(cadastro, '2026-09')).toEqual({
            obrigacoes: { PR: { dtVcto: '09102026', codRec: '100048', codOr: '002', origem: 'cadastro' } },
            erros: [],
        });
    });

    it('o lançado na competência vence, UF a UF', () => {
        const doCad = obrigacoesStDoCadastro({ ufs: { ...cadastro.ufs, MG: { codOr: '002', codRec: '100048', diaVencimento: 9 } } }, '2026-09').obrigacoes;
        const m = mesclarObrigacoesSt({ PR: { dtVcto: '15102026', codRec: '100099' } }, doCad);
        expect(m.PR).toEqual({ dtVcto: '15102026', codRec: '100099' });
        expect(m.MG.origem).toBe('cadastro');
    });

    it('linha inválida no cadastro não vira guia, e é dita', () => {
        const r = obrigacoesStDoCadastro({ ufs: { PR: { codOr: '002', codRec: '', diaVencimento: 9 } } }, '2026-09');
        expect(r.obrigacoes).toEqual({});
        expect(r.erros.join(' ')).toMatch(/PR: informe o código de receita/);
    });
});

describe('o gerador real do bloco E', () => {
    it('PR 09/2026: E250 com COD_OR 002, 6.345,59, 09/10/2026, 100048, 092026', () => {
        const { obrigacoes } = obrigacoesStDoCadastro({ ufs: { PR: { codOr: '002', codRec: '100048', diaVencimento: 9 } } }, '2026-09');
        const r = montarLinhasStBlocoE({
            notas: [saidaPr(6345.59)], ufEmpresa: 'SP', ajustes: [],
            dtIni: '01092026', dtFin: '30092026', obrigacoesPorUf: obrigacoes,
        });
        const e250 = r.linhas.find((l: any) => l[0] === 'E250');
        expect(e250).toEqual(['E250', '002', '6345,59', '09102026', '100048', '', '', '', '', '092026']);
        expect(r.avisos.join(' ')).toMatch(/pelo cadastro de IE de substituto/);
    });

    it('sem cadastro e sem lançamento: não inventa o E250, e o aviso diz onde cadastrar', () => {
        const r = montarLinhasStBlocoE({
            notas: [saidaPr(100)], ufEmpresa: 'SP', ajustes: [],
            dtIni: '01092026', dtFin: '30092026', obrigacoesPorUf: {},
        });
        expect(r.linhas.find((l: any) => l[0] === 'E250')).toBeUndefined();
        expect(r.avisos.join(' ')).toMatch(/IE de substituto por UF/);
    });
});
