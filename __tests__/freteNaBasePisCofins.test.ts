// ============================================================================
// 🚚 O FRETE COBRADO DO ADQUIRENTE ENTRA NA BASE DO PIS/COFINS
//
// Paulo, 16/09 — PWR INDUSTRIA METALURGICA 1364 · 08/2026:
//
// *"já fizemos ele mês passado, certinho já está ajustado… porém fui entregar
// do mês 08, algumas notas têm frete, então o consultor não entendeu que o
// valor dos fretes é somado com o valor das mercadorias… no mês que fizemos as
// notas não tinha frete."*
//
// ═══ OS DOIS PRINTS FECHAM A CONTA AO CENTAVO ═══════════════════════════════
//
// M210 do PVA:              VL_REC_BRT 17.775,31 · VL_BC_CONT 14.436,83
// Memória de Apuração CFI:  receita     18.355,90 · base        15.186,83
//                           (− Ded. ICMS s/ Vendas 3.169,07)
//                           PIS 98,71 · COFINS 455,60 · total 554,31
//
// A diferença da BASE é **R$ 750,00** — o frete do mês. E a da receita é
// 580,59, que é o mesmo frete menos o desconto de 169,41 (a ficha parte do
// total da nota: vProd + frete − desconto). Ou seja: o desconto JÁ estava
// sendo abatido; o que faltava era só o frete.
//
// 🚨 **O CUSTO É A GUIA E O ARQUIVO BEBENDO DE FONTES DIFERENTES** — a
// divergência que esta casa mais paga, agora na direção em que a Receita
// cobra: o cliente pagou 554,31 e o SPED declarava 526,94 (PIS 93,84 +
// COFINS 433,10). E o PVA ACEITA, porque ele regera o bloco M a partir dos
// nossos próprios C170: os dois lados do arquivo concordam entre si e
// discordam da guia.
//
// ═══ A FONTE É LITERAL, e ela separa os dois casos ══════════════════════════
//
// Guia Prático 1.35, C100 campo 18 (VL_FRT), Observações:
//
//   "Quando o frete nas operações de vendas não for suportado pelo vendedor,
//    mas sim pelo adquirente, o seu valor deve integrar a base de cálculo
//    do(s) produto(s) vendido(s), devendo assim ter o seu valor acrescido ao
//    valor da base de cálculo do PIS/Pasep e da Cofins, nos correspondentes
//    campos do Registro C170."
//
//   "Quando o frete nas operações de vendas for suportado pelo vendedor, o seu
//    valor constituí hipótese de crédito no regime não cumulativo…"
//
// ⚠️ **ELE NÃO VAI AO VL_ITEM.** O campo 07 é *"somente o valor das
// mercadorias (equivalente à quantidade vezes preço unitário)"*, e a validação
// o amarra ao VL_MERC do C100 — somar o frete ali produziria DUAS recusas no
// lugar de uma divergência de tela. Por isso o VL_REC_BRT do M210 continua
// 17.775,31 e só a BASE sobe.
// ============================================================================
import {
    fretesDosItens, receitaEBaseDoDocumento, baseDoItem,
// @ts-ignore — módulo JS do backend, sem tipos
} from '../sefaz-backend/base-pis-cofins.js';
import { consolidarC175 } from '../sefaz-backend/sped-contrib-c175.js';
import { buildBlocoC_Contrib, buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const semQuebra = (l: string) => String(l).replace(/\r?\n$/, '');
const brlNum = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

// ─── A PWR de 08/2026, reconstruída dos dois prints ─────────────────────────
// Σ vProd 17.775,31 (o VL_REC_BRT que o PVA mostra) · desconto 169,41 ·
// ICMS 3.169,07 · frete 750,00 — e vNF = 18.355,90, que é o faturamento da
// ficha. CNPJ real da empresa não entra: os números é que são o caso.
const itemPwr = (nItem: number, vProd: number, vICMS: number, vDesc: number) => ({
    nItem, cProd: `P${nItem}`, xProd: 'PECA METALURGICA', qCom: 1, uCom: 'UN',
    vProd, vICMS, vDesc, vBC: vProd - vDesc, cfop: '5101', cst: '00', NCM: '73089090',
});
const notaPwr = (totais: any, itens?: any[]) => ({
    chave: '35260800000000000191550010000000081369620739', numero: '8', serie: '1',
    direcao: 'saida', status: 'autorizado', dhEmi: '2026-08-14T10:00:00-03:00',
    tpNF: '1', cnpjEmit: '00000000000191', cnpjDest: '00000000000272',
    itens: itens || [itemPwr(1, 10000.00, 1800.00, 100.00), itemPwr(2, 7775.31, 1369.07, 69.41)],
    totais,
});
const dados = (notas: any[], warnings: string[] = []) => ({
    empresa: { cnpj: '00000000000191', nome: 'PWR', uf: 'SP' },
    competencia: '2026-08', competenciaFim: '2026-08',
    regimeApuracao: '2', notas, warnings,
});

describe('🚚 o caso PWR 08/2026 — R$ 750,00 de frete fora da base', () => {
    it('a BASE passa a ser a da ficha (15.186,83), e a receita segue 17.775,31', () => {
        const rb = receitaEBaseDoDocumento(notaPwr({ vFrete: 750.00, vNF: 18355.90 }));
        // O VL_REC_BRT é a Σ VL_ITEM (Guia, M210 campo 03) — o frete não entra.
        expect(rb.receitaBruta).toBeCloseTo(17775.31, 2);
        expect(rb.frete).toBeCloseTo(750.00, 2);
        // 17.775,31 − 169,41 (desconto) − 3.169,07 (ICMS) + 750,00 = 15.186,83
        expect(rb.base).toBeCloseTo(15186.83, 2);
        expect(rb.desconto).toBeCloseTo(169.41, 2);
        expect(rb.icms).toBeCloseTo(3169.07, 2);
    });

    it('PIS e COFINS batem com a Memória de Apuração ao CENTAVO', () => {
        const rb = receitaEBaseDoDocumento(notaPwr({ vFrete: 750.00, vNF: 18355.90 }));
        expect(Number((rb.base * 0.0065).toFixed(2))).toBe(98.71);
        expect(Number((rb.base * 0.03).toFixed(2))).toBe(455.60);
    });

    it('sem o frete, a base é a que o PVA mostrava — o defeito reproduzido', () => {
        const rb = receitaEBaseDoDocumento(notaPwr({ vNF: 17605.90 }));
        expect(rb.base).toBeCloseTo(14436.83, 2);
        expect(rb.frete).toBe(0);
    });

    it('o ARQUIVO gerado leva o frete nos campos 26 e 32 do C170, e NÃO no 07', () => {
        const linhas = buildBlocoC_Contrib(dados([notaPwr({ vFrete: 750.00, vNF: 18355.90 })]))
            .map(semQuebra);
        const c170 = linhas.filter((l: string) => l.startsWith('|C170|')).map((l: string) => l.split('|'));
        expect(c170).toHaveLength(2);
        // VL_ITEM (07) BRUTO, sem frete — a validação o amarra ao VL_MERC.
        expect(brlNum(c170[0][7]) + brlNum(c170[1][7])).toBeCloseTo(17775.31, 2);
        // VL_BC_PIS (26) e VL_BC_COFINS (32) COM o frete rateado.
        expect(brlNum(c170[0][26]) + brlNum(c170[1][26])).toBeCloseTo(15186.83, 2);
        expect(brlNum(c170[0][32]) + brlNum(c170[1][32])).toBeCloseTo(15186.83, 2);
        // E o VL_MERC do C100 continua fechando com a Σ dos VL_ITEM.
        const c100 = linhas.find((l: string) => l.startsWith('|C100|'))!.split('|');
        expect(brlNum(c100[16])).toBeCloseTo(17775.31, 2);
    });

    it('o VALOR do C170 segue a base — base × alíquota, senão a linha se desmente', () => {
        const linhas = buildBlocoC_Contrib(dados([notaPwr({ vFrete: 750.00, vNF: 18355.90 })]))
            .map(semQuebra);
        for (const l of linhas.filter((x: string) => x.startsWith('|C170|'))) {
            const c = l.split('|');
            expect(brlNum(c[30])).toBeCloseTo(brlNum(c[26]) * (brlNum(c[27]) / 100), 2);
            expect(brlNum(c[36])).toBeCloseTo(brlNum(c[32]) * (brlNum(c[33]) / 100), 2);
        }
    });

    it('o BLOCO M declara a base com o frete — é ela que a guia paga', () => {
        const linhas = buildBlocoM(dados([notaPwr({ vFrete: 750.00, vNF: 18355.90 })])).map(semQuebra);
        const m210 = linhas.find((l: string) => l.startsWith('|M210|'))!.split('|');
        const m610 = linhas.find((l: string) => l.startsWith('|M610|'))!.split('|');
        expect(brlNum(m210[3])).toBeCloseTo(17775.31, 2);   // VL_REC_BRT — sem frete
        expect(brlNum(m210[4])).toBeCloseTo(15186.83, 2);   // VL_BC_CONT — com frete
        expect(brlNum(m610[4])).toBeCloseTo(15186.83, 2);
    });
});

describe('⚠️ as DUAS formas do frete — item e total do documento', () => {
    it('o item manda quando ele traz o campo', () => {
        const f = fretesDosItens({
            itens: [{ vProd: 100, vFrete: 30 }, { vProd: 100, vFrete: 70 }],
            totais: { vFrete: 999 },
        });
        expect(f).toEqual([30, 70]);
    });

    it('o total é RATEADO quando nenhum item traz — proporcional ao valor', () => {
        const f = fretesDosItens({
            itens: [{ vProd: 300 }, { vProd: 100 }],
            totais: { vFrete: 80 },
        });
        expect(f).toEqual([60, 20]);
    });

    it('o rateio fecha na UNIDADE: a Σ é exatamente o frete do documento', () => {
        const f = fretesDosItens({
            itens: [{ vProd: 33.33 }, { vProd: 33.33 }, { vProd: 33.34 }],
            totais: { vFrete: 10 },
        });
        expect(Number(f.reduce((s: number, v: number) => s + v, 0).toFixed(2))).toBe(10);
    });

    it('nota SEM frete devolve zeros — e não inventa rateio', () => {
        expect(fretesDosItens({ itens: [{ vProd: 100 }], totais: {} })).toEqual([0]);
        expect(fretesDosItens({ itens: [] })).toEqual([]);
    });

    // 🚨 Frete só no TOTAL é a forma que o emissor mais usa — ler só o item
    // deixaria a nota inteira sem frete na base, e a ausência seria PLAUSÍVEL
    // ("esta nota não tem frete"), indistinguível do caso normal.
    it('frete só no total do documento CHEGA à base do arquivo', () => {
        const rb = receitaEBaseDoDocumento({
            itens: [{ vProd: 1000, vICMS: 180 }],
            totais: { vFrete: 200 },
        });
        expect(rb.base).toBeCloseTo(1020, 2);
        expect(rb.frete).toBeCloseTo(200, 2);
    });
});

describe('⚠️ o que a régua se RECUSA a fazer', () => {
    it('o frete NÃO entra na receita bruta — o VL_ITEM é só mercadoria', () => {
        const rb = receitaEBaseDoDocumento({
            itens: [{ vProd: 1000, vICMS: 0 }], totais: { vFrete: 500 },
        });
        expect(rb.receita).toBeCloseTo(1000, 2);
        expect(rb.receitaBruta).toBeCloseTo(1000, 2);
        expect(rb.base).toBeCloseTo(1500, 2);
    });

    // O Guia: "se o produto/item goza de suspensão, isenção ou não incidência,
    // o frete correspondente goza de suspensão, isenção ou não incidência".
    it('item SEM incidência não recebe frete na base — ela sai ZERO', () => {
        const linhas = buildBlocoC_Contrib(dados([notaPwr(
            { vFrete: 100.00, vNF: 1100.00 },
            [{ ...itemPwr(1, 1000, 0, 0), cstPis: '04', cstCofins: '04' }],
        )])).map(semQuebra);
        const c170 = linhas.find((l: string) => l.startsWith('|C170|'))!.split('|');
        expect(brlNum(c170[26])).toBe(0);
        expect(brlNum(c170[32])).toBe(0);
    });

    // 🚨 NA ENTRADA O FRETE É OUTRA CONTA. O Guia trata o frete da AQUISIÇÃO
    // como custo que "pode compor a base de cálculo dos créditos não
    // cumulativos" — faculdade, em outro regime, e a PWR é cumulativa. Somá-lo
    // aqui por simetria seria inventar crédito, que é o oposto da régua da
    // casa. A prova é por RESULTADO: o arquivo sai IDÊNTICO com e sem frete.
    it('a ENTRADA não muda: arquivo byte a byte igual com e sem frete', () => {
        // ⚠️ `tpNF: '1'` — a compra normal é a SAÍDA do fornecedor. Com `'0'` de
        // terceiro a nota nem se escritura: é a régua de 09/09 (a mercadoria
        // entra em QUEM EMITIU, logo sai de nós).
        const entrada = (totais: any) => ({
            ...notaPwr(totais), direcao: 'entrada', tpNF: '1',
            cnpjEmit: '00000000000272', cnpjDest: '00000000000191',
            itens: [{ ...itemPwr(1, 10000, 1800, 0), cfop: '1102' }],
        });
        const comFrete = buildBlocoC_Contrib(dados([entrada({ vFrete: 500.00, vNF: 10500.00 })]))
            .map(semQuebra);
        const semFrete = buildBlocoC_Contrib(dados([entrada({ vNF: 10000.00 })])).map(semQuebra);
        const soC170 = (l: string[]) => l.filter((x) => x.startsWith('|C170|'));
        expect(soC170(comFrete)).toHaveLength(1);
        expect(soC170(comFrete)).toEqual(soC170(semFrete));
    });

    it('frete negativo ou ilegível não vira acréscimo', () => {
        expect(baseDoItem({ vProd: 100, vICMS: 0 }, -50)).toBeCloseTo(100, 2);
        expect(baseDoItem({ vProd: 100, vICMS: 0 }, 'abc')).toBeCloseTo(100, 2);
        expect(baseDoItem({ vProd: 100, vICMS: 0 }, undefined)).toBeCloseTo(100, 2);
    });
});

describe('🧾 o CUPOM entra na MESMA régua — o C175 não fica para trás', () => {
    it('o frete ACRESCE a base do C175 e NÃO o VL_OPR', () => {
        const r = consolidarC175([{
            cfop: '5102', vlItem: 1000, desconto: 0, icms: 180, frete: 100,
            cstPis: '01', cstCofins: '01', aliqPis: 0.65, aliqCofins: 3,
        }]).registros;
        expect(r).toHaveLength(1);
        expect(r[0].vlOpr).toBeCloseTo(1000, 2);       // receita da operação
        expect(r[0].vlBcPis).toBeCloseTo(920, 2);      // 1000 + 100 − 180
        expect(r[0].vlBcCofins).toBeCloseTo(920, 2);
    });

    it('cupom sem frete não muda — o campo é opcional', () => {
        const r = consolidarC175([{
            cfop: '5102', vlItem: 1000, desconto: 0, icms: 180,
            cstPis: '01', cstCofins: '01', aliqPis: 0.65, aliqCofins: 3,
        }]).registros;
        expect(r[0].vlBcPis).toBeCloseTo(820, 2);
    });
});

describe('📣 o número vai DITO na geração', () => {
    it('o aviso nomeia o frete, o total e diz que só a BASE sobe', () => {
        const warnings: string[] = [];
        buildBlocoM(dados([notaPwr({ vFrete: 750.00, vNF: 18355.90 })], warnings));
        const aviso = warnings.find(w => w.includes('Frete na base'));
        expect(aviso).toBeTruthy();
        expect(aviso).toContain('750,00'.replace(',', '.'));
        expect(aviso).toContain('15186.83');
        expect(aviso).toContain('C100 campo 18');
        expect(aviso).toContain('Memória de Apuração');
    });

    // ⚠️ Competência SEM frete nasce MUDA — foi assim que 07/2026 fechou certo
    // ("no mês que fizemos as notas não tinha frete"), e alarme sobre arquivo
    // correto é o jeito conhecido de a equipe parar de ler os avisos.
    it('nasce MUDO quando não há frete no mês', () => {
        const warnings: string[] = [];
        buildBlocoM(dados([notaPwr({ vNF: 17605.90 })], warnings));
        expect(warnings.find(w => w.includes('Frete na base'))).toBeUndefined();
    });

    // 🚨 A CONTA TEM DE FECHAR NA PRÓPRIA FRASE (o comentário do aviso do ICMS
    // diz isso desde 24/08). Com o frete somando na base, os dois avisos
    // antigos passariam a se desmentir no primeiro documento com frete.
    it('os avisos de desconto e de ICMS fecham a conta COM o frete', () => {
        const warnings: string[] = [];
        buildBlocoM(dados([notaPwr({ vFrete: 750.00, vNF: 18355.90 })], warnings));
        for (const trecho of ['Desconto incondicional', 'Tema 69']) {
            const a = warnings.find(w => w.includes(trecho))!;
            expect(a).toContain('+ frete 750.00');
            expect(a).toContain('15186.83');
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚦 A LIGAÇÃO É TRAVADA — régua certa com o gerador não a chamando é a
// "régua que só escreve", e ela envelheceria em SILÊNCIO (o defeito volta e
// nada acusa, porque o PVA aceita os dois lados).
// ═══════════════════════════════════════════════════════════════════════════
describe('🚦 o gerador CHAMA o dono', () => {
    const fonte = readFileSync(
        join(__dirname, '..', 'sefaz-backend', 'sped-contrib-blocos.js'), 'utf8',
    );

    it('o bloco C importa e chama fretesDosItens', () => {
        expect(fonte).toMatch(/fretesDosItens/);
        expect(fonte).toMatch(/const\s+fretesPorItem\s*=\s*fretesDosItens\(nota\)/);
    });

    it('o C170 e o C175 recebem o frete do MESMO cálculo', () => {
        const chamadas = fonte.match(/pisCofinsDoItemC170\([\s\S]{0,220}?\)/g) || [];
        // 2 chamadas no gerador (C175 e C170) — a declaração da função não casa
        // com o padrão porque ela é `function pisCofinsDoItemC170(`.
        expect(chamadas.length).toBeGreaterThanOrEqual(2);
        for (const c of chamadas) expect(c).toMatch(/frete/i);
    });

    // ⚠️ A ASSINATURA É A LINHA DO CAMPO 07, não "frete perto de vlItem": a 1ª
    // versão casava `Math.max(0, vlItem + frete - vICMS)` — que é a linha
    // CORRETA da base — e acusava código certo, o jeito conhecido de a equipe
    // desligar a trava.
    it('o campo 07 (VL_ITEM) não recebe frete — ele é amarrado ao VL_MERC', () => {
        const linhaDoCampo07 = fonte.split('\n').find((l) => /\/\/\s*7 VL_ITEM/.test(l));
        expect(linhaDoCampo07).toBeTruthy();
        expect(linhaDoCampo07).not.toMatch(/frete/i);
        const linhaDoVlMerc = fonte.split('\n').find((l) => /\/\/ 16 VL_MERC/.test(l));
        expect(linhaDoVlMerc).toBeTruthy();
        expect(linhaDoVlMerc).not.toMatch(/frete/i);
    });
});
