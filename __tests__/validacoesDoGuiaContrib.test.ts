// ============================================================================
// 🚨 O GUIA TEM 343 LINHAS DE "Validação:" E NINGUÉM AS TINHA LIDO
//
// Com o Guia Prático 1.35 no repo (25/08), varri as validações OFICIAIS dos
// registros que o gerador de fato emite — 92 delas — e cruzei com o que a
// prevalidação já conferia. Duas classes saltaram, e nenhuma estava coberta:
//
//   1. **VL = base × alíquota ÷ 100**, exigida em SEIS registros (A170, C170,
//      D101, D105, F100 e F550). É a assinatura do CAMPO DESLOCADO: o M210 da
//      MANTOAN (18/08) declarava base R$ 0,65 e contribuição R$ 285,28 — os
//      VALORES certos, a FORMA errada, e o registro se desmentindo dentro de
//      si mesmo. A contagem de campos pega o registro que PERDEU campos; esta
//      pega o que manteve a contagem e trocou as casas.
//
//   2. **O período do 0000 tem de ser um MÊS INTEIRO** (campos 06 e 07). É o
//      campo mais caro do arquivo: ele diz a que mês tudo isto se refere.
//
// ⚠️ O RESTO DAS 92 NÃO ENTROU, e isso é decisão: a maioria depende de tabela
// oficial que não está neste repo (Municípios do IBGE, Países, 4.3.7, 0400,
// 0450) ou pergunta sobre registro que o gerador não emite. Conferir contra
// tabela deduzida seria inventar a tabela — o defeito que o 1405 já custou.
// ============================================================================
import {
    conferirAritmeticaPisCofins, conferirPeriodoDoArquivo, avisosDaPrevalidacaoContrib,
// @ts-ignore — módulo JS do backend, sem tipos
} from '../sefaz-backend/sped-contrib-campos.js';

/**
 * Linhas REAIS: arquivos aceitos ou gerados dos clientes já fechados por
 * recibo. É contra elas que a trava tem de nascer verde — trava que nasce
 * vermelha é trava que a equipe desliga.
 */
const LINHAS_REAIS = [
    '|0000|006|0|||01072026|31072026|PWR|31947349000169|SP|3507605||00|0|',
    // AFFITTARE 05/2026 (e-Fiscal, assinado).
    '|F550|21811,34|01|0|21811,34|0,65|141,76|01|0|21811,34|3|654,33|||||',
    // CF BANK 06/2026 (assinado) — receita de aplicação financeira.
    '|F100|1|||30062026|21647,53|02|21647,53|0,65|140,71|02|21647,53|4|865,90|||30106030012|||',
    // PWR 07/2026 — C170 com a base do Tema 69 (ICMS fora).
    '|C170|1|7803|MERC|1|UN|19580,00|0,00|0|000|5101||19580,00|18|3524,40|||||0||0,00|0,00|0,00'
        + '|01|16055,60|0,6500|||104,36|01|16055,60|7,6000|||1220,23||',
    // MANTOAN 07/2026 — o A170 sintético de serviço.
    '|A170|1|SERV-GENERICO|SERVICO|1330,00||||01|1330,00|0,6500|8,65|01|1330,00|3,0000|39,90|||',
    '|D101|2|1000,00|50|09|1000,00|1,6500|16,50||',
    '|D105|2|1000,00|50|09|1000,00|7,6000|76,00||',
];

const erros = (fn: any, linhas: string[]) => fn(linhas).erros as any[];

describe('🚨 VL = base × alíquota ÷ 100 — a mesma validação em seis registros', () => {
    it('nasce VERDE sobre as linhas reais dos clientes fechados', () => {
        expect(erros(conferirAritmeticaPisCofins, LINHAS_REAIS)).toEqual([]);
    });

    // ⚠️ O ARQUIVO ACEITO DA AFFITTARE É A PROVA DE QUE A TOLERÂNCIA PRECISA
    // EXISTIR: 21.811,34 × 0,65% = 141,7737 e o e-Fiscal declarou 141,76 —
    // o próprio arquivo que a Receita aceitou arredonda para baixo.
    it('arredondamento legítimo NÃO vira alarme', () => {
        expect(erros(conferirAritmeticaPisCofins, [
            '|D101|2|1000,00|50|09|21811,34|0,6500|141,76||',
        ])).toEqual([]);
    });

    it('acusa o valor que não fecha com a própria base e alíquota da linha', () => {
        const r = erros(conferirAritmeticaPisCofins, ['|D101|2|1000,00|50|09|1000,00|1,6500|99,99||']);
        expect(r).toHaveLength(1);
        expect(r[0].mensagem).toMatch(/dá 16,50/);
        expect(r[0].mensagem).toMatch(/declara 99,99/);
    });

    // 🐛 A CONTA SOZINHA NÃO PEGARIA ISTO — descoberto medindo a própria régua.
    // Multiplicação é COMUTATIVA: base e alíquota trocadas de casa dão o mesmo
    // produto, e a trava ficava MUDA no deslocamento de UM campo, que é o caso
    // mais provável. Quem desempata é o que a alíquota É: um percentual.
    it('acusa base e alíquota TROCADAS — que a conta sozinha deixaria passar', () => {
        const linha = '|A170|1|X|Y|1330,00||||01|0,6500|1330,00|8,65|01|1330,00|3,0000|39,90|||';
        const r = erros(conferirAritmeticaPisCofins, [linha]);
        expect(r).toHaveLength(1);
        expect(r[0].mensagem).toMatch(/alíquota de 1330,00%/);
        expect(r[0].mensagem).toMatch(/comutativa/);
        // A prova de que a conta sozinha não bastava: o produto é o MESMO.
        expect(Math.round((65 * 1330) / 100)).toBe(865);
    });

    // ⚠️ A própria validação diz "campo 26 **ou** campo 28": com alíquota por
    // QUANTIDADE a conta é reais por unidade, sem dividir por 100. Acusar ali
    // seria alarme sobre linha correta.
    it('linha com alíquota por QUANTIDADE fica de fora', () => {
        const c170 = '|C170|1|X|Y|1|UN|100,00|||||||||||||||||01||||0,50|2,00|01||||0,50|9,00||';
        expect(erros(conferirAritmeticaPisCofins, [c170])).toEqual([]);
    });

    // Ausência é OUTRA pergunta — e o app já se recusa a preencher campo de
    // valor com default. Aqui só se confere o que está ESCRITO.
    it('campo em branco não vira zero nem vira erro', () => {
        expect(erros(conferirAritmeticaPisCofins, [
            '|D101|2|1000,00|70||||||',
            '|F550|21811,34|01|0||||01|0||||||||',
        ])).toEqual([]);
    });

    it('os seis registros são conferidos, não só um', () => {
        const tortas = [
            '|A170|1|X|Y|100,00||||01|100,00|1,6500|99,00|01|100,00|7,6000|88,00|||',
            '|C170|1|X|Y|1|UN|100,00|0,00|0|000|5101||0,00|0|0,00|||||0||0,00|0,00|0,00'
                + '|01|100,00|0,6500|||99,00|01|100,00|7,6000|||88,00||',
            '|D101|2|100,00|50|09|100,00|1,6500|99,00||',
            '|D105|2|100,00|50|09|100,00|7,6000|88,00||',
            '|F100|1|||30062026|100,00|02|100,00|0,65|99,00|02|100,00|4|88,00|||||',
            '|F550|100,00|01|0|100,00|0,65|99,00|01|0|100,00|3|88,00|||||',
        ];
        const acusados = new Set(erros(conferirAritmeticaPisCofins, tortas).map((e: any) => e.registro));
        expect([...acusados].sort()).toEqual(['A170', 'C170', 'D101', 'D105', 'F100', 'F550']);
    });
});

describe('🚨 o período do 0000 tem de ser um MÊS INTEIRO', () => {
    it('nasce VERDE sobre o 0000 real', () => {
        expect(erros(conferirPeriodoDoArquivo, LINHAS_REAIS)).toEqual([]);
    });

    it('fevereiro bissexto fecha no dia 29 — e isso é correto', () => {
        expect(erros(conferirPeriodoDoArquivo, ['|0000|006|0|||01022028|29022028|X|1|SP|3|||0|'])).toEqual([]);
    });

    it('dia 29 num fevereiro de 28 é acusado', () => {
        const r = erros(conferirPeriodoDoArquivo, ['|0000|006|0|||01022026|29022026|X|1|SP|3|||0|']);
        expect(r).toHaveLength(1);
        expect(r[0].mensagem).toMatch(/28022026/);
    });

    it('começar no meio do mês é acusado', () => {
        const r = erros(conferirPeriodoDoArquivo, ['|0000|006|0|||05072026|31072026|X|1|SP|3|||0|']);
        expect(r).toHaveLength(1);
        expect(r[0].mensagem).toMatch(/PRIMEIRO dia/);
    });

    // 🚨 O CASO MAIS CARO: o movimento sairia declarado num mês que não é o
    // dele, e ninguém confere data de período a olho.
    it('período atravessando a virada do mês é acusado, e só uma vez', () => {
        const r = erros(conferirPeriodoDoArquivo, ['|0000|006|0|||01072026|31082026|X|1|SP|3|||0|']);
        expect(r).toHaveLength(1);
        expect(r[0].mensagem).toMatch(/meses diferentes/);
    });

    // ⚠️ Data ilegível NÃO vira "mês errado": é outra falha, e dizer a errada
    // manda procurar problema no lugar errado.
    it('data ilegível é acusada como formato, não como mês errado', () => {
        const r = erros(conferirPeriodoDoArquivo, ['|0000|006|0|||2026-07-01|31072026|X|1|SP|3|||0|']);
        expect(r).toHaveLength(1);
        expect(r[0].mensagem).toMatch(/DDMMAAAA/);
        expect(r[0].mensagem).not.toMatch(/PRIMEIRO dia/);
    });

    it('arquivo sem 0000 não é acusado por esta regra', () => {
        expect(erros(conferirPeriodoDoArquivo, ['|C100|1|0|X|55|00|1|1|C|01072026|01072026|10,00|'])).toEqual([]);
    });
});

describe('🚨 as duas entram na prevalidação — trava escrita não é trava ligada', () => {
    it('o agregador chama as duas', () => {
        const avisos = avisosDaPrevalidacaoContrib([
            '|0000|006|0|||05072026|31072026|X|1|SP|3|||0|',
            '|D101|2|1000,00|50|09|1000,00|1,6500|99,99||',
        ]) as string[];
        const texto = avisos.join(' ');
        expect(texto).toMatch(/PRIMEIRO dia/);
        expect(texto).toMatch(/não fecha consigo mesmo/);
    });

    it('e ficam MUDAS no arquivo correto', () => {
        const avisos = avisosDaPrevalidacaoContrib(LINHAS_REAIS) as string[];
        expect(avisos.join(' ')).not.toMatch(/não fecha consigo mesmo|PRIMEIRO dia|DDMMAAAA/);
    });
});
