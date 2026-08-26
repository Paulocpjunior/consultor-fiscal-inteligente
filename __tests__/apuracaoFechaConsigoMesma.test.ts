// ============================================================================
// 🚨 A APURAÇÃO NUNCA TINHA SIDO PERGUNTADA SE FECHA CONSIGO MESMA
//
// Varrendo as 885 linhas de "Validação:" do Guia Prático 3.2.3 (o do EFD
// ICMS/IPI, no repo desde 20/08), 147 são de registros que o gerador emite —
// e as mais caras estavam descobertas: **a aritmética da apuração**, que é o
// número que vira GUIA.
//
// Este registro já mordeu duas vezes, e as duas passaram por teste verde:
//
//   · 02/08 — o E110 campo 11 (saldo DEVEDOR) recebia o saldo CREDOR em valor
//     absoluto: o arquivo declarava imposto a pagar num mês em que a empresa
//     era credora. Os totais estavam certos um a um; o que não fechava era a
//     EXPRESSÃO, e nada perguntava por ela.
//   · 19/08 — o E520 foi lido na posição errada pelo parser do espelho, com o
//     VL_OD_IPI ocupando a casa do saldo credor. Passou meses despercebido
//     porque pouquíssimos clientes têm IPI e o número plausível era zero.
//
// ⚠️ E AS TRÊS TÊM UM CENTAVO DE TOLERÂNCIA: os campos saem de
// `aplicarAjustesApuracao`, que arredonda a cada passo. Alarme sobre
// arredondamento é o que ensina a equipe a ignorar a prevalidação; erro de
// sinal ou campo trocado de casa erra por ORDEM DE GRANDEZA.
// ============================================================================
// Sem silenciador de tipo: os dois módulos têm `.d.ts`, então o tsc CONFERE o
// que se importa aqui — calar o aviso faria os dois voltarem a ser `any`.
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';
import {
    classificarAjustes, aplicarAjustesApuracao,
} from '../sefaz-backend/sped-ajustes-apuracao.js';

const NOVAS = ['e110-apuracao-nao-fecha', 'e110-x-e116', 'e520-saldo-ipi'];
const soAsNovas = (linhas: string[]) =>
    (prevalidarSpedFiscal(linhas).erros as any[]).filter(e => NOVAS.includes(e.regra));

const v = (n: number) => n.toFixed(2).replace('.', ',');

/** Monta o E110 e o E116 a partir da PRÓPRIA régua de apuração do app. */
function apuracaoReal(base: any, ajustes: any[] = []) {
    const ap = aplicarAjustesApuracao(base, classificarAjustes(ajustes, 'SP', 'proprio'));
    const e110 = `|E110|${v(ap.vlTotDebitos)}|0,00|${v(ap.vlTotAjDebitos)}|${v(ap.vlEstornosCred)}`
        + `|${v(ap.vlTotCreditos)}|0,00|${v(ap.vlTotAjCreditos)}|${v(ap.vlEstornosDeb)}`
        + `|${v(ap.vlSldCredorAnt)}|${v(ap.vlSldApurado)}|${v(ap.vlTotDed)}`
        + `|${v(ap.vlIcmsRecolher)}|${v(ap.vlSldCredorTransportar)}|${v(ap.vlDebEsp)}|`;
    const e116 = `|E116|000|${v(ap.vlIcmsRecolher + ap.vlDebEsp)}|20082026|046-2|||||072026|`;
    return { e110, e116, ap };
}

describe('🚨 R17 — a apuração do E110 fecha consigo mesma', () => {
    // A régua da casa: trava nasce VERDE. Estes quatro são os caminhos que
    // `aplicarAjustesApuracao` de fato produz hoje.
    it.each([
        ['devedor simples', { vlTotDebitos: 10000, vlTotCreditos: 4000, vlSldCredorAnt: 0 }, []],
        ['devedor com dedução', { vlTotDebitos: 10000, vlTotCreditos: 4000, vlSldCredorAnt: 0 },
            [{ codigo: 'SP040004', valor: 500, descricao: 'd' }]],
        ['credor no período', { vlTotDebitos: 1000, vlTotCreditos: 4000, vlSldCredorAnt: 0 }, []],
        ['com saldo credor anterior', { vlTotDebitos: 5000, vlTotCreditos: 1000, vlSldCredorAnt: 2500 }, []],
        // ⚠️ Dedução maior que o saldo devedor não vira crédito (o excedente é
        // perdido e o gerador avisa) — a regra tem de acompanhar isso.
        ['dedução MAIOR que o devedor', { vlTotDebitos: 1000, vlTotCreditos: 0, vlSldCredorAnt: 0 },
            [{ codigo: 'SP040004', valor: 5000, descricao: 'd' }]],
    ])('nasce VERDE: %s', (_nome, base, ajustes) => {
        const { e110, e116 } = apuracaoReal(base, ajustes as any[]);
        expect(soAsNovas([e110, e116])).toEqual([]);
    });

    // 🚨 O DEFEITO DE 02/08, reconstruído: débitos 1.000, créditos 4.000 — a
    // empresa é CREDORA de 3.000 —, e o arquivo põe os 3.000 no campo do saldo
    // DEVEDOR e manda recolher. Cada total, isolado, está certo.
    it('acusa o saldo CREDOR ocupando o campo do saldo DEVEDOR', () => {
        const r = soAsNovas(['|E110|1000,00|0,00|0,00|0,00|4000,00|0,00|0,00|0,00|0,00|3000,00|0,00|3000,00|0,00|0,00|']);
        expect(r.map(e => e.campo).sort()).toEqual(['11 - VL_SLD_APURADO', '14 - VL_SLD_CREDOR_TRANSPORTAR']);
        expect(r[0].mensagem).toMatch(/não fecha consigo mesma/);
        expect(r[0].acao).toMatch(/defeito de GERAÇÃO/i);
    });

    it('acusa o VL_ICMS_RECOLHER que não é o saldo menos as deduções', () => {
        const r = soAsNovas(['|E110|10000,00|0,00|0,00|0,00|4000,00|0,00|0,00|0,00|0,00|6000,00|500,00|6000,00|0,00|0,00|']);
        expect(r).toHaveLength(1);
        expect(r[0].campo).toBe('13 - VL_ICMS_RECOLHER');
        expect(r[0].esperado).toBe('5500.00');
    });

    it('um centavo de arredondamento não vira alarme', () => {
        expect(soAsNovas(['|E110|10000,01|0,00|0,00|0,00|4000,00|0,00|0,00|0,00|0,00|6000,00|0,00|6000,00|0,00|0,00|']))
            .toEqual([]);
    });
});

describe('🚨 R18 — o que o E110 apura é o que o E116 cobra', () => {
    it('nasce VERDE quando os dois lados dizem o mesmo', () => {
        const { e110, e116 } = apuracaoReal({ vlTotDebitos: 9000, vlTotCreditos: 2000, vlSldCredorAnt: 0 });
        expect(soAsNovas([e110, e116])).toEqual([]);
    });

    // 🚨 O E116 é a OBRIGAÇÃO — é dele que sai a guia. Os dois lados são
    // montados em passos diferentes do gerador, então divergirem é o defeito
    // que ninguém confere a olho.
    it('acusa o livro e a obrigação declarando valores diferentes', () => {
        const r = soAsNovas([
            '|E110|10000,00|0,00|0,00|0,00|4000,00|0,00|0,00|0,00|0,00|6000,00|0,00|6000,00|0,00|0,00|',
            '|E116|000|5000,00|20082026|046-2|||||072026|',
        ]);
        expect(r).toHaveLength(1);
        expect(r[0].registro).toBe('E116');
        expect(r[0].mensagem).toMatch(/6000\.00 a recolher/);
        expect(r[0].mensagem).toMatch(/somam 5000\.00/);
    });

    // O DEB_ESP entra na soma por determinação do próprio Guia — deixá-lo de
    // fora acusaria arquivo correto de toda empresa com débito especial.
    it('o DEB_ESP conta do lado do E110', () => {
        expect(soAsNovas([
            '|E110|10000,00|0,00|0,00|0,00|4000,00|0,00|0,00|0,00|0,00|6000,00|0,00|6000,00|0,00|300,00|',
            '|E116|000|6300,00|20082026|046-2|||||072026|',
        ])).toEqual([]);
    });

    it('arquivo sem E116 não é acusado — a regra fica MUDA', () => {
        expect(soAsNovas(['|E110|10000,00|0,00|0,00|0,00|4000,00|0,00|0,00|0,00|0,00|6000,00|0,00|6000,00|0,00|0,00|']))
            .toEqual([]);
    });
});

describe('🚨 R19 — o saldo do IPI no E520 segue a própria conta', () => {
    // A linha REAL da PWR 07/2026, que fecha: 2.547,39 + 2.200,45 = 4.747,84.
    it('nasce VERDE sobre a linha real da PWR', () => {
        expect(soAsNovas(['|E520|2547,39|0,00|2200,45|0,00|0,00|4747,84|0,00|'])).toEqual([]);
    });

    it('mês devedor de IPI fecha no campo 8', () => {
        expect(soAsNovas(['|E520|0,00|5000,00|1200,00|0,00|0,00|0,00|3800,00|'])).toEqual([]);
    });

    // 🐛 O defeito de 19/08 na forma que ele teria no ARQUIVO: o crédito indo
    // para a casa do saldo devedor.
    it('acusa o saldo credor de IPI na casa do devedor', () => {
        const r = soAsNovas(['|E520|2547,39|0,00|2200,45|0,00|0,00|0,00|4747,84|']);
        expect(r.map(e => e.campo).sort()).toEqual(['7 - VL_SC_IPI', '8 - VL_SD_IPI']);
        expect(r[0].acao).toMatch(/competência seguinte/);
    });
});

describe('🚨 e a régua do PERÍODO passou a rodar nas DUAS famílias', () => {
    // ⚠️ A posição é PARÂMETRO: campos 04/05 aqui, 06/07 no EFD-Contribuições
    // (cujo 0000 traz IND_SIT_ESP e NUM_REC_ANTERIOR antes das datas).
    // Carimbar a posição do vizinho faria a regra ler o nome da empresa como
    // se fosse data — o erro que o teste do DT_FIN pegou em 22/08.
    const doPeriodo = (linhas: string[]) =>
        (prevalidarSpedFiscal(linhas).erros as any[]).filter(e => e.regra === 'periodo-nao-e-mes-inteiro');

    it('nasce VERDE no 0000 real do EFD ICMS/IPI', () => {
        expect(doPeriodo(['|0000|017|0|01072026|31072026|PWR|31947349000169|SP|123|3507605|||A|1|'])).toEqual([]);
    });

    it('acusa o período atravessando a virada — e lê os campos 04/05', () => {
        const r = doPeriodo(['|0000|017|0|05072026|31082026|PWR|31947349000169|SP|123|3507605|||A|1|']);
        expect(r).toHaveLength(1);
        expect(r[0].campo).toMatch(/4 e 5/);
        expect(r[0].mensagem).toMatch(/meses diferentes/);
    });

    it('lê a DATA, não a razão social — a posição do vizinho leria o nome da empresa', () => {
        // No 0000 do EFD-Contribuições o campo 6 é a data; aqui ele é o NOME.
        const linha = '|0000|017|0|01072026|31072026|PWR|31947349000169|SP|123|3507605|||A|1|';
        expect(String(linha.split('|')[6])).toBe('PWR');
        expect(doPeriodo([linha])).toEqual([]);
    });
});
