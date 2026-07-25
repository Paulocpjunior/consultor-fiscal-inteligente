/**
 * Mesclagem de empresas duplicadas (25/07) — regras que NÃO podem flutuar:
 *   - vencedor NUNCA é sobrescrito (conflito = mantém vencedor + reporta);
 *   - só entra do perdedor o que falta no vencedor;
 *   - CNPJs diferentes NUNCA mesclam;
 *   - cadastro: só preenche campo vazio do vencedor.
 */
// @ts-expect-error — modulo .js puro
import { mesclarDadosEmpresas } from '../sefaz-backend/empresa-merge.js';

const CNPJ = '52218990000132';

describe('mesclarDadosEmpresas — Lucro (fichaFinanceira)', () => {
    it('copia só as fichas de meses que o vencedor não tem, em ordem', () => {
        const vencedor = { cnpj: CNPJ, fichaFinanceira: [{ mesReferencia: '2026-05', receita: 100 }, { mesReferencia: '2026-07', receita: 300 }] };
        const perdedor = { cnpj: CNPJ, fichaFinanceira: [{ mesReferencia: '2026-04', receita: 50 }, { mesReferencia: '2026-05', receita: 999 }, { mesReferencia: '2026-06', receita: 200 }] };
        const r = mesclarDadosEmpresas('lucro', vencedor, perdedor);
        expect(r.ok).toBe(true);
        expect(r.resumo.fichasCopiadas).toBe(2); // 2026-04 e 2026-06
        expect(r.patch.fichaFinanceira.map((f: any) => f.mesReferencia)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07']);
        // 2026-05 do vencedor PRESERVADA (100, não 999) + conflito reportado.
        expect(r.patch.fichaFinanceira.find((f: any) => f.mesReferencia === '2026-05').receita).toBe(100);
        expect(r.conflitos.join(' ')).toMatch(/2026-05/);
    });

    it('sem fichas novas → patch sem fichaFinanceira (não regrava à toa)', () => {
        const vencedor = { cnpj: CNPJ, fichaFinanceira: [{ mesReferencia: '2026-06', receita: 1 }] };
        const perdedor = { cnpj: CNPJ, fichaFinanceira: [{ mesReferencia: '2026-06', receita: 2 }] };
        const r = mesclarDadosEmpresas('lucro', vencedor, perdedor);
        expect(r.ok).toBe(true);
        expect(r.patch.fichaFinanceira).toBeUndefined();
        expect(r.conflitos.length).toBe(1);
    });
});

describe('mesclarDadosEmpresas — Simples (mapas mensais + histórico)', () => {
    it('caso YUKUKO: meses faltantes entram; mês divergente mantém o da vencedora', () => {
        const vencedora = {
            cnpj: CNPJ,
            faturamentoManual: { '2026-05': 1000, '2026-06': 2000 },
            historicoCalculos: [{ id: 'a', das_mensal: 10 }],
        };
        const perdedora = {
            cnpj: CNPJ,
            faturamentoManual: { '2026-04': 500, '2026-06': 9999 },
            folhaMensal: { '2026-06': 300 },
            historicoCalculos: [{ id: 'a', das_mensal: 99 }, { id: 'b', das_mensal: 20 }],
        };
        const r = mesclarDadosEmpresas('simples', vencedora, perdedora);
        expect(r.ok).toBe(true);
        expect(r.resumo.mesesFaturamentoCopiados).toBe(1);       // 2026-04
        expect(r.patch.faturamentoManual['2026-04']).toBe(500);
        expect(r.patch.faturamentoManual['2026-06']).toBe(2000); // vencedora preservada
        expect(r.conflitos.join(' ')).toMatch(/2026-06/);
        expect(r.resumo.mesesFolhaCopiados).toBe(1);
        expect(r.resumo.calculosCopiados).toBe(1);               // só o 'b'
        expect(r.patch.historicoCalculos.map((h: any) => h.id)).toEqual(['a', 'b']);
    });
});

describe('mesclarDadosEmpresas — travas de segurança', () => {
    it('CNPJs diferentes NUNCA mesclam', () => {
        const r = mesclarDadosEmpresas('lucro', { cnpj: CNPJ }, { cnpj: '05049535000170' });
        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/MESMO CNPJ/);
    });

    it('cadastro já mesclado/excluído não entra de novo', () => {
        const r1 = mesclarDadosEmpresas('lucro', { cnpj: CNPJ }, { cnpj: CNPJ, _merged_into: 'x' });
        const r2 = mesclarDadosEmpresas('lucro', { cnpj: CNPJ, _deleted: true }, { cnpj: CNPJ });
        expect(r1.ok).toBe(false);
        expect(r2.ok).toBe(false);
    });

    it('dadosFiscais: preenche só campo VAZIO do vencedor', () => {
        const vencedor = { cnpj: CNPJ, dadosFiscais: { uf: 'SP', email: '' } };
        const perdedor = { cnpj: CNPJ, dadosFiscais: { uf: 'RJ', email: 'x@y.z', codMunIBGE: '3525904' } };
        const r = mesclarDadosEmpresas('lucro', vencedor, perdedor);
        expect(r.ok).toBe(true);
        expect(r.patch.dadosFiscais.uf).toBe('SP');              // nunca troca
        expect(r.patch.dadosFiscais.email).toBe('x@y.z');        // vazio → preenche
        expect(r.patch.dadosFiscais.codMunIBGE).toBe('3525904'); // ausente → preenche
        expect(r.resumo.camposCadastroPreenchidos).toBe(2);
    });
});
