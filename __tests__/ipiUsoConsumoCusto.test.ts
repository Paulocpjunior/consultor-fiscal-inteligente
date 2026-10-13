/**
 * 🏭 IPI DE COMPRA PARA USO E CONSUMO É CUSTO — mesmo para CONTRIBUINTE do IPI
 * (13/10, Paulo, FASTWELD 0001-34: NF 86620 da ACOS ESPECIAIS IGUATEMI,
 * lançada em 1556, IPI 6,86 na coluna IPI do Livro como crédito).
 *
 * O crédito do IPI é do insumo (RIPI art. 226, I). Quem diz o destino é o
 * CFOP DE LANÇAMENTO do item. Fatos cobrados: as famílias de uso/consumo
 * (x556, x557, x407) são custo e as de insumo/revenda não; o Livro tira o IPI
 * do item de consumo da coluna creditada e diz como custo; nota MISTA credita
 * só o insumo; o SPED (C190) e o crédito do E520 seguem a MESMA régua; a
 * saída não é tocada; o VL_CONT do E510 continua com o IPI (é custo).
 */
import { ipiCustoPeloDestino } from '../sefaz-backend/credito-icms-entrada.js';
import { alocarTributacaoIcms, ctxAlocacaoDoDoc } from '../services/iobSageExportService';
// @ts-expect-error módulo .js puro sem tipos
import { buildBlocoC } from '../sefaz-backend/sped-fiscal-blocoC.js';
// @ts-expect-error módulo .js puro sem tipos
import { notasComIpiDoArquivo, somarImpostoPorDirecao } from '../sefaz-backend/sped-fiscal-blocoE.js';

const campos = (l: string) => l.trim().split('|');
const num = (v: string) => Number(String(v).replace(',', '.'));

/** NF 86620 (consumo, 5556 → 1556) + um item de insumo (5101 → 1101) para a nota mista. */
const nota = (mista = false): any => ({
    tipo: 'NFe', modelo: '55', direcao: 'entrada', numero: '86620', serie: '1', modFrete: '0', tpNF: '1', status: 'autorizado',
    chave: '35260947198460000130550010000866201418668666',
    dhEmi: '2026-09-09T06:58:00-03:00', dataEmissao: '2026-09-09', cnpjEmit: '47198460000130', cnpjDest: '02942184000134',
    emitente: { cnpj: '47198460000130', nome: 'ACOS ESPECIAIS IGUATEMI', uf: 'SP' }, destinatario: { cnpj: '02942184000134' },
    totais: { vNF: mista ? 1325.06 : 218.06, vProd: mista ? 1211.2 : 211.2, vIPI: mista ? 76.86 : 6.86 },
    itens: [
        { nItem: 1, codigo: 'C1', descricao: 'ACO PARA MANUTENCAO', cfop: '5556', cst: '00', cstIpi: '50', ncm: '72', unidade: 'KG', quantidade: 1, vProd: 211.2, vBC: 0, vICMS: 0, vIPI: 6.86, vBCIPI: 211.2, aliqIPI: 3.25 },
        ...(mista ? [{ nItem: 2, codigo: 'M1', descricao: 'BARRA DE ACO', cfop: '5101', cst: '00', cstIpi: '50', ncm: '72', unidade: 'KG', quantidade: 1, vProd: 1000, vBC: 1000, vICMS: 180, vIPI: 70, vBCIPI: 1000, aliqIPI: 7 }] : []),
    ],
});
const CONTRIBUINTE = { regimeTributario: 'LUCRO_REAL', contribuinteIpi: 'sim', naturezaAtividade: 'industria' };
const livro = (d: any) => alocarTributacaoIcms(d.itens, d.totais.vNF, ctxAlocacaoDoDoc(d, CONTRIBUINTE as any));
const dados = { empresa: { cnpj: '02942184000134', colecao: 'lucro_empresas', regimeTributario: 'Lucro Real', dadosFiscais: { uf: 'SP', contribuinteIpi: 'sim', naturezaAtividade: 'industria' } } };

describe('a régua do destino', () => {
    it.each(['1556', '2556', '1557', '1407', '2407'])('%s (uso/consumo): IPI é custo', (c) => {
        const r = ipiCustoPeloDestino(c);
        expect(r.custo).toBe(true);
        expect(r.baseLegal).toMatch(/RIPI.*226/);
    });
    it.each(['1101', '2101', '1102', '1401', '1551', '5556', ''])('%s: não é custo pelo destino', (c) => {
        expect(ipiCustoPeloDestino(c).custo).toBe(false);
    });
});

describe('o Livro da FASTWELD (contribuinte do IPI)', () => {
    it('NF 86620 (1556): coluna IPI 0,00 e 6,86 como custo, contábil fechando', () => {
        const a = livro(nota());
        expect(a.ipi).toBe(0);
        expect(a.ipiCusto).toBeCloseTo(6.86, 2);
        expect(a.base + a.isentos + a.outras).toBeCloseTo(218.06, 2);
    });
    it('nota mista: o insumo (1101) credita, o consumo (1556) é custo', () => {
        const a = livro(nota(true));
        expect(a.ipi).toBeCloseTo(70, 2);
        expect(a.ipiCusto).toBeCloseTo(6.86, 2);
    });
});

describe('o SPED da FASTWELD', () => {
    it('C190: o grupo 1556 sai com VL_IPI 0,00; o do insumo (1101) mantém', () => {
        const l: string[] = buildBlocoC({ ...dados, competencia: '2026-09', notas: [nota(true)], warnings: [] });
        const c190 = l.filter((x) => x.startsWith('|C190|')).map(campos);
        // C190: [1]REG [2]CST [3]CFOP … [11]VL_IPI
        const porCfop = Object.fromEntries(c190.map((c) => [c[3], num(c[11])]));
        expect(porCfop['1556']).toBe(0);
        expect(porCfop['1101']).toBeCloseTo(70, 2);
        const c100 = campos(l.find((x) => x.startsWith('|C100|')) as string);
        expect(num(c100[25])).toBeCloseTo(70, 2);
    });
    it('o crédito do E520 é o do arquivo (70,00), não o do documento (76,86)', () => {
        const notas = notasComIpiDoArquivo([nota(true)], dados);
        expect(somarImpostoPorDirecao(notas, 'entrada', 'vIPI', 'vIPI')).toBeCloseTo(70, 2);
        expect(somarImpostoPorDirecao([nota(true)], 'entrada', 'vIPI', 'vIPI')).toBeCloseTo(76.86, 2);
        // O IPI do documento fica guardado — é ele que o VL_CONT do E510 soma.
        expect(notas[0].itens[0]._vIPIDocumento).toBe(6.86);
    });
    it('a saída não é tocada', () => {
        const saida = { ...nota(), direcao: 'saida' };
        expect(notasComIpiDoArquivo([saida], dados)[0]).toBe(saida);
    });
});
