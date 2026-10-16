/**
 * 🧷 OPERAÇÕES COM SUBSTITUIÇÃO TRIBUTÁRIA (16/10, modelo do e-Fiscal da KROYA).
 *
 * Paulo mandou o "NF SAÍDAS — OPERAÇÕES COM SUBSTITUIÇÃO TRIBUTÁRIA" de 09/2026
 * (interestaduais, por UF): NF 15595 para MG, CFOP 6401, contábil 1.111,69, BC
 * 813,00 a 4%, ICMS 32,52, BC ST 1.487,75, ICMS-ST 235,28. Fixture = a NF 15595
 * REAL do CSV dele (11 itens 6101 sem ST e 2 itens 6401 com ST).
 *
 * Fatos cobrados: só o CFOP com ST/FCP-ST vira linha; os valores batem com o
 * e-Fiscal; o contábil é o do Resumo por CFOP; o FCP-ST sai na sua coluna; e
 * interna × interestadual separa pela UF da empresa.
 */
import { operacoesComSt } from '../services/relatoriosAgregacoes';

const item = (n: number, cfop: string, vProd: number, vICMS: number, vIPI: number, vBCST = 0, vICMSST = 0, vFCPST = 0) => ({
    nItem: String(n), cProd: `P${n}`, xProd: `PRODUTO ${n}`, ncm: '24039900', cfop, uCom: 'UN', qCom: 1, vUnCom: vProd,
    vProd, vBC: vProd, aliqIcms: 4, vICMS, vIPI, vBCST, vICMSST, vFCPST, vPIS: 0, vCOFINS: 0, cst: vICMSST ? '10' : '00', orig: '1',
});
const nf15595: any = {
    id: 'kroya-15595', tipo: 'NFe', modelo: '55', numero: '0000015595', serie: '0', direcao: 'saida', tpNF: '1', status: 'autorizado',
    chave: '35260901961491000108550000000155951000000000', dataEmissao: '2026-09-02',
    cnpjEmit: '01961491000108', empresaCnpj: '01961491000108',
    cnpjDest: '55327759000175', xNomeDest: 'IMPERIO COMERCIO DE TABACOS LTDA', ufDest: 'MG',
    totais: { vNF: 3427.54 },
    itens: [
        item(1, '6101', 207.5, 8.3, 20.23), item(2, '6101', 197.5, 7.9, 19.26), item(3, '6101', 498, 19.92, 48.56),
        item(4, '6101', 107, 4.28, 10.43), item(5, '6101', 171, 6.84, 8.89), item(6, '6101', 267, 10.68, 13.88),
        item(7, '6101', 156, 6.24, 8.11), item(8, '6101', 122.4, 4.9, 6.36), item(9, '6101', 141.6, 5.66, 7.36),
        item(10, '6101', 205.2, 8.21, 10.67), item(11, '6101', 81, 3.24, 7.9),
        item(12, '6401', 660, 26.4, 51.48, 1207.78, 191), item(13, '6401', 153, 6.12, 11.93, 279.97, 44.28),
    ],
};
const ctx: any = { naturezaAtividade: 'comercio', parametrosCfop: [], regimeTributario: 'LUCRO_PRESUMIDO', contribuinteIpi: 'sim' };

it('NF 15595 → MG, 6401: os valores do e-Fiscal', () => {
    const r = operacoesComSt([nf15595], ctx, { direcao: 'saida', ambito: 'interestadual', ufEmpresa: 'SP' });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
        numero: '0000015595', uf: 'MG', cfop: '6401', contabil: 1111.69,
        baseIcms: 813, aliqIcms: 4, icms: 32.52, baseSt: 1487.75, icmsSt: 235.28, fcpSt: 0,
    });
});

it('interna × interestadual pela UF da empresa', () => {
    expect(operacoesComSt([nf15595], ctx, { direcao: 'saida', ambito: 'interna', ufEmpresa: 'SP' })).toEqual([]);
    expect(operacoesComSt([nf15595], ctx, { direcao: 'saida', ambito: 'interna', ufEmpresa: 'MG' })).toHaveLength(1);
});

it('o FCP-ST de outro estado sai na coluna dele, mesmo sem ICMS-ST', () => {
    const soFcp = { ...nf15595, itens: [item(1, '6403', 100, 4, 0, 150, 0, 3)] , totais: { vNF: 103 } };
    const r = operacoesComSt([soFcp], ctx, { direcao: 'saida', ambito: 'todas', ufEmpresa: 'SP' });
    expect(r[0]).toMatchObject({ cfop: '6403', icmsSt: 0, fcpSt: 3, contabil: 103 });
});
