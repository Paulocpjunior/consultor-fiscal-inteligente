// ============================================================================
// 🚨 O PIS/COFINS DA INDÚSTRIA SAÍA SOBRE A BASE CHEIA — duas deduções
// faltando no MESMO campo, e as duas na direção mais cara.
//
// Paulo, 20/08 (PWR 1364 · 07/2026): *"Ele não deduziu o ICMS da base do
// PIS/COFINS e também não considerou o desconto no valor total da nota, só
// isso."* O M210 do arquivo declarava base 38.316,84 — a soma crua dos vProd
// das saídas.
//
// AS DUAS FONTES, e nenhuma é dedução minha:
//  · o EFD-Contribuições ACEITO da própria PWR (03/2026) traz
//    VL_BC_PIS 16.055,60 para um item de 19.580,00 com ICMS 3.524,40;
//  · a DANFE da NF 7 de 07/2026 traz V. TOTAL PRODUTOS 18.741,24,
//    DESCONTO 562,24 e V. TOTAL DA NOTA 18.179,00 — e a base do ICMS é
//    justamente 18.179,00.
// ============================================================================
// @ts-expect-error — módulo .js do backend (sem tipos)
import { receitaDoItem, baseDoItem, receitaEBaseDoDocumento, codigosReceitaM205 } from '../sefaz-backend/base-pis-cofins.js';
import { buildBlocoC_Contrib as buildBlocoC, buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';

/** O item real da NF 7 (PWR → TERCEIRA IGREJA BATISTA, 24/07/2026). */
const ITEM_NF7 = {
    nItem: 1, cProd: '3', xProd: 'TELHA SANDUICHE', cfop: '5101', uCom: 'MT', qCom: 187.6,
    vProd: 18741.24, vDesc: 562.24, vBC: 18179.00, aliqIcms: 18, vICMS: 3272.22, cst: '00',
    aliqPIS: 0.65, aliqCOFINS: 3, vPIS: 121.82, vCOFINS: 562.24,
};

describe('a régua: receita ≠ base, e as duas ≠ vProd', () => {
    it('receita é a mercadoria MENOS o desconto incondicional', () => {
        expect(receitaDoItem(ITEM_NF7)).toBeCloseTo(18179.00, 2);
    });

    it('base é a receita MENOS o ICMS destacado (Tema 69)', () => {
        expect(baseDoItem(ITEM_NF7)).toBeCloseTo(14906.78, 2);
    });

    it('o item do arquivo ACEITO de 03/2026 reproduz o VL_BC_PIS dele', () => {
        // |C170|...|19580|0|...|19580|18|3524,4|...|01|16055,6|0,65|...
        expect(baseDoItem({ vProd: 19580, vDesc: 0, vICMS: 3524.40 })).toBeCloseTo(16055.60, 2);
    });

    it('sem ICMS destacado não se inventa exclusão — a base é a receita', () => {
        expect(baseDoItem({ vProd: 1000, vDesc: 100 })).toBeCloseTo(900, 2);
    });

    it('base nunca fica negativa', () => {
        expect(baseDoItem({ vProd: 100, vICMS: 500 })).toBe(0);
    });

    it('documento SEM itens (NFS-e do portal) tem receita = base — serviço não destaca ICMS', () => {
        const r = receitaEBaseDoDocumento({}, 2500);
        expect(r).toEqual({ receita: 2500, base: 2500, icms: 0, temItens: false });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
const empresa = {
    _regime: 'lucro', cnpj: '31947349000169', razaoSocial: 'PWR INDUSTRIA METALURGICA LTDA',
    dadosFiscais: { uf: 'SP', codMunIBGE: '3507605' },
};
const dados = (notas: any[], warnings: string[] = []) => ({
    empresa, notas, warnings,
    competenciaInicio: '2026-07', competenciaFim: '2026-07',
    regimeApuracao: '2',   // CUMULATIVO — é o regime da PWR (0110 COD_INC_TRIB=2)
});
const NF7 = {
    id: 'nf7', chave: '35260731947349000169550010000000071369620739',
    tipo: 'NFe', tipoDoc: 'NFe', status: 'autorizado', direcao: 'saida',
    numero: '7', serie: '1', competencia: '2026-07',
    dataEmissao: '2026-07-24', dhEmi: '2026-07-24',
    destinatario: { cnpjCpf: '26767102000120', nome: 'TERCEIRA IGREJA BATISTA' },
    totais: { vNF: 18179.00, vProd: 18741.24, vDesc: 562.24, vBC: 18179.00, vICMS: 3272.22 },
    itens: [ITEM_NF7],
};
const campos = (linha: string) => linha.split('|');
const acha = (linhas: string[], reg: string) => linhas.filter((l) => l.startsWith(`|${reg}|`));
const brl = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

describe('🚨 C100 — o VL_DOC desconta (a DANFE diz 18.179,00)', () => {
    it('VL_DOC é o total da nota, não a soma dos vProd', () => {
        const c100 = acha(buildBlocoC(dados([NF7])), 'C100')[0];
        expect(brl(campos(c100)[12])).toBeCloseTo(18179.00, 2);
        expect(brl(campos(c100)[14])).toBeCloseTo(562.24, 2);   // VL_DESC
        expect(brl(campos(c100)[16])).toBeCloseTo(18741.24, 2); // VL_MERC (mercadoria cheia)
    });

    it('e o VL_PIS do C100 continua sendo o DESTACADO no documento', () => {
        // No aceito de 03/2026 o C100 traz 127,27 (0,65% de 19.580, a mercadoria
        // cheia) enquanto o C170 traz 104,36 (a base reduzida). São fatos
        // diferentes: um é o que o emitente escreveu, o outro é o que se apura.
        const c100 = acha(buildBlocoC(dados([NF7])), 'C100')[0];
        expect(brl(campos(c100)[26])).toBeCloseTo(121.82, 2);
    });
});

describe('🚨 C170 — a base do PIS/COFINS exclui o ICMS', () => {
    const c170 = () => campos(acha(buildBlocoC(dados([NF7])), 'C170')[0]);

    it('VL_BC_PIS = 14.906,78 (18.179,00 − 3.272,22), não 18.741,24', () => {
        expect(brl(c170()[26])).toBeCloseTo(14906.78, 2);
    });

    it('e o VL_PIS segue a BASE — o registro não pode se desmentir', () => {
        const f = c170();
        expect(brl(f[30])).toBeCloseTo(14906.78 * 0.0065, 2);
        expect(brl(f[30])).toBeCloseTo(brl(f[26]) * brl(f[27]) / 100, 2);
    });

    it('o mesmo vale para a COFINS', () => {
        const f = c170();
        expect(brl(f[32])).toBeCloseTo(14906.78, 2);
        expect(brl(f[36])).toBeCloseTo(brl(f[32]) * brl(f[33]) / 100, 2);
    });
});

describe('🚨 M210/M610 — receita bruta e base são campos DIFERENTES', () => {
    const linhas = () => buildBlocoM(dados([NF7]));

    it('VL_REC_BRT traz a receita e VL_BC_CONT traz a base — não o mesmo número', () => {
        const f = campos(acha(linhas(), 'M210')[0]);
        expect(brl(f[3])).toBeCloseTo(18179.00, 2);   // VL_REC_BRT
        expect(brl(f[4])).toBeCloseTo(14906.78, 2);   // VL_BC_CONT
        expect(brl(f[7])).toBeCloseTo(14906.78, 2);   // VL_BC_CONT_AJUS
        expect(brl(f[3])).not.toBeCloseTo(brl(f[4]), 2);
    });

    it('VL_CONT_APUR = base × alíquota, conferível dentro da própria linha', () => {
        const f = campos(acha(linhas(), 'M210')[0]);
        expect(brl(f[11])).toBeCloseTo(brl(f[7]) * brl(f[8]) / 100, 2);
    });

    it('e o M610 idem, com 3%', () => {
        const f = campos(acha(linhas(), 'M610')[0]);
        expect(brl(f[3])).toBeCloseTo(18179.00, 2);
        expect(brl(f[4])).toBeCloseTo(14906.78, 2);
        expect(brl(f[11])).toBeCloseTo(brl(f[7]) * brl(f[8]) / 100, 2);
    });

    it('a exclusão do ICMS vai DITA, com o número — valor que muda sozinho não se confere', () => {
        const w: string[] = [];
        buildBlocoM(dados([NF7], w));
        const aviso = w.find((x) => /Tema 69/.test(x));
        expect(aviso).toBeTruthy();
        expect(aviso).toMatch(/3272\.22|3\.272,22|3272,22/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// M205/M605 — Paulo: *"esse registro nós preenchemos manual, tem a
// possibilidade de já puxar preenchido?"*. Dá, com o código PROVADO.
// ═══════════════════════════════════════════════════════════════════════════
describe('M205/M605 — o detalhamento por código de receita sai preenchido', () => {
    it('cumulativo: NUM_CAMPO 12, PIS 810902 e COFINS 217201 (do arquivo aceito)', () => {
        const linhas = buildBlocoM(dados([NF7]));
        const m205 = campos(acha(linhas, 'M205')[0]);
        const m605 = campos(acha(linhas, 'M605')[0]);
        expect(m205[2]).toBe('12');
        expect(m205[3]).toBe('810902');
        expect(m605[2]).toBe('12');
        expect(m605[3]).toBe('217201');
    });

    it('o VL_DEBITO casa com o campo 12 do M200/M600 — é ele que o registro detalha', () => {
        const linhas = buildBlocoM(dados([NF7]));
        const m200 = campos(acha(linhas, 'M200')[0]);
        const m205 = campos(acha(linhas, 'M205')[0]);
        expect(brl(m205[4])).toBeCloseTo(brl(m200[12]), 2);
        const m600 = campos(acha(linhas, 'M600')[0]);
        const m605 = campos(acha(linhas, 'M605')[0]);
        expect(brl(m605[4])).toBeCloseTo(brl(m600[12]), 2);
    });

    it('e ele vem ANTES do M210 — o M205 é filho do M200', () => {
        const linhas = buildBlocoM(dados([NF7]));
        const iM200 = linhas.findIndex((l: string) => l.startsWith('|M200|'));
        const iM205 = linhas.findIndex((l: string) => l.startsWith('|M205|'));
        const iM210 = linhas.findIndex((l: string) => l.startsWith('|M210|'));
        expect(iM200).toBeLessThan(iM205);
        expect(iM205).toBeLessThan(iM210);
    });

    it('🚨 NÃO-CUMULATIVO NÃO SAI — o código não está provado, e a falta é DITA', () => {
        // Código de tabela oficial não se deduz: um COD_REC errado declara o
        // débito na receita errada da DCTF. Mesmo desenho do 0002 e do código 9
        // do ISS fixo.
        expect(codigosReceitaM205(true)).toBeNull();
        const w: string[] = [];
        const linhas = buildBlocoM({ ...dados([NF7], w), regimeApuracao: '1' });
        expect(acha(linhas, 'M205')).toHaveLength(0);
        expect(acha(linhas, 'M605')).toHaveLength(0);
        expect(w.some((x) => /M205\/M605/.test(x) && /não está provado/.test(x))).toBe(true);
    });
});
