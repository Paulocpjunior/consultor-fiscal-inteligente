// ============================================================================
// 🚨 "A BASE BATEU, MAS O VALOR DA RECEITA TEM DE SER 18.355,90"
//
// Paulo, 17/09 (PWR 08/2026, com a base JÁ conferida contra a Memória):
// *"Base do PIS/COFINS bateu, mas o valor da Receita ele disse que não mudou e
// tem que ser 18.355,90, que é o valor das Vendas; foi o mesmo caso do mês que
// fizemos"*.
//
// ═══ OS DOIS NÚMEROS ESTÃO CERTOS, E MEDEM COISAS DIFERENTES ════════════════
//
// · `VL_REC_BRT` do M210 = Σ dos `VL_ITEM` dos C170 — **mercadoria BRUTA**.
//   Guia Prático 1.35, M210 campo 03, "Validação": *"o valor do campo será
//   igual à soma dos seguintes campos: … VL_ITEM dos registros C170 …
//   [IND_OPER do C100 = 1]"*; e C170 campo 07: *"somente o valor das
//   mercadorias (equivalente à quantidade vezes preço unitário)"*, com a
//   validação *"a soma de valores dos registros C170 deve ser igual ao valor
//   informado no campo VL_MERC do registro C100"*.
//
// · A **Memória de Apuração** parte do valor CONTÁBIL da nota (`vNF` =
//   mercadoria − desconto + frete) — a receita do IRPJ/CSLL presumido.
//
// A diferença é sempre `frete − desconto`. Na PWR 08/2026: 750,00 − 169,41 =
// 580,59, e 17.775,31 + 580,59 = 18.355,90.
//
// 🚨 **NÃO DÁ PARA "CONSERTAR" A RECEITA MEXENDO NO C170** — somar o frete ou
// abater o desconto no `VL_ITEM` quebra a validação contra o `VL_MERC`, que é
// exatamente o que custou cinco dias em 25/08. E o PVA REGERA o bloco M a
// partir dos documentos (Manual do Lucro Presumido, PVA 2.04), então escrever
// outro número no M210 é escrever num campo que ele sobrescreve.
//
// O que esta rodada entrega é a CONCILIAÇÃO na geração: o aviso diz os dois
// números, a diferença e as parcelas, para ninguém precisar perguntar de novo.
//
// ⚠️ CNPJs FICTÍCIOS — dado de cliente não entra no repositório. A ARITMÉTICA é
// a real, que é o que o caso prova.
// ============================================================================
import { buildBlocoC_Contrib, buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';

const CNPJ = '11222333000181';

const dados = (notas: any[], over: any = {}) => ({
    empresa: {
        _regime: 'lucro', cnpj: CNPJ, razaoSocial: 'EMPRESA TESTE LTDA',
        dadosFiscais: { uf: 'SP', codMunIBGE: '3550308' },
    },
    notas,
    warnings: [] as string[],
    competenciaInicio: '2026-08', competenciaFim: '2026-08',
    regimeApuracao: '2',
    ...over,
});

/**
 * A aritmética REAL da PWR 08/2026, num documento só:
 *   mercadoria 17.775,31 · desconto 169,41 · frete 750,00 · ICMS 3.169,07
 *   ⇒ VL_REC_BRT 17.775,31 · base 15.186,83 · contábil 18.355,90
 */
const NOTA = {
    id: 'n1', chave: '35260811222333000181550010000000011234567890',
    tipo: 'NFe', tipoDoc: 'NFe', status: 'autorizado', direcao: 'saida',
    numero: '16', serie: '1', competencia: '2026-08',
    dataEmissao: '2026-08-27', dhEmi: '2026-08-27',
    destinatario: { cnpjCpf: '44555666000177', nome: 'CLIENTE TESTE LTDA' },
    totais: { vNF: 18355.90, vProd: 17775.31, vDesc: 169.41, vFrete: 750, vICMS: 3169.07 },
    itens: [{
        nItem: 1, cProd: '9', xProd: 'TELHA', cfop: '5101', uCom: 'MT', qCom: 100,
        vProd: 17775.31, vDesc: 169.41, vBC: 17605.90, aliqIcms: 18, vICMS: 3169.07,
        cst: '00', aliqPIS: 0.65, aliqCOFINS: 3,
    }],
};

const campos = (linha: string) => linha.split('|');
const acha = (linhas: string[], reg: string) => linhas.filter((l) => l.startsWith(`|${reg}|`));
const brl = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 IND_ESCRI do C010 — o campo NÃO é o regime', () => {
    // Guia 1.35, C010 campo 03: *"1 – Apuração com base nos registros de
    // CONSOLIDAÇÃO das operações por NF-e (C180 e C190) …; 2 – Apuração com
    // base no registro INDIVIDUALIZADO de NF-e (C100 e C170)"*.
    //
    // 🚨 O gerador decidia por `regimeApuracao === '1' ? '1' : '2'`, então
    // empresa do NÃO-CUMULATIVO declarava apuração consolidada enquanto emitia
    // C100/C170. A validação do M210 campo 03 (e a do campo 04) só recolhe os
    // C170 *"cujo COD_MOD seja diferente de 55 ou quando COD_MOD seja igual a
    // 55 e o IND_ESCRI do registro C010 seja igual a 2"* — ou seja, toda NF-e
    // sairia da receita E da base, e o PVA iria buscar C181/C491, que este
    // gerador nunca emite. Receita e base ZERADAS, num arquivo que o PVA
    // ACEITA porque regera o bloco M.
    const indEscri = (regime: string) => {
        const c010 = acha(buildBlocoC_Contrib(dados([NOTA], { regimeApuracao: regime })), 'C010')[0];
        return campos(c010)[3];
    };

    it('sai 2 (individualizado) no CUMULATIVO — o valor dos arquivos ACEITOS', () => {
        expect(indEscri('2')).toBe('2');
    });

    it('e sai 2 também no NÃO-CUMULATIVO — quem decide é o que o gerador EMITE', () => {
        expect(indEscri('1')).toBe('2');
    });

    it('o gerador não emite C180/C190, então não há caminho consolidado a declarar', () => {
        const linhas = buildBlocoC_Contrib(dados([NOTA], { regimeApuracao: '1' }));
        expect(acha(linhas, 'C180')).toHaveLength(0);
        expect(acha(linhas, 'C190')).toHaveLength(0);
        expect(acha(linhas, 'C170').length).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 a receita do M210 é a Σ dos VL_ITEM — e o VL_ITEM fecha com o VL_MERC', () => {
    const linhasC = () => buildBlocoC_Contrib(dados([NOTA]));

    it('VL_ITEM é BRUTO: nem o frete entra, nem o desconto sai', () => {
        const c170 = campos(acha(linhasC(), 'C170')[0]);
        expect(brl(c170[7])).toBeCloseTo(17775.31, 2);   // VL_ITEM
        expect(brl(c170[8])).toBeCloseTo(169.41, 2);     // VL_DESC — campo próprio
    });

    it('Σ VL_ITEM = VL_MERC do C100 — a validação que trava o campo 07', () => {
        const ls = linhasC();
        const merc = brl(campos(acha(ls, 'C100')[0])[16]);
        const soma = acha(ls, 'C170').reduce((s, l) => s + brl(campos(l)[7]), 0);
        expect(soma).toBeCloseTo(merc, 2);
        expect(merc).toBeCloseTo(17775.31, 2);
    });

    it('a BASE do C170 leva o frete e tira o desconto e o ICMS', () => {
        const c170 = campos(acha(linhasC(), 'C170')[0]);
        // 17.775,31 − 169,41 + 750,00 − 3.169,07
        expect(brl(c170[26])).toBeCloseTo(15186.83, 2);  // VL_BC_PIS
        expect(brl(c170[32])).toBeCloseTo(15186.83, 2);  // VL_BC_COFINS
    });

    it('e o M210 leva os dois lado a lado: receita 17.775,31 × base 15.186,83', () => {
        const m210 = campos(acha(buildBlocoM(dados([NOTA])), 'M210')[0]);
        expect(brl(m210[3])).toBeCloseTo(17775.31, 2);   // VL_REC_BRT
        expect(brl(m210[4])).toBeCloseTo(15186.83, 2);   // VL_BC_CONT
        expect(brl(m210[11])).toBeCloseTo(98.71, 2);     // VL_CONT_APUR — PIS
    });

    it('a COFINS fecha em 455,60, que é o número da Memória', () => {
        const m610 = campos(acha(buildBlocoM(dados([NOTA])), 'M610')[0]);
        expect(brl(m610[11])).toBeCloseTo(455.60, 2);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 a geração CONCILIA a receita do arquivo com a da Memória', () => {
    const avisos = (notas: any[]): string[] => {
        const d = dados(notas);
        buildBlocoM(d);
        return d.warnings as string[];
    };
    const conciliacao = (notas: any[]) =>
        avisos(notas).find((w: string) => w.includes('Memória de Apuração: o arquivo declara'));

    it('diz os DOIS números e a diferença, sem chamar nenhum deles de errado', () => {
        const w = conciliacao([NOTA]) || '';
        expect(w).toContain('17775.31');
        expect(w).toContain('18355.90');
        expect(w).toContain('580.59');
        expect(w).toMatch(/os DOIS estão certos/i);
    });

    it('nomeia as parcelas que explicam a diferença', () => {
        const w = conciliacao([NOTA]) || '';
        expect(w).toContain('− desconto 169.41');
        expect(w).toContain('+ frete 750.00');
    });

    it('manda conferir a BASE, que é o que a guia paga', () => {
        const w = conciliacao([NOTA]) || '';
        expect(w).toContain('15186.83');
        expect(w).toMatch(/confira a base, não a receita/i);
    });

    // ⚠️ Alarme sobre arquivo correto é o jeito conhecido de a equipe parar de
    // ler os avisos que importam. Sem frete e sem desconto os dois números são
    // o MESMO, e não há o que conciliar.
    it('NASCE MUDO quando não há frete nem desconto', () => {
        const limpa = {
            ...NOTA,
            totais: { vNF: 17775.31, vProd: 17775.31, vICMS: 3169.07 },
            itens: [{ ...NOTA.itens[0], vDesc: 0 }],
        };
        expect(conciliacao([limpa])).toBeUndefined();
    });

    it('nasce só com DESCONTO (o caso de 07/2026, sem frete)', () => {
        const semFrete = { ...NOTA, totais: { ...NOTA.totais, vFrete: 0 } };
        const w = conciliacao([semFrete]) || '';
        expect(w).toContain('− desconto 169.41');
        expect(w).not.toContain('+ frete');
    });
});
