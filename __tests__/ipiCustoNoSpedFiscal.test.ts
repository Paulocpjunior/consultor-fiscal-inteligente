/**
 * 🏭 IPI DE NÃO CONTRIBUINTE TAMBÉM SAI DO SPED (13/10, WALDESA 0005-02).
 *
 * Paulo: "o IPI, no livro de entrada ele saiu, mas no PVA ele continua" — o
 * Livro do CFI dava IPI 0,00 (#1407) e o livro que o PVA imprime do arquivo
 * mostrava Total IPI 3.606,03: o C100/C170/C190 copiavam o destaque do
 * fornecedor. Mesma classe do ICMS do Simples (ELS, 11/09).
 *
 * Fatos cobrados (na nota da WEG, NF 4484116): com "Contribuinte de IPI: Não"
 * o C100, os C170 e o C190 saem com IPI 0,00 e o VL_OPR do C190 NÃO muda
 * (o IPI é custo, continua no valor da operação); em branco, sai como sempre.
 */
// @ts-expect-error módulo .js puro sem tipos
import { buildBlocoC } from '../sefaz-backend/sped-fiscal-blocoC.js';

const campos = (l: string) => l.trim().split('|');
const num = (v: string) => Number(String(v).replace(',', '.'));

const WEG = () => ({
    tipo: 'NFe', modelo: '55', direcao: 'entrada', numero: '4484116', serie: '1', modFrete: '0', tpNF: '1', status: 'autorizado',
    chave: '42260814309992000148550010044841161545980670',
    dhEmi: '2026-08-31T15:23:00-03:00', dataEmissao: '2026-08-31', cnpjEmit: '14309992000148', cnpjDest: '05049535000502',
    emitente: { cnpj: '14309992000148', nome: 'WEG DRIVES', uf: 'SC' }, destinatario: { cnpj: '05049535000502' },
    totais: { vNF: 2859.93, vProd: 2100.36, vDesc: 0, vIPI: 136.52, vST: 623.05 },
    itens: [
        { nItem: 1, codigo: 'D1', descricao: 'MINIDISJUNTOR', cfop: '6403', cst: '10', ncm: '85362000', unidade: 'UN', quantidade: 4, vProd: 378.88, vBC: 378.88, vICMS: 15.16, vIPI: 24.63, vBCIPI: 378.88, aliqIPI: 6.5, vBCST: 708.6, vICMSST: 112.29 },
        { nItem: 2, codigo: 'D2', descricao: 'MINIDISJUNTOR', cfop: '6403', cst: '10', ncm: '85362000', unidade: 'UN', quantidade: 4, vProd: 360.68, vBC: 360.68, vICMS: 14.43, vIPI: 23.44, vBCIPI: 360.68, aliqIPI: 6.5, vBCST: 674.5, vICMSST: 106.89 },
        { nItem: 3, codigo: 'D3', descricao: 'MINIDISJUNTOR', cfop: '6403', cst: '10', ncm: '85362000', unidade: 'UN', quantidade: 240, vProd: 1360.8, vBC: 1360.8, vICMS: 54.43, vIPI: 88.45, vBCIPI: 1360.8, aliqIPI: 6.5, vBCST: 2545.09, vICMSST: 403.87 },
    ],
});

const gerar = (contribuinteIpi?: string) => buildBlocoC({
    empresa: { cnpj: '05049535000502', colecao: 'lucro_empresas', regimeTributario: 'Lucro Presumido', dadosFiscais: { uf: 'SP', contribuinteIpi } },
    competencia: '2026-09', notas: [WEG()], warnings: [],
}) as string[];

const reg = (linhas: string[], r: string) => linhas.filter((l) => l.startsWith(`|${r}|`)).map(campos);

describe('SPED Fiscal da WALDESA — NF 4484116 da WEG', () => {
    it('"Contribuinte de IPI: Não": C100, C170 e C190 com IPI 0,00', () => {
        const l = gerar('nao');
        expect(num(reg(l, 'C100')[0][25])).toBe(0);                 // C100 campo 25 VL_IPI
        for (const c of reg(l, 'C170')) {
            expect(num(c[24])).toBe(0);                              // C170 campo 24 VL_IPI
            expect(num(c[22])).toBe(0);                              // VL_BC_IPI
        }
        expect(reg(l, 'C190').map((c) => num(c[11]))).toEqual([0]); // C190 campo 11 VL_IPI
    });

    it('o VL_OPR do C190 não muda — o IPI é custo, continua no valor da operação', () => {
        const opr = (l: string[]) => reg(l, 'C190').reduce((t, c) => t + num(c[5]), 0);
        expect(opr(gerar('nao'))).toBeCloseTo(opr(gerar('')), 2);
        expect(opr(gerar('nao'))).toBeCloseTo(2859.93, 2);
    });

    it('cadastro em branco: o arquivo sai como sempre (IPI 136,52) — a fixture alcança o ramo', () => {
        const l = gerar('');
        expect(num(reg(l, 'C100')[0][25])).toBeCloseTo(136.52, 2);
        expect(num(reg(l, 'C190')[0][11])).toBeCloseTo(136.52, 2);
    });
});
