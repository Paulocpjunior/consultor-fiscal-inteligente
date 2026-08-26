// ============================================================================
// 🚨 A NFC-e NÃO LEVA C170 NO EFD-CONTRIBUIÇÕES
//
// Paulo, 24/08: *"1385 - HYPE CAFE - EFD CONTRIBUIÇÕES, deu esses erros de
// estrutura, são os NFC-E"*.
//
// O Relatório de Erros de Importação do PVA traz **572 erros**, que são 286
// C170 com DUAS mensagens cada:
//
//   "O registro não deve ser informado para o modelo de documento do
//    'Registro Pai'."
//   "O registro não deve ser informado para esse perfil e/ou tipo de operação.
//    Consulte o guia prático da EFD-Contribuições e verifique a
//    obrigatoriedade dos registros na Seção 4 - Obrigatoriedade dos Registros."
//
// O arquivo tem 182 C100 — **179 modelo 65 e 3 modelo 55** — e 291 C170. Os
// 286 recusados são exatamente os filhos das NFC-e; os 5 das notas 55 passaram.
//
// ⚠️ E ISSO NÃO TIRA UM CENTAVO DA APURAÇÃO: os 179 C100 de NFC-e somam
// VL_DOC 19.722,70, que é exatamente o `VL_REC_BRT` do M210 do mesmo arquivo.
// A receita é declarada no C100 e no bloco M, nunca no C170.
// ============================================================================
import {
    ehNfce, levaC170NoContribuicoes, COD_MOD_NFCE,
} from '../sefaz-backend/sped-selecao-documentos.js';
import {
    conferirC170DeNfce, conferirCadastrosOrfaosContrib, avisosDaPrevalidacaoContrib,
// @ts-ignore — módulo JS do backend, sem tipos
} from '../sefaz-backend/sped-contrib-campos.js';
// @ts-ignore
import { buildBlocoC_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';

const semQuebra = (l: string) => String(l).replace(/\r?\n$/, '');

/** Linhas REAIS do arquivo que o PVA recusou (HYPE CAFE 66641236000115 · 07/2026). */
const C100_NFCE = '|C100|1|0|10882812000161|65|00|005|1|35260766641236000115650050000000019836680099'
    + '|06072026|06072026|279,60|0|0,00||279,60|9|0,00|0,00|0,00|279,60|11,20|0,00|0,00|0,00|1,80|8,40|||';
const C170_DA_NFCE = '|C170|1|10|Bufe Avulso|1,00000|UN|69,90|0,00|0|090|5101||69,90|4,00|2,80|0,00|0,00'
    + '|0,00|0|||0,00|0,00|0,00|01|67,10|0,6500|||0,44|01|67,10|3,0000|||2,01||';
const C100_NFE = '|C100|0|1|37626446000136|55|00|002|1572866|35260737626446000136550020015728661082963404'
    + '|29072026|29072026|95,00|0|0,00||95,00|9|0,00|0,00|0,00|95,00|17,10|0,00|0,00|0,00|1,29|5,92|||';
const C170_DA_NFE = '|C170|1|UD-10-640|Frasco pote de Vidro 640ml com tampa|1,00000|KIT|95,00|0,00|0|000'
    + '|1102||95,00|18,00|17,10|0,00|0,00|0,00|0|||0,00|0,00|0,00|70|0,00|0,0000|||0,00|70|0,00|0,0000|||0,00||';

describe('🚨 o dono responde quem leva C170', () => {
    it('a NFC-e é reconhecida pela CHAVE, não pelo campo cru', () => {
        // O importer principal não grava `modelo`; o modelo mora nas posições
        // 21-22 da chave. Ler o campo cru foi o que tirou 100 das 131 notas da
        // PS VIDROS do arquivo (19/08).
        const soChave = { chave: '35260766641236000115650050000000019836680099' };
        expect(ehNfce(soChave)).toBe(true);
        expect(levaC170NoContribuicoes(soChave)).toBe(false);
        expect(COD_MOD_NFCE).toBe('65');
    });

    it('a NF-e modelo 55 continua levando C170 — a Exceção 2 do ICMS/IPI não vale aqui', () => {
        const nfe = { chave: '35260737626446000136550020015728661082963404' };
        expect(ehNfce(nfe)).toBe(false);
        expect(levaC170NoContribuicoes(nfe)).toBe(true);
    });
});

describe('🚨 o gerador para de pendurar C170 em cupom', () => {
    const nota = (chave: string, cod: string) => ({
        chave, direcao: 'saida', status: 'autorizado',
        numero: '1', serie: '5', dhEmi: '2026-07-06T12:00:00-03:00',
        cnpjEmit: '66641236000115', xNomeEmit: 'HYPE CAFE',
        cnpjDest: '10882812000161', xNomeDest: 'CLIENTE',
        totais: { vNF: 279.6 },
        itens: [{
            nItem: 1, cProd: cod, xProd: 'Bufe Avulso', qCom: 1, uCom: 'UN',
            vProd: 69.9, cfop: '5101', NCM: '21069090',
        }],
    });
    const dados = (notas: unknown[]) => ({
        empresa: { cnpj: '66641236000115', nome: 'HYPE CAFE', uf: 'SP' },
        competencia: '2026-07', competenciaFim: '2026-07',
        regimeApuracao: '2', notas, warnings: [] as string[],
    });

    it('C100 da NFC-e SAI, C170 dela NÃO', () => {
        const l = buildBlocoC_Contrib(dados([
            nota('35260766641236000115650050000000019836680099', '10'),
        ])).map(semQuebra);
        expect(l.filter((x: string) => x.startsWith('|C100|'))).toHaveLength(1);
        expect(l.filter((x: string) => x.startsWith('|C170|'))).toHaveLength(0);
    });

    it('e a nota 55 do MESMO arquivo continua com o dela', () => {
        const l = buildBlocoC_Contrib(dados([
            nota('35260766641236000115650050000000019836680099', '10'),
            nota('35260737626446000136550020015728661082963404', 'UD-10-640'),
        ])).map(semQuebra);
        expect(l.filter((x: string) => x.startsWith('|C100|'))).toHaveLength(2);
        const c170 = l.filter((x: string) => x.startsWith('|C170|'));
        expect(c170).toHaveLength(1);
        expect(c170[0]).toContain('|UD-10-640|');
    });
});

describe('🚨 a recusa virou regra da prevalidação — no MESMO PR', () => {
    it('acusa o C170 da NFC-e com a recusa LITERAL do PVA', () => {
        const r = conferirC170DeNfce([C100_NFCE, C170_DA_NFCE]);
        expect(r.erros).toHaveLength(1);
        expect(r.erros[0].registro).toBe('C170');
        expect(r.erros[0].fonte).toContain('Registro Pai');
        expect(r.erros[0].fonte).toContain('HYPE CAFE');
        expect(r.erros[0].mensagem).toContain('NFC-e');
    });

    // ⚠️ Quem decide é o PAI. Um C170 sozinho não tem como ser julgado, e
    // acusá-lo por conta própria produziria alarme em arquivo certo — que é o
    // jeito conhecido de ensinar a equipe a desligar a prevalidação.
    it('fica MUDA no C170 de nota 55', () => {
        expect(conferirC170DeNfce([C100_NFE, C170_DA_NFE]).erros).toHaveLength(0);
    });

    it('julga cada C100 pelo modelo DELE, no arquivo misturado', () => {
        const r = conferirC170DeNfce([C100_NFE, C170_DA_NFE, C100_NFCE, C170_DA_NFCE, C170_DA_NFCE]);
        expect(r.erros).toHaveLength(2);
        expect(r.erros.every((e: any) => e.registro === 'C170')).toBe(true);
    });

    it('registro de outro bloco fecha o pai — C170 órfão não herda o modelo', () => {
        expect(conferirC170DeNfce([C100_NFCE, '|C990|3|', C170_DA_NFCE]).erros).toHaveLength(0);
    });

    it('e ela entrou no agregador que a rota chama', () => {
        const avisos = avisosDaPrevalidacaoContrib([C100_NFCE, C170_DA_NFCE]);
        expect(avisos.join(' ')).toContain('Registro Pai');
    });
});

// ============================================================================
// 🚨 A CONSEQUÊNCIA: MEIA CORREÇÃO TROCA UMA RECUSA POR OUTRA
//
// Provado sobre o arquivo REAL da HYPE: como ele está hoje, nenhum item do
// 0200 é órfão. Tirando SÓ o C170 das NFC-e, aparecem **quatro** — `10`, `11`,
// `20` e `101`, que só existem em cupom. É a recusa que a PWR já pagou em
// 19/08: *"Não informar item, se não referenciado em pelo menos um dos demais
// blocos"*. Por isso a coleta do 0200 lê o MESMO dono que decide o C170.
// ============================================================================
describe('🚨 o 0200 e o 0190 acompanham quem os referencia', () => {
    const C100_NFCE_2 = C100_NFCE;
    const linhasCorrigidas = [
        '|0190|UN|UNIDADE|',
        '|0190|KIT|KIT|',
        '|0200|10|Bufe Avulso|||UN|00|21069090|||||',        // só existia em cupom
        '|0200|UD-10-640|Frasco pote|||KIT|00|70109021|||||', // vive na nota 55
        C100_NFCE_2,                                          // sem C170: correto
        C100_NFE, C170_DA_NFE,
    ];

    it('acusa o item que ficou sem quem o referencie, e NOMEIA qual', () => {
        const r = conferirCadastrosOrfaosContrib(linhasCorrigidas).erros;
        const itens = r.filter((e: any) => e.registro === '0200');
        expect(itens).toHaveLength(1);
        expect(itens[0].mensagem).toContain('item 10');
        expect(itens[0].fonte).toContain('PWR');
    });

    it('a unidade que sobra sozinha também sai NOMEADA', () => {
        // Tirando o item que usava UN, a unidade fica sem ninguém.
        const semUn = linhasCorrigidas.filter(l => !l.startsWith('|0200|10|'));
        const un = conferirCadastrosOrfaosContrib(semUn).erros
            .filter((e: any) => e.registro === '0190');
        expect(un).toHaveLength(1);
        expect(un[0].mensagem).toContain('unidade UN');
    });

    // ⚠️ Quem referencia aqui são C170 **e A170** — no EFD ICMS/IPI é só o
    // C170. Portar a régua do vizinho sem trocar esse conjunto acusaria todo
    // item de NFS-e num arquivo correto, que é o alarme falso que faz a equipe
    // desligar a prevalidação.
    it('item referenciado pelo A170 NÃO é órfão', () => {
        const linhas = [
            '|0200|SERV-GENERICO|Prestação de serviços|||UN|09||||||',
            '|A170|1|SERV-GENERICO|Serviço|1000,00|0,00|01|1000,00|0,6500|6,50|01|1000,00|3,0000|30,00|||0|',
        ];
        expect(conferirCadastrosOrfaosContrib(linhas).erros).toHaveLength(0);
    });

    it('nasce VERDE — arquivo coerente não produz aviso nenhum', () => {
        expect(conferirCadastrosOrfaosContrib([
            '|0190|KIT|KIT|',
            '|0200|UD-10-640|Frasco pote|||KIT|00|70109021|||||',
            C100_NFE, C170_DA_NFE,
        ]).erros).toHaveLength(0);
    });
});

// 🚨 O gerador e a coleta do 0200 têm de ler o MESMO dono — duas perguntas
// ligadas com duas respostas é o defeito que esta casa mais paga. O
// orquestrador puxa firebase-admin e não carrega no jest, então a prova é por
// VARREDURA da fonte (a mesma técnica do E520/saldo anterior).
describe('🚨 os dois leitores do dono', () => {
    const fonte = (p: string) => require('fs').readFileSync(require('path').resolve(__dirname, p), 'utf8');

    it('a coleta de itens do orquestrador chama levaC170NoContribuicoes', () => {
        const orq = fonte('../sefaz-backend/sped-contrib-orchestrator.js');
        expect(orq).toContain('levaC170NoContribuicoes');
        expect(orq).toMatch(/if \(!levaC170NoContribuicoes\(nota\)\)/);
    });

    it('e a falta é DITA, com a receita ressalvada', () => {
        const orq = fonte('../sefaz-backend/sped-contrib-orchestrator.js');
        expect(orq).toMatch(/NFC-e \(modelo 65\) foram escrituradas SEM C170/);
        expect(orq).toMatch(/nada deixa de ser apurado/);
    });
});

// ============================================================================
// 🚨 O DESCONTO SAI NO C100/C170 — o M210 sozinho não chega na tela do PVA
//
// Paulo, 25/08 (PWR 1364 · 07/2026): *"O valor da receita não pode ser esses
// 38.316,84 e sim 37.754,60 conforme a ficha financeira. Tem que ajustar no
// C100."*
//
// Cinco dias corrigindo o M210 sem efeito, porque **o PVA recalcula o M210 a
// partir dos documentos**: a tela dele trazia Σ VL_ITEM dos C170 e Σ VL_BC_PIS,
// não os campos que a gente escrevia. A correção mora no documento.
// ============================================================================
import {
    descontosDosItens, valoresLiquidosDosItens,
// @ts-ignore — módulo JS do backend, sem tipos
} from '../sefaz-backend/base-pis-cofins.js';
import {
    conferirSomaDosItensContrib,
// @ts-ignore
} from '../sefaz-backend/sped-contrib-campos.js';
// @ts-ignore
import { buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';

describe('🚨 o desconto incondicional sai da BASE, por campo próprio', () => {
    const brlNum = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));
    /** ⚠️ NÃO chamar de `it`: sombreia o `it` do jest e o erro sai em outro lugar. */
    const umItem = (v: number, icms: number, d = 0) => ({
        nItem: 1, cProd: '3', xProd: 'TELHA', qCom: 1, uCom: 'MT',
        vProd: v, vICMS: icms, vDesc: d, vBC: v - d, cfop: '5101', cst: '00', NCM: '73089090',
    });
    const nota = (itens: any[], totais: any) => ({
        chave: '35260731947349000169550010000000071369620739', numero: '7', serie: '1',
        direcao: 'saida', status: 'autorizado', dhEmi: '2026-07-24T10:00:00-03:00',
        cnpjEmit: '31947349000169', cnpjDest: '26767102000120', itens, totais,
    });
    const gerar = (n: any) => buildBlocoC_Contrib({
        empresa: { cnpj: '31947349000169', nome: 'PWR', uf: 'SP' },
        competencia: '2026-07', competenciaFim: '2026-07',
        regimeApuracao: '2', notas: [n], warnings: [] as string[],
    }).map(semQuebra);

    // A NF 7 real: 18.741,24 de mercadoria, 562,24 de desconto, ICMS 3.272,22.
    // 🚨 O VL_ITEM é BRUTO e o desconto tem CAMPO PRÓPRIO — Guia 1.35, C170
    // campo 07 ("quantidade × preço unitário") e Seção 12 (descontos
    // incondicionais → campo 08; exclusão do ICMS → campo 15).
    it('C100/C170 saem BRUTOS, com o desconto no campo 08 e a base já líquida', () => {
        const l = gerar(nota([umItem(18741.24, 3272.22, 562.24)], { vNF: 18179.00, vDesc: 562.24 }));
        const c100 = l.find((x: string) => x.startsWith('|C100|'))!.split('|');
        const c170 = l.find((x: string) => x.startsWith('|C170|'))!.split('|');
        expect(brlNum(c100[16])).toBeCloseTo(18741.24, 2);  // VL_MERC — bruto
        expect(brlNum(c100[14])).toBeCloseTo(562.24, 2);    // VL_DESC
        expect(brlNum(c170[7])).toBeCloseTo(18741.24, 2);   // VL_ITEM — bruto
        expect(brlNum(c170[8])).toBeCloseTo(562.24, 2);     // VL_DESC — campo 08
        expect(brlNum(c170[15])).toBeCloseTo(3272.22, 2);   // VL_ICMS — campo 15
        // E a BASE já sai líquida das duas exclusões: 18.741,24 − 562,24 − ICMS.
        expect(brlNum(c170[26])).toBeCloseTo(14906.78, 2);
    });

    // 🚨 As DUAS formas do desconto dão o MESMO arquivo — a armadilha das duas
    // formas, agora no campo que o PVA lê para montar a receita.
    it('desconto só no TOTAL do documento chega ao campo 08 pelo rateio', () => {
        const l = gerar(nota([umItem(18741.24, 3272.22)], { vNF: 18179.00, vDesc: 562.24 }));
        const c170 = l.find((x: string) => x.startsWith('|C170|'))!.split('|');
        expect(brlNum(c170[7])).toBeCloseTo(18741.24, 2);   // item continua bruto
        expect(brlNum(c170[8])).toBeCloseTo(562.24, 2);     // e o desconto aparece
        expect(brlNum(c170[26])).toBeCloseTo(14906.78, 2);  // a base desconta
    });

    it('nas DUAS casas não desconta duas vezes', () => {
        const l = gerar(nota([umItem(18741.24, 3272.22, 562.24)], { vNF: 18179.00, vDesc: 562.24 }));
        const c170 = l.find((x: string) => x.startsWith('|C170|'))!.split('|');
        expect(brlNum(c170[8])).toBeCloseTo(562.24, 2);
        expect(brlNum(c170[26])).toBeCloseTo(14906.78, 2);
    });

    // ⚠️ O rateio fecha na UNIDADE: Σ dos rateados = o desconto do documento.
    // Sem isso trocaríamos a divergência por um erro de arredondamento.
    it('o rateio entre itens fecha no centavo', () => {
        const n = { itens: [{ vProd: 33.33 }, { vProd: 33.33 }, { vProd: 33.34 }], totais: { vDesc: 10 } };
        const d = descontosDosItens(n);
        expect(d.reduce((s: number, v: number) => s + v, 0)).toBeCloseTo(10, 2);
        expect(valoresLiquidosDosItens(n).reduce((s: number, v: number) => s + v, 0)).toBeCloseTo(90, 2);
    });

    it('sem desconto nenhum o item continua com o valor cheio', () => {
        const n = { itens: [{ vProd: 100 }], totais: {} };
        expect(descontosDosItens(n)).toEqual([0]);
        expect(valoresLiquidosDosItens(n)).toEqual([100]);
    });

    it('e o M210 declara a Σ VL_ITEM — 38.316,84 nas 5 saídas da PWR', () => {
        const nf = (n: string, itens: any[], totais: any) => ({
            chave: `3526073194734900016955001000000000${n}1369620739`, numero: n, serie: '1',
            direcao: 'saida', status: 'autorizado', dhEmi: '2026-07-24T10:00:00-03:00',
            cnpjEmit: '31947349000169', cnpjDest: '26767102000120', itens, totais,
        });
        const d = {
            empresa: { cnpj: '31947349000169', nome: 'PWR', uf: 'SP' },
            competencia: '2026-07', competenciaFim: '2026-07', regimeApuracao: '2',
            notas: [
                nf('3', [umItem(6743.10, 1213.76), { ...umItem(1819.44, 327.50), nItem: 2 }], { vNF: 8562.54 }),
                nf('4', [umItem(2105.60, 379.01)], { vNF: 2105.60 }),
                nf('5', [umItem(4485.51, 807.39)], { vNF: 4485.51 }),
                nf('6', [umItem(4421.95, 795.95)], { vNF: 4421.95 }),
                nf('7', [umItem(18741.24, 3272.22, 562.24)], { vNF: 18179.00, vDesc: 562.24 }),
            ],
            warnings: [] as string[],
        };
        const m210 = buildBlocoM(d).map(semQuebra).find((x: string) => x.startsWith('|M210|'))!;
        expect(m210).toBe('|M210|51|38316,84|30958,77|||30958,77|0,6500|||201,23|||||201,23|');
    });
});

// 🚨 A TRAVA DA MEIA CORREÇÃO: mexer no VL_MERC sem mexer no VL_ITEM (ou o
// contrário) faz o pai e os filhos declararem valores diferentes. Ela nasce
// VERDE e existe porque esta correção mexeu nos DOIS lados de uma igualdade.
describe('🚨 Σ VL_ITEM tem de fechar com o VL_MERC do C100 pai', () => {
    const C100 = (merc: string) => `|C100|1|0|26767102000120|55|00|001|7|3526|24072026|24072026`
        + `|18179,00|0|562,24||${merc}|9|0,00|0,00|0,00|18179,00|3272,22|0,00|0,00|0,00|118,16|545,37|||`;
    const C170 = (item: string) => `|C170|1|3|TELHA|187,60000|MT|${item}|562,24|0|000|5101|`
        + `|18179,00|18,00|3272,22|0,00|0,00|0,00|0|||0,00|0,00|0,00|01|14906,78|0,6500|||96,89`
        + `|01|14906,78|3,0000|||447,20||`;

    it('nasce VERDE quando os dois lados dizem o mesmo', () => {
        expect(conferirSomaDosItensContrib([C100('18179,00'), C170('18179,00')]).erros).toHaveLength(0);
    });

    it('acusa a meia correção, com os dois números e o número do documento', () => {
        const r = conferirSomaDosItensContrib([C100('18179,00'), C170('18741,24')]).erros;
        expect(r).toHaveLength(1);
        expect(r[0].registro).toBe('C100');
        expect(r[0].mensagem).toContain('18179.00');
        expect(r[0].mensagem).toContain('18741.24');
        expect(r[0].mensagem).toContain('nº 7');
        expect(r[0].fonte).toContain('C170 campo 07');
    });

    // ⚠️ C100 sem filho não é acusado: a cancelada entra COM C100 e sem C170,
    // e acusá-la seria alarme sobre escrituração correta.
    it('C100 sem C170 (cancelada, NFC-e) não é acusado', () => {
        expect(conferirSomaDosItensContrib([C100('18179,00')]).erros).toHaveLength(0);
        expect(conferirSomaDosItensContrib([C100('0,00'), '|C990|3|']).erros).toHaveLength(0);
    });
});
