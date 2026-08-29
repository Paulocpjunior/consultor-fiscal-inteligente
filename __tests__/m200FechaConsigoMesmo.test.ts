// ============================================================================
// 🚨 O M200/M600 NUNCA TINHA SIDO PERGUNTADO SE FECHA CONSIGO MESMO — e é dele
// que sai o débito da DCTF.
//
// 29/08, seguindo o cruzamento "registros que o gerador EMITE × registros que a
// prevalidação COBRE" no EFD-Contribuições. O Guia 1.35 escreve a aritmética
// inteira do M200 por extenso, campo a campo — e nada perguntava por ela.
//
// 🔴 **E ESTE REGISTRO JÁ SE DESMENTIU**: em 24/08 (CF BANK) o campo 04
// (`VL_TOT_CONT_NC_DEV`) saía **0 CRAVADO** enquanto o campo 07 (a recolher)
// vinha cheio — o arquivo dizia que NADA era devido no não-cumulativo e
// declarava valor a recolher na linha seguinte. É a classe do E110 campo 11
// (02/08) e do E110 que não fechava consigo mesmo (R17, 26/08): cada total,
// isolado, parece certo — o que não fecha é a EXPRESSÃO.
//
// 🚨 E o M205 já custou **12 recusas** (DGB, 28/08) por existir com valor zero.
// A outra metade — ele existir com o valor ERRADO — é a segunda regra daqui: é
// por esse detalhamento que o débito chega à DCTF.
// ============================================================================
// @ts-expect-error — módulo backend .js sem .d.ts
import { conferirFechamentoDoM200, conferirSomaDosM205 } from '../sefaz-backend/sped-contrib-campos.js';

const L = (...c: (string | number)[]) => `|${c.join('|')}|`;

/** |M200|02|03|04|05|06|07|08|09|10|11|12|13| — 12 campos após o REG. */
const m200 = (...c: (string | number)[]) => L('M200', ...c);

describe('📖 o M200 fecha consigo mesmo — a conta do Guia', () => {
    // Cumulativo puro, como o arquivo ACEITO da HS PROJETOS (05/2026):
    // |M200|0|0|0|0|0|0|0|114,4|114,4|0|0|0|
    it('nasce VERDE sobre a linha do arquivo ACEITO', () => {
        const r = conferirFechamentoDoM200([
            m200('0', '0', '0', '0', '0', '0', '0', '114,4', '114,4', '0', '0', '0'),
        ]);
        expect(r.erros).toEqual([]);
    });

    // Não-cumulativo, como o assinado do CF BANK (06/2026):
    // |M200|140,71|0|0|140,71|0|0|140,71|…
    it('nasce VERDE sobre a linha do assinado do CF BANK', () => {
        const r = conferirFechamentoDoM200([
            m200('140,71', '0', '0', '140,71', '0', '0', '140,71', '0', '0', '0', '0', '140,71'),
        ]);
        expect(r.erros).toEqual([]);
    });

    // 🚨 O DEFEITO REAL DE 24/08: campo 04 zerado com o 07 cheio.
    it('pega o campo 04 zerado com o "a recolher" cheio — o defeito do CF BANK', () => {
        const r = conferirFechamentoDoM200([
            m200('140,71', '0', '0', '0', '0', '0', '140,71', '0', '0', '0', '0', '140,71'),
        ]);
        const e = r.erros.filter((x: { campo: string }) => x.campo.startsWith('5'));
        expect(e).toHaveLength(1);
        expect(e[0].esperado).toBe('140.71');
        expect(String(e[0].fonte)).toMatch(/VL_TOT_CONT_NC_PER - VL_TOT_CRED_DESC/);
    });

    it('pega o total geral que não é a soma das duas seções (campo 13)', () => {
        const r = conferirFechamentoDoM200([
            m200('0', '0', '0', '0', '0', '0', '0', '100,00', '0', '0', '100,00', '999,99'),
        ]);
        expect(r.erros.some((x: { campo: string }) => x.campo.startsWith('13'))).toBe(true);
    });

    it('o M600 é conferido do mesmo jeito, e a mensagem diz COFINS', () => {
        const r = conferirFechamentoDoM200([
            L('M600', '0', '0', '0', '0', '0', '0', '0', '100,00', '0', '0', '50,00', '50,00'),
        ]);
        expect(r.erros[0].registro).toBe('M600');
        expect(String(r.erros[0].mensagem)).toMatch(/COFINS/);
    });

    // ⚠️ UM CENTAVO DE TOLERÂNCIA: os campos saem de contas que arredondam a
    // cada passo. Alarme sobre arredondamento desliga a prevalidação.
    it('um centavo de diferença não acusa', () => {
        const r = conferirFechamentoDoM200([
            m200('100,00', '0', '0', '100,01', '0', '0', '100,01', '0', '0', '0', '0', '100,01'),
        ]);
        expect(r.erros).toEqual([]);
    });

    it('arquivo sem bloco M fica MUDO', () => {
        expect(conferirFechamentoDoM200([L('0000', '020')]).erros).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 RETENÇÃO MAIOR QUE O DEVIDO — o caso comum do prestador de serviço.
//
// O Guia é literal: o campo 06 deve ser **igual ou menor** que o campo 05. E o
// excedente NÃO some: é crédito a usar em períodos futuros, que se declara no
// registro **1300** — que este app NÃO gera.
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 a retenção não pode ser maior que a contribuição devida', () => {
    const r = conferirFechamentoDoM200([
        m200('100,00', '0', '0', '100,00', '150,00', '0', '0', '0', '0', '0', '0', '0'),
    ]);

    it('acusa, com a validação literal do Guia', () => {
        const e = r.erros.filter((x: { regra: string }) => x.regra === 'm200-retencao-maior');
        expect(e).toHaveLength(1);
        expect(String(e[0].fonte)).toMatch(/igual ou menor que o valor constante no campo 5/);
    });

    // 🚨 E a AÇÃO diz onde o excedente deveria ir e que o app não o gera —
    // some calado faria a empresa PERDER o crédito de retenção.
    it('nomeia o registro 1300 e avisa que o app não o gera', () => {
        const e = r.erros.find((x: { regra: string }) => x.regra === 'm200-retencao-maior');
        expect(String(e.acao)).toMatch(/registro 1300/);
        expect(String(e.acao)).toMatch(/app NÃO gera/);
        expect(String(e.acao)).toMatch(/perde o crédito/);
    });

    it('retenção igual ao devido passa — o limite é "igual ou menor"', () => {
        const ok = conferirFechamentoDoM200([
            m200('100,00', '0', '0', '100,00', '100,00', '0', '0', '0', '0', '0', '0', '0'),
        ]);
        expect(ok.erros.filter((x: { regra: string }) => x.regra === 'm200-retencao-maior')).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 Σ M205 = o "a recolher" do M200 que eles detalham.
// ════════════════════════════════════════════════════════════════════════════
describe('📖 os M205 somam o que o M200 declara a recolher', () => {
    // Cumulativo: NUM_CAMPO 12, e o campo 12 do M200 é o "a recolher".
    it('nasce VERDE quando a soma bate', () => {
        const r = conferirSomaDosM205([
            m200('0', '0', '0', '0', '0', '0', '0', '114,40', '0', '0', '114,40', '114,40'),
            L('M205', '12', '810902', '114,40'),
        ]);
        expect(r.erros).toEqual([]);
    });

    it('acusa quando o detalhamento não soma o total', () => {
        const r = conferirSomaDosM205([
            m200('0', '0', '0', '0', '0', '0', '0', '114,40', '0', '0', '114,40', '114,40'),
            L('M205', '12', '810902', '100,00'),
        ]);
        expect(r.erros).toHaveLength(1);
        expect(r.erros[0].valor).toBe('100.00');
        expect(r.erros[0].esperado).toBe('114.40');
        expect(String(r.erros[0].acao)).toMatch(/DCTF/);
    });

    // ⚠️ O NUM_CAMPO SEPARA AS DUAS SEÇÕES: somar tudo junto compararia o
    // detalhamento do cumulativo com o total do não-cumulativo.
    it('não mistura o detalhamento das duas seções', () => {
        const r = conferirSomaDosM205([
            m200('50,00', '0', '0', '50,00', '0', '0', '50,00', '114,40', '0', '0', '114,40', '164,40'),
            L('M205', '08', '111111', '50,00'),
            L('M205', '12', '810902', '114,40'),
        ]);
        expect(r.erros).toEqual([]);
    });

    it('vários M205 do mesmo grupo somam entre si', () => {
        const r = conferirSomaDosM205([
            m200('0', '0', '0', '0', '0', '0', '0', '114,40', '0', '0', '114,40', '114,40'),
            L('M205', '12', '810902', '100,00'),
            L('M205', '12', '457401', '14,40'),
        ]);
        expect(r.erros).toEqual([]);
    });

    it('arquivo sem M205 fica MUDO — a existência dele é outra regra', () => {
        const r = conferirSomaDosM205([
            m200('0', '0', '0', '0', '0', '0', '0', '114,40', '0', '0', '114,40', '114,40'),
        ]);
        expect(r.erros).toEqual([]);
    });

    it('o M605 é conferido contra o M600', () => {
        const r = conferirSomaDosM205([
            L('M600', '0', '0', '0', '0', '0', '0', '0', '528,00', '0', '0', '528,00', '528,00'),
            L('M605', '12', '217201', '500,00'),
        ]);
        expect(r.erros).toHaveLength(1);
        expect(r.erros[0].registro).toBe('M605');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 A PROVA QUE VALE: as duas regras nascem VERDES sobre o bloco M que o
// GERADOR produz — nunca sobre linha escrita à mão.
//
// Fixture que não é o que o gerador emite é teste verde sobre defeito vivo (a
// lição do art. 136, 22/08). Aqui o bloco sai do `buildBlocoM` de verdade, com
// os números do assinado do CF BANK (06/2026).
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 nascem VERDES sobre o bloco M do gerador REAL', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildBlocoM } = require('../sefaz-backend/sped-contrib-blocos.js');
    const semQuebra = (l: string) => l.replace(/\r?\n$/, '');

    // ⚠️ A fixture é a MESMA que o teste do gerador usa (`regimeApuracao: '1'`,
    // não-cumulativo) — inventar uma aqui responderia sobre um arquivo que o
    // gerador não produz, que é teste verde sobre defeito vivo.
    const linhasDoGerador = (extra: Record<string, unknown> = {}) => buildBlocoM({
        empresa: { cnpj: '11111111000191' }, regimeApuracao: '1',
        competencia: '2026-06', competenciaFim: '2026-06',
        notas: [], receitaAplicacaoFinanceira: 21647.53,
        warnings: [] as string[], ...extra,
    }).map(semQuebra);

    it('o bloco M real não acusa fechamento nem soma do M205', () => {
        const l = linhasDoGerador();
        // guarda: se o gerador parar de emitir o M200, o teste vira vazio e
        // passaria por engano.
        expect(l.some((x: string) => x.startsWith('|M200|'))).toBe(true);
        expect(l.some((x: string) => x.startsWith('|M205|'))).toBe(true);
        expect(conferirFechamentoDoM200(l).erros).toEqual([]);
        expect(conferirSomaDosM205(l).erros).toEqual([]);
    });

    // 🚨 E A REGRA ACHOU UMA COMBINAÇÃO NÃO PROVADA no caminho: o M205 da
    // receita financeira sai com NUM_CAMPO **08** (o do regime NÃO-cumulativo,
    // provado no assinado do CF BANK). Numa apuração CUMULATIVA o valor vai
    // para o campo 12 do M200, e o detalhamento apontaria um campo ZERADO.
    // O app NÃO deduz o par código+campo do outro regime — deduzir declararia
    // o débito na receita errada da DCTF —, então a combinação sai DITA.
    it('a combinação não provada (financeira + cumulativo) é acusada e AVISADA', () => {
        const warnings: string[] = [];
        const l = buildBlocoM({
            empresa: { cnpj: '11111111000191' }, regimeApuracao: '2',
            competencia: '2026-06', competenciaFim: '2026-06',
            notas: [], receitaAplicacaoFinanceira: 21647.53, warnings,
        }).map(semQuebra);
        // a prevalidação pega o detalhamento apontando campo zerado…
        expect(conferirSomaDosM205(l).erros.length).toBeGreaterThan(0);
        // …e a geração DIZ antes, com o motivo e sem inventar código.
        expect(warnings.join(' ')).toMatch(/apuração saiu CUMULATIVA/);
        expect(warnings.join(' ')).toMatch(/não deduz o código do outro regime/);
    });

    it('empresa sem receita financeira também sai limpa', () => {
        const l = linhasDoGerador({ receitaAplicacaoFinanceira: 0 });
        expect(conferirFechamentoDoM200(l).erros).toEqual([]);
        expect(conferirSomaDosM205(l).erros).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 AS DUAS RODAM NA PREVALIDAÇÃO — regra escrita não é regra ligada.
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 as regras estão ligadas', () => {
    it('entram no agregador de avisos', () => {
        const src: string = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'sefaz-backend/sped-contrib-campos.js'), 'utf8',
        ).split('\n').filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        expect(src).toMatch(/\.\.\.conferirFechamentoDoM200\(linhas\)\.erros/);
        expect(src).toMatch(/\.\.\.conferirSomaDosM205\(linhas\)\.erros/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 OS ESTABELECIMENTOS: o 0140 é o CADASTRO e A010/C010/D010/F010 apontam.
//
// A mesma frase aparece nos quatro no Guia: *"é conferido o dígito verificador
// (DV) do CNPJ informado. O estabelecimento informado neste registro deve está
// cadastrado no Registro 0140"*. É a família do participante do 0150 e do item
// do 0200 ÓRFÃOS — as duas já custaram rodada de PVA (19/08).
// ════════════════════════════════════════════════════════════════════════════
describe('📖 estabelecimento do bloco tem de estar no 0140', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { conferirEstabelecimentosContrib } = require('../sefaz-backend/sped-contrib-campos.js');
    const CNPJ = '11222333000181';   // DV válido
    const reg0140 = (cnpj = CNPJ, codMun = '3550308') =>
        L('0140', '1', 'EMPRESA X', cnpj, 'SP', '', codMun, '', '');

    it('nasce VERDE no arquivo coerente', () => {
        const r = conferirEstabelecimentosContrib([reg0140(), L('F010', CNPJ), L('A010', CNPJ)]);
        expect(r.erros).toEqual([]);
    });

    it('CNPJ do 0140 com DV errado é acusado', () => {
        const r = conferirEstabelecimentosContrib([reg0140('11222333000199')]);
        expect(r.erros.some((e: { campo: string }) => e.campo === '4 - CNPJ')).toBe(true);
    });

    // 📖 "possuindo 7 dígitos" — o Guia diz isso sem depender da tabela IBGE.
    it('COD_MUN com menos de 7 dígitos é acusado', () => {
        const r = conferirEstabelecimentosContrib([reg0140(CNPJ, '355030')]);
        const e = r.erros.find((x: { campo: string }) => x.campo === '7 - COD_MUN');
        expect(e).toBeTruthy();
        expect(String(e.fonte)).toMatch(/possuindo 7 dígitos/);
    });

    it('bloco que abre em estabelecimento fora do 0140 é acusado', () => {
        const r = conferirEstabelecimentosContrib([reg0140(), L('F010', '99999999000191')]);
        const e = r.erros.filter((x: { regra: string }) => x.regra === 'estabelecimento-orfao');
        expect(e).toHaveLength(1);
        expect(String(e[0].fonte)).toMatch(/deve está cadastrado no Registro 0140/);
    });

    it('os quatro registros de abertura são conferidos', () => {
        const r = conferirEstabelecimentosContrib([
            reg0140(),
            L('A010', '99999999000191'), L('C010', '99999999000191'),
            L('D010', '99999999000191'), L('F010', '99999999000191'),
        ]);
        expect(r.erros.map((e: { registro: string }) => e.registro).sort())
            .toEqual(['A010', 'C010', 'D010', 'F010']);
    });

    // ⚠️ Arquivo SEM 0140 não vira "todos órfãos" — ausência não é prova, e
    // acusar quatro vezes o mesmo buraco é muro de aviso que ninguém lê.
    it('arquivo sem 0140 não acusa órfão', () => {
        const r = conferirEstabelecimentosContrib([L('F010', CNPJ)]);
        expect(r.erros).toEqual([]);
    });
});
