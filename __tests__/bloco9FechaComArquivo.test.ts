// ============================================================================
// 🚨 O BLOCO 9 É A ARITMÉTICA QUE O PVA CONFERE PRIMEIRO — e ninguém a conferia
//
// 29/08, fechando o cruzamento "registros que o gerador EMITE × registros que a
// prevalidação COBRE" no EFD ICMS/IPI: 9900, 9990 e 9999 estavam entre os
// descobertos.
//
// 📖 O Guia 3.2.3 é literal nos três:
//  · 9900 campo 03: *"verifica se o número de linhas no arquivo do tipo
//    informado no campo REG_BLC do registro 9900 é igual ao valor informado
//    neste campo"* — e *"Todos os registros referenciados neste arquivo,
//    INCLUSIVE OS POSTERIORES A ESTE REGISTRO, devem ter uma linha
//    totalizadora"*;
//  · 9990 campo 02: a quantidade de linhas do Bloco 9;
//  · 9999 campo 02: *"o número de linhas existentes no arquivo inteiro é igual
//    ao valor informado"*, e *"deve considerar também o próprio registro 9999"*.
//
// 🚨 **O RISCO É O MAIOR DE TODOS: o PVA não IMPORTA o arquivo.** Não é recusa
// de campo que se conserta e reenvia — é o arquivo inteiro barrado na porta.
// Em 24/08 (AFFITTARE) a lição ficou escrita: *"acrescentar UMA linha ao bloco
// 1 mexe em QUATRO contadores"*, e naquele dia a conferência foi feita à mão.
//
// ⚠️ E ela mora na AUDITORIA, não na prevalidação de uma família: o bloco 9 é
// MECANISMO (contagem), idêntico nos dois arquivos. É a casa da
// `linhasMalformadas`, e pelo mesmo motivo — a "meia trava" do COD_MUN (22/08).
// ============================================================================
// @ts-expect-error — módulo backend .js sem .d.ts
import { conferirBloco9, auditarSaidaSped } from '../sefaz-backend/sped-auditoria-saida.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { buildBloco9 } from '../sefaz-backend/sped-fiscal-bloco9.js';

const sq = (l: string) => l.replace(/\r?\n$/, '');
const L = (...c: (string | number)[]) => `|${c.join('|')}|`;

/** Um arquivo de verdade, montado pelo gerador do bloco 9. */
const arquivoReal = (corpo: string[]) => {
    const linhas = corpo.map(sq);
    return [...linhas, ...buildBloco9(linhas).map(sq)];
};

const CORPO = [
    L('0000', '020', '0', '01072026', '31072026', 'EMPRESA X', '11111111000191'),
    L('0001', '0'),
    L('0100', 'CONTADOR', '39053344705', '1SP1/O-5'),
    L('0990', '4'),
    L('C001', '0'),
    L('C100', '0', '1', 'F1', '55', '00', '1', '123'),
    L('C190', '000', '5102', '18,00'),
    L('C990', '4'),
];

describe('🚨 o bloco 9 do gerador REAL fecha com o arquivo', () => {
    it('nasce VERDE — nenhuma das três contas acusa', () => {
        const arq = arquivoReal(CORPO);
        expect(conferirBloco9(arq)).toEqual([]);
    });

    // 🚨 A LIÇÃO DA AFFITTARE (24/08): acrescentar UMA linha mexe em QUATRO
    // contadores. Aqui o gerador refaz as quatro — e a regra confirma.
    it('acrescentar UMA linha ao corpo continua fechando', () => {
        const arq = arquivoReal([...CORPO, L('C190', '000', '5102', '12,00')]);
        expect(conferirBloco9(arq)).toEqual([]);
    });

    // 🐛 A PRIMEIRA VERSÃO DESTE TESTE NÃO PROVAVA NADA: ela pedia que a
    // auditoria NÃO acusasse o arquivo certo — e isso é verdade também quando
    // a regra não está LIGADA. Desplugando o `conferirBloco9` do
    // `auditarSaidaSped`, o teste continuava verde.
    //
    // 📌 Ligação se prova pela POSITIVA: arquivo QUEBRADO tem de acusar. É a
    // mesma classe do "silêncio falso" que a casa persegue desde 22/08 —
    // ausência de alarme não pode ser indistinguível de "está tudo certo".
    it('a auditoria de saída roda a regra — provado com arquivo QUEBRADO', () => {
        const arq = arquivoReal(CORPO);
        const torto = arq.map((l) => (l.startsWith('|9999|') ? L('9999', '1') : l));
        const r = auditarSaidaSped(torto);
        expect(r.suspeitas.some((s: { tipo: string }) => s.tipo === 'bloco9-nao-fecha')).toBe(true);
        // e o arquivo CERTO continua mudo
        expect(auditarSaidaSped(arq).suspeitas
            .filter((s: { tipo: string }) => s.tipo === 'bloco9-nao-fecha')).toEqual([]);
    });
});

describe('🚨 e ela pega as três formas de não fechar', () => {
    const arq = arquivoReal(CORPO);

    // Uma linha some do corpo DEPOIS de o bloco 9 ter contado — é literalmente
    // o que acontece quando um bloco muda e o 9 não é refeito.
    it('9900: linha do corpo removida sem refazer o bloco 9', () => {
        const torto = arq.filter((l) => !l.startsWith('|C190|'));
        const s = conferirBloco9(torto);
        expect(s.some((x: { registro: string }) => x.registro === '9900')).toBe(true);
        expect(String(s[0].detalhe)).toMatch(/NÃO IMPORTA o arquivo/);
    });

    it('9990: contagem do bloco 9 adulterada', () => {
        const torto = arq.map((l) => (l.startsWith('|9990|') ? L('9990', '99') : l));
        const s = conferirBloco9(torto);
        expect(s.some((x: { registro: string }) => x.registro === '9990')).toBe(true);
    });

    it('9999: total do arquivo adulterado', () => {
        const torto = arq.map((l) => (l.startsWith('|9999|') ? L('9999', '1') : l));
        const s = conferirBloco9(torto);
        const e = s.find((x: { registro: string }) => x.registro === '9999');
        expect(e).toBeTruthy();
        expect(String(e.detalhe)).toMatch(/declara 1 linha/);
    });

    // 📖 "inclusive os posteriores a este registro" — o 9900 conta as próprias
    // linhas 9900, o 9990 e o 9999. É exatamente onde um contador se perde.
    it('o 9900 conta o PRÓPRIO bloco 9', () => {
        const arq2 = arquivoReal(CORPO);
        const do9900 = arq2.filter((l) => l.startsWith('|9900|'));
        const totaliza = (reg: string) => do9900.find((l) => l.split('|')[2] === reg);
        expect(totaliza('9900')).toBeTruthy();
        expect(totaliza('9990')).toBeTruthy();
        expect(totaliza('9999')).toBeTruthy();
    });
});

// ⚠️ Arquivo PARCIAL (um bloco isolado, como nos testes de gerador) não é
// arquivo errado — acusar ali seria alarme sobre recorte, e alarme sobre
// código certo é o que faz a equipe desligar a trava.
describe('⚠️ arquivo sem bloco 9 fica MUDO', () => {
    it('recorte de bloco não acusa', () => {
        expect(conferirBloco9(CORPO)).toEqual([]);
    });
    it('lista vazia não explode', () => {
        expect(conferirBloco9(null)).toEqual([]);
        expect(conferirBloco9([])).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 R31 — o 1010 concorda com o que o arquivo traz (IND_VA × 1400).
//
// O indicador e a existência do 1400 são o MESMO fato dito duas vezes, e o
// comentário do próprio gerador registra que **o PVA rejeita as duas
// combinações erradas**.
//
// ⚠️ ESTA REGRA NÃO PODE IR PARA O MÓDULO COMUM: o `1010` do
// EFD-Contribuições é OUTRO registro — Processo Referenciado (ação judicial) —,
// e foi exatamente confundi-los que fez o gerador declarar um processo
// judicial com os campos preenchidos com 'N' (MANTOAN, 17/08).
// ════════════════════════════════════════════════════════════════════════════
describe('📖 o 1010 concorda com o 1400', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prevalidarSpedFiscal } = require('../sefaz-backend/sped-prevalidacao.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildBloco1 } = require('../sefaz-backend/sped-fiscal-blocos-vazios.js');
    type Erro = { regra: string; esperado?: string; mensagem?: string };
    const so1010 = (r: { erros: Erro[] }): Erro[] =>
        r.erros.filter((e) => e.regra === '1010-x-1400');

    // 🚨 A prova é o bloco 1 do GERADOR, nas duas situações que ele produz.
    it('nasce VERDE sem DIPAM (o gerador escreve IND_VA = N)', () => {
        const linhas = buildBloco1([]).map(sq);
        expect(so1010(prevalidarSpedFiscal(linhas))).toEqual([]);
    });

    it('nasce VERDE com DIPAM (o gerador liga o IND_VA = S)', () => {
        const linhas = buildBloco1([{ codItemIpm: 'SPDIPAM11', mun: '3548906', valor: 52520 }]).map(sq);
        expect(linhas.some((l: string) => l.startsWith('|1400|'))).toBe(true);
        expect(so1010(prevalidarSpedFiscal(linhas))).toEqual([]);
    });

    it('acusa IND_VA = S sem nenhum 1400', () => {
        const linhas = [L('1010', 'N', 'N', 'N', 'N', 'S', 'N', 'N', 'N', 'N', 'N', 'N', 'N', 'N')];
        const e = so1010(prevalidarSpedFiscal(linhas));
        expect(e).toHaveLength(1);
        expect(e[0].esperado).toBe('N');
    });

    it('acusa 1400 com IND_VA = N', () => {
        const linhas = [
            L('1010', 'N', 'N', 'N', 'N', 'N', 'N', 'N', 'N', 'N', 'N', 'N', 'N', 'N'),
            L('1400', 'SPDIPAM11', '3548906', '52520,00'),
        ];
        const e = so1010(prevalidarSpedFiscal(linhas));
        expect(e).toHaveLength(1);
        expect(String(e[0].mensagem)).toMatch(/1 registro\(s\) 1400/);
    });

    it('arquivo sem 1010 fica MUDO', () => {
        expect(so1010(prevalidarSpedFiscal([L('0000', '020')]))).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 R32 — o período do E100 cabe no período do arquivo.
//
// O E100 é o PAI do E110, e uma apuração declarada com data fora do arquivo põe
// o imposto no MÊS ERRADO. Ninguém confere data de apuração a olho — é a mesma
// classe do período do 0000 (26/08), que é o campo mais caro do arquivo.
// ════════════════════════════════════════════════════════════════════════════
describe('📖 o E100 cabe no período do arquivo', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prevalidarSpedFiscal } = require('../sefaz-backend/sped-prevalidacao.js');
    const REG0000 = L('0000', '020', '0', '01072026', '31072026', 'EMPRESA X', '11111111000191');
    const soE100 = (r: { erros: Array<{ regra: string; mensagem?: string }> }) =>
        r.erros.filter((e) => e.regra === 'e100-periodo');

    it('nasce VERDE no mês fechado', () => {
        expect(soE100(prevalidarSpedFiscal([REG0000, L('E100', '01072026', '31072026')]))).toEqual([]);
    });

    // 🚨 A PROVA QUE VALE É SOBRE O GERADOR REAL — linha escrita à mão prova o
    // teste, não o arquivo. É a lição do C100 que saía com modelo 55 e chave 65
    // por meses: a conferência auditava a INTENÇÃO, não o que ia sair.
    it('nasce VERDE sobre o E100 do gerador REAL', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { buildBlocoE } = require('../sefaz-backend/sped-fiscal-blocoE.js');
        const bloco = buildBlocoE({
            competenciaInicio: '2026-07', competenciaFim: '2026-07',
            empresa: { cnpj: '11111111000191', _regime: 'lucro', dadosFiscais: { uf: 'SP' } },
            notas: [], ajustesApuracao: [], warnings: [] as string[],
        }).map(sq);
        const e100 = bloco.filter((l: string) => l.startsWith('|E100|'));
        expect(e100).toHaveLength(1);
        expect(soE100(prevalidarSpedFiscal([REG0000, ...e100]))).toEqual([]);
    });

    it('acusa apuração fora do período do arquivo', () => {
        const e = soE100(prevalidarSpedFiscal([REG0000, L('E100', '01062026', '30062026')]));
        expect(e).toHaveLength(1);
        expect(String(e[0].mensagem)).toMatch(/fora do período do arquivo/);
    });

    it('acusa período invertido', () => {
        const e = soE100(prevalidarSpedFiscal([REG0000, L('E100', '31072026', '01072026')]));
        expect(e.some((x) => String(x.mensagem).match(/encerra antes/))).toBe(true);
    });

    it('acusa dois E100 com o mesmo período', () => {
        const e = soE100(prevalidarSpedFiscal([
            REG0000, L('E100', '01072026', '31072026'), L('E100', '01072026', '31072026'),
        ]));
        expect(e.some((x) => String(x.mensagem).match(/mesmo período/))).toBe(true);
    });

    // ⚠️ Apuração QUINZENAL (dois períodos distintos dentro do mês) é legítima
    // — acusá-la seria alarme sobre arquivo correto.
    it('dois períodos distintos dentro do mês NÃO acusam', () => {
        expect(soE100(prevalidarSpedFiscal([
            REG0000, L('E100', '01072026', '15072026'), L('E100', '16072026', '31072026'),
        ]))).toEqual([]);
    });

    it('arquivo sem E100 fica MUDO', () => {
        expect(soE100(prevalidarSpedFiscal([REG0000]))).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 R33 — o D100 bate com os D190 filhos.
//
// 🚨 É EXATAMENTE a classe que custou um dia da PWR (20/08) no par C100 × C190:
// o PAI lê os totais do documento e o FILHO agrega os itens — duas fontes, dois
// passos do gerador. E o PVA **não recusa**: ele só imprime um total menor.
// ════════════════════════════════════════════════════════════════════════════
describe('📖 o D100 bate com os D190', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prevalidarSpedFiscal } = require('../sefaz-backend/sped-prevalidacao.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildBlocoD } = require('../sefaz-backend/sped-fiscal-blocoD.js');
    const REG0000 = L('0000', '020', '0', '01072026', '31072026', 'EMPRESA X', '11111111000191');
    const soD = (r: { erros: Array<{ regra: string; campo?: string; mensagem?: string }> }) =>
        r.erros.filter((e) => e.regra === 'd100-x-d190');

    // 🐛 A PRIMEIRA VERSÃO DESTE TESTE USAVA UMA LINHA ESCRITA À MÃO — e eu
    // carreguei as posições do C100 para o D100. O C100 tem 29 campos e o D100
    // tem 23: o par VL_BC_ICMS/VL_ICMS não cai no mesmo lugar. É exatamente a
    // razão pela qual o A100 e o D100 ficam de fora das regras comuns do C100
    // (26/08) — **a posição é PARÂMETRO, nunca dedução do vizinho**.
    //
    // Por isso o bloco D aqui sai do GERADOR.
    const blocoD = (over: Record<string, unknown> = {}) => buildBlocoD({
        notas: [{
            tipo: 'cte', modelo: '57', chave: '', numero: '9', serie: '1', direcao: 'entrada',
            status: 'autorizado', dhEmi: '2026-07-10', cnpjEmit: '22222222000191', xNomeEmit: 'TRANSP',
            empresaCnpj: '11111111000191', cfop: '1352', cst: '000',
            totais: { vTPrest: 1000, vBC: 1000, vICMS: 180, aliqICMS: 18 },
            valorTotal: 1000, ...over,
        }],
        empresa: { cnpj: '11111111000191' },
        competenciaInicio: '2026-07', competenciaFim: '2026-07', warnings: [] as string[],
    }).map(sq);

    it('nasce VERDE sobre o bloco D do gerador REAL', () => {
        const linhas = blocoD();
        // guarda: sem D100/D190 o teste passaria por vazio
        expect(linhas.some((l: string) => l.startsWith('|D100|'))).toBe(true);
        expect(linhas.some((l: string) => l.startsWith('|D190|'))).toBe(true);
        expect(soD(prevalidarSpedFiscal([REG0000, ...linhas]))).toEqual([]);
    });

    it('acusa a base do pai adulterada', () => {
        const linhas = blocoD().map((l: string) => (l.startsWith('|D100|')
            ? l.replace('|1000,00|180,00|', '|900,00|180,00|') : l));
        const e = soD(prevalidarSpedFiscal([REG0000, ...linhas]));
        expect(e.some((x) => String(x.campo).includes('VL_BC_ICMS'))).toBe(true);
    });

    it('acusa o ICMS do pai adulterado', () => {
        const linhas = blocoD().map((l: string) => (l.startsWith('|D100|')
            ? l.replace('|1000,00|180,00|', '|1000,00|150,00|') : l));
        const e = soD(prevalidarSpedFiscal([REG0000, ...linhas]));
        expect(e.some((x) => String(x.campo).includes('VL_ICMS'))).toBe(true);
    });

    // ⚠️ Vários D190 do mesmo D100 SOMAM — o registro agrega por CST/CFOP/
    // alíquota, então comparar linha a linha acusaria arquivo correto.
    //
    // ⚠️ E a ORDEM importa: o filho pertence ao pai que o antecede, então as
    // duas linhas entram NO LUGAR da original. Jogá-las no fim do array as
    // deixaria depois do D990 — órfãs —, e o teste passaria por o pai não ter
    // filho nenhum, que é passar pelo motivo errado.
    it('dois D190 do mesmo documento somam', () => {
        const linhas = blocoD();
        const i = linhas.findIndex((l: string) => l.startsWith('|D190|'));
        const d190 = linhas[i];
        const comDuas = [...linhas];
        comDuas.splice(i, 1,
            d190.replace('|1000,00|1000,00|180,00|', '|600,00|600,00|108,00|'),
            d190.replace('|1000,00|1000,00|180,00|', '|400,00|400,00|72,00|'));
        expect(soD(prevalidarSpedFiscal([REG0000, ...comDuas]))).toEqual([]);
    });

    // 🚨 O CASO QUE A 1ª VERSÃO DESTA REGRA ERRAVA, e ele é o COMUM: com dois
    // conhecimentos no mês, ela comparava a base do PRIMEIRO D100 contra a soma
    // de TODOS os D190 do arquivo — e acusava um arquivo CERTO. Alarme sobre
    // código certo é o que faz a equipe desligar a prevalidação.
    it('dois CT-e no mesmo arquivo NÃO se somam entre si', () => {
        const bloco = buildBlocoD({
            notas: [
                {
                    tipo: 'cte', modelo: '57', numero: '9', serie: '1', direcao: 'entrada',
                    status: 'autorizado', dhEmi: '2026-07-10', cnpjEmit: '22222222000191',
                    xNomeEmit: 'TRANSP A', empresaCnpj: '11111111000191', cfop: '1352', cst: '000',
                    totais: { vTPrest: 1000, vBC: 1000, vICMS: 180 }, valorTotal: 1000,
                },
                {
                    tipo: 'cte', modelo: '57', numero: '10', serie: '1', direcao: 'entrada',
                    status: 'autorizado', dhEmi: '2026-07-11', cnpjEmit: '33333333000191',
                    xNomeEmit: 'TRANSP B', empresaCnpj: '11111111000191', cfop: '1352', cst: '000',
                    totais: { vTPrest: 500, vBC: 500, vICMS: 90 }, valorTotal: 500,
                },
            ],
            empresa: { cnpj: '11111111000191' },
            competenciaInicio: '2026-07', competenciaFim: '2026-07', warnings: [] as string[],
        }).map(sq);
        expect(bloco.filter((l: string) => l.startsWith('|D100|'))).toHaveLength(2);
        expect(soD(prevalidarSpedFiscal([REG0000, ...bloco]))).toEqual([]);
    });

    it('e com dois CT-e, acusa o documento CERTO', () => {
        const bloco = buildBlocoD({
            notas: [
                {
                    tipo: 'cte', modelo: '57', numero: '9', serie: '1', direcao: 'entrada',
                    status: 'autorizado', dhEmi: '2026-07-10', cnpjEmit: '22222222000191',
                    xNomeEmit: 'TRANSP A', empresaCnpj: '11111111000191', cfop: '1352', cst: '000',
                    totais: { vTPrest: 1000, vBC: 1000, vICMS: 180 }, valorTotal: 1000,
                },
                {
                    tipo: 'cte', modelo: '57', numero: '10', serie: '1', direcao: 'entrada',
                    status: 'autorizado', dhEmi: '2026-07-11', cnpjEmit: '33333333000191',
                    xNomeEmit: 'TRANSP B', empresaCnpj: '11111111000191', cfop: '1352', cst: '000',
                    totais: { vTPrest: 500, vBC: 500, vICMS: 90 }, valorTotal: 500,
                },
            ],
            empresa: { cnpj: '11111111000191' },
            competenciaInicio: '2026-07', competenciaFim: '2026-07', warnings: [] as string[],
        }).map(sq).map((l: string) => (l.startsWith('|D100|') && l.includes('|10|')
            ? l.replace('|500,00|90,00|', '|400,00|90,00|') : l));
        const e = soD(prevalidarSpedFiscal([REG0000, ...bloco]));
        expect(e).toHaveLength(1);
        expect(String(e[0].mensagem)).toMatch(/CT-e nº 10/);
    });

    it('arquivo sem bloco D fica MUDO', () => {
        expect(soD(prevalidarSpedFiscal([REG0000]))).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 R34 — o G110 (CIAP) fecha consigo mesmo.
//
// O Guia 3.2.3 escreve as três contas POR EXTENSO no próprio registro, e o
// número que sai dele **vira ajuste de apuração**: um G110 que não fecha
// credita ICMS a mais ou a menos, e o PVA aceita.
//
// 🚨 E o caminho até aqui achou um DEFEITO VIVO no gerador: o bloco G montava
// as linhas à mão (`[...].join('|')`), sem o `|` inicial e sem o `\r\n` — e o
// orquestrador junta os blocos com `join('')`, então G001, G110, G125 e G990
// saíam **grudados numa linha só**, colados na cauda do bloco E. É o caso
// REALITY de 21/08 vivo no bloco G, e ele nunca tinha aparecido porque a ÚNICA
// empresa com CIAP (EXPERTE) está bloqueada na captura.
// ════════════════════════════════════════════════════════════════════════════
describe('📖 o G110 do CIAP fecha consigo mesmo', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prevalidarSpedFiscal } = require('../sefaz-backend/sped-prevalidacao.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { montarLinhasBlocoG, apurarCiap } = require('../sefaz-backend/sped-bloco-g.js');
    const REG0000 = L('0000', '020', '0', '01062026', '30062026', 'EMPRESA X', '11111111000191');
    type ErroG = { regra: string; campo?: string; mensagem?: string };
    const soG = (r: { erros: ErroG[] }): ErroG[] => r.erros.filter((e) => e.regra === 'g110-nao-fecha');

    // Os números REAIS do relatório do PVA da EXPERTE (06/2026): Σ parcelas
    // 527,53 × índice 0,86032111 = 453,85.
    const BEM = (codigo: string, credito: number, parcela: number) => ({
        codigo, descricao: codigo, tipo: 'bem', dataMovimentacao: '2026-06-01',
        tipoMovimentacao: 'SI', creditoIcmsProprio: credito, creditoIcmsSt: 0,
        creditoIcmsFrete: 0, creditoIcmsDifal: 0, numeroParcela: parcela,
    });
    const blocoG = () => montarLinhasBlocoG({
        apuracao: apurarCiap({
            bens: [BEM('CHAPAS', 955.50, 12), BEM('FRESA', 7778.06, 12),
                BEM('RETIFICADORA', 13200.30, 35), BEM('ROLAMENTOS', 3387.47, 10)],
            saldoInicial: 25321.33, saidasTributadas: 425472.59, saidasTotais: 494550.91,
        }),
        dtIni: '2026-06-01', dtFin: '2026-06-30',
    }).map(sq);

    it('nasce VERDE sobre o bloco G do gerador REAL (números do PVA da EXPERTE)', () => {
        const linhas = blocoG();
        // guarda: sem G110/G125 o teste passaria por vazio
        expect(linhas.some((l: string) => l.startsWith('|G110|'))).toBe(true);
        expect(linhas.filter((l: string) => l.startsWith('|G125|'))).toHaveLength(4);
        expect(soG(prevalidarSpedFiscal([REG0000, ...linhas]))).toEqual([]);
    });

    it('acusa Σ das parcelas que não bate com os G125', () => {
        const linhas = blocoG().map((l: string) => (l.startsWith('|G110|')
            ? l.replace('|527,53|425472,59|', '|600,00|425472,59|') : l));
        const e = soG(prevalidarSpedFiscal([REG0000, ...linhas]));
        expect(e.some((x) => String(x.campo).includes('SOM_PARC'))).toBe(true);
    });

    it('acusa saída tributada MAIOR que o total', () => {
        const linhas = blocoG().map((l: string) => (l.startsWith('|G110|')
            ? l.replace('|425472,59|494550,91|', '|500000,00|494550,91|') : l));
        const e = soG(prevalidarSpedFiscal([REG0000, ...linhas]));
        expect(e.some((x) => String(x.campo).includes('VL_TRIB_EXP'))).toBe(true);
    });

    it('acusa índice que não é a divisão declarada', () => {
        const linhas = blocoG().map((l: string) => (l.startsWith('|G110|')
            ? l.replace('|0,86032111|', '|0,50000000|') : l));
        const e = soG(prevalidarSpedFiscal([REG0000, ...linhas]));
        expect(e.some((x) => String(x.campo).includes('IND_PER_SAI'))).toBe(true);
    });

    // 🚨 O campo mais caro: é ele que vira crédito na apuração.
    it('acusa crédito apropriado que não é Σ parcelas × índice', () => {
        const linhas = blocoG().map((l: string) => (l.startsWith('|G110|')
            ? l.replace('|453,85|', '|527,53|') : l));
        const e = soG(prevalidarSpedFiscal([REG0000, ...linhas]));
        expect(e.some((x) => String(x.campo).includes('ICMS_APROP'))).toBe(true);
    });

    // ⚠️ Mês SEM saída não acusa índice: total zero é fato (a empresa não
    // vendeu), e dividir ali seria o app inventando a conta.
    it('mês sem saída nenhuma NÃO acusa o índice', () => {
        const vazio = montarLinhasBlocoG({
            apuracao: apurarCiap({
                bens: [BEM('CHAPAS', 955.50, 12)],
                saldoInicial: 0, saidasTributadas: 0, saidasTotais: 0,
            }),
            dtIni: '2026-06-01', dtFin: '2026-06-30',
        }).map(sq);
        expect(soG(prevalidarSpedFiscal([REG0000, ...vazio]))).toEqual([]);
    });

    it('arquivo sem bloco G fica MUDO', () => {
        expect(soG(prevalidarSpedFiscal([REG0000]))).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 R35 — bloco K com dados exige o K010.
//
// O K010 declara o LEIAUTE escolhido (Ajuste SINIEF 02/09), e é ele que diz ao
// PVA quais registros cobrar. ⚠️ O gerador de hoje NÃO produz esta recusa: sem
// o leiaute cadastrado o bloco sai `K001|1` (SEM DADOS) e GRITA. A regra nasce
// VERDE — ela existe para o dia em que alguém montar o K001|0 por outro
// caminho.
// ════════════════════════════════════════════════════════════════════════════
describe('📖 o bloco K com dados traz o K010', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prevalidarSpedFiscal } = require('../sefaz-backend/sped-prevalidacao.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { montarBlocoK } = require('../sefaz-backend/sped-bloco-k.js');
    const REG0000 = L('0000', '020', '0', '01072026', '31072026', 'EMPRESA X', '11111111000191');
    const soK = (r: { erros: Array<{ regra: string }> }) =>
        r.erros.filter((e) => e.regra === 'k010-ausente');

    it('nasce VERDE: sem apontamento o gerador sai K001|1, não K001|0 sem K010', () => {
        const campos = montarBlocoK({ empresa: {}, apontamento: null, dtFin: '31072026' });
        const linhas = (campos.linhas || campos).map((c: string[]) => L(...c));
        expect(linhas[0]).toBe('|K001|1|');
        expect(soK(prevalidarSpedFiscal([REG0000, ...linhas]))).toEqual([]);
    });

    it('acusa K001 com dados e sem K010', () => {
        const e = soK(prevalidarSpedFiscal([REG0000, L('K001', '0'), L('K100', '01072026', '31072026')]));
        expect(e).toHaveLength(1);
    });

    it('com K010 não acusa', () => {
        expect(soK(prevalidarSpedFiscal([
            REG0000, L('K001', '0'), L('K010', '1'), L('K100', '01072026', '31072026'),
        ]))).toEqual([]);
    });

    it('bloco K SEM DADOS fica MUDO', () => {
        expect(soK(prevalidarSpedFiscal([REG0000, L('K001', '1')]))).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 R36 — o bem do G125 está cadastrado no 0300.
//
// 🚨 Até 29/08 o app emitia o G125 e NENHUM 0300: TODO bem do CIAP saía órfão.
// É a família do item órfão do 0200 (PWR, 19/08) e do participante órfão do
// 0150 — o registro referencia um cadastro que o arquivo não declara.
// ════════════════════════════════════════════════════════════════════════════
describe('📖 o bem do G125 está cadastrado no 0300', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prevalidarSpedFiscal } = require('../sefaz-backend/sped-prevalidacao.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { montarLinhasBlocoG, montarRegistros0300, apurarCiap } = require('../sefaz-backend/sped-bloco-g.js');
    const REG0000 = L('0000', '020', '0', '01062026', '30062026', 'EMPRESA X', '11111111000191');
    const soO = (r: { erros: Array<{ regra: string; mensagem?: string }> }) =>
        r.erros.filter((e) => e.regra === 'g125-bem-orfao');

    const BENS = [
        { codigo: 'FRESA', descricao: 'FRESA', tipo: 'bem', contaContabil: '1231001',
            dataMovimentacao: '2026-06-01', tipoMovimentacao: 'SI', numeroParcela: 12,
            creditoIcmsProprio: 7778.06, creditoIcmsSt: 0, creditoIcmsFrete: 0, creditoIcmsDifal: 0 },
    ];
    const blocoG = () => montarLinhasBlocoG({
        apuracao: apurarCiap({ bens: BENS, saldoInicial: 0, saidasTributadas: 100, saidasTotais: 100 }),
        dtIni: '2026-06-01', dtFin: '2026-06-30',
    }).map(sq);

    // 🚨 A PROVA QUE VALE: o 0300 do dono + o G125 do dono, juntos, sem órfão.
    it('nasce VERDE com o 0300 que o bloco 0 passou a emitir', () => {
        const cadastro = montarRegistros0300(BENS).linhas.map(sq);
        const g = blocoG();
        expect(cadastro).toHaveLength(1);
        expect(g.some((l: string) => l.startsWith('|G125|'))).toBe(true);
        expect(soO(prevalidarSpedFiscal([REG0000, ...cadastro, ...g]))).toEqual([]);
    });

    // 🔴 É EXATAMENTE o que o app fazia antes: G125 sem nenhum 0300.
    it('acusa o bem do G125 sem 0300 — o estado de antes de 29/08', () => {
        const e = soO(prevalidarSpedFiscal([REG0000, ...blocoG()]));
        expect(e).toHaveLength(1);
        expect(String(e[0].mensagem)).toMatch(/FRESA/);
    });

    it('acusa quando o 0300 é de OUTRO bem', () => {
        const outro = montarRegistros0300([{ codigo: 'TORNO', descricao: 'TORNO', tipo: 'bem' }]).linhas.map(sq);
        expect(soO(prevalidarSpedFiscal([REG0000, ...outro, ...blocoG()]))).toHaveLength(1);
    });

    it('arquivo sem bloco G fica MUDO', () => {
        expect(soO(prevalidarSpedFiscal([REG0000]))).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 A LIGAÇÃO SE PROVA PELA POSITIVA — o bloco 0 emite o 0300 do CIAP.
//
// Um teste que pedisse "o bloco 0 não acusa nada" passaria com a chamada
// DESPLUGADA. É a lição do `conferirBloco9`: ausência de alarme não pode ser
// indistinguível de "está ligado".
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 o bloco 0 emite o 0300 quando a empresa tem CIAP', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildBloco0 } = require('../sefaz-backend/sped-fiscal-bloco0.js');
    const base = (extra: Record<string, unknown> = {}) => ({
        empresa: { cnpj: '11111111000191', razaoSocial: 'EMPRESA X', dadosFiscais: { uf: 'SP' } },
        competenciaInicio: '2026-06', competenciaFim: '2026-06',
        participantes: [], unidades: [], itens: [], warnings: [] as string[], ...extra,
    });

    it('com CIAP, o 0300 do bem sai no bloco 0', () => {
        const dados = base({
            ciap: { bens: [{ codigo: 'FRESA', descricao: 'FRESA', tipo: 'bem', contaContabil: '1231001' }] },
        });
        const linhas = buildBloco0(dados).map(sq);
        expect(linhas.filter((l: string) => l.startsWith('|0300|'))).toEqual([
            '|0300|FRESA|1|FRESA||1231001|48|',
        ]);
    });

    // ⚠️ O 0990 conta as linhas do bloco INCLUSIVE ele mesmo — acrescentar o
    // 0300 mexe nesse contador, e é a lição da AFFITTARE (24/08).
    it('e o 0990 continua contando as linhas certas', () => {
        const linhas = buildBloco0(base({
            ciap: { bens: [{ codigo: 'A', descricao: 'A', tipo: 'bem' }] },
        })).map(sq);
        expect(linhas[linhas.length - 1]).toBe(`|0990|${linhas.length}|`);
    });

    it('sem CIAP (o caso da maioria) não sai 0300 nenhum', () => {
        const linhas = buildBloco0(base()).map(sq);
        expect(linhas.filter((l: string) => l.startsWith('|0300|'))).toEqual([]);
    });

    // 🚨 A falta da conta contábil vai DITA na geração — o app não a inventa.
    it('a falta da conta contábil entra nos warnings da geração', () => {
        const dados = base({ ciap: { bens: [{ codigo: 'A', descricao: 'A', tipo: 'bem' }] } });
        buildBloco0(dados);
        expect((dados.warnings as string[]).join(' ')).toMatch(/COD_CTA sai VAZIO/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 R37 — os ajustes do E110 batem com os E111 filhos.
//
// O Guia 3.2.3 diz POR EXTENSO de onde cada campo vem, separando pelo **4º
// caractere** do COD_AJ_APUR (com o 3º = '0', que é o ajuste da APURAÇÃO):
// campo 04 ← '0' · 05 ← '1' · 08 ← '2' · 09 ← '3'.
//
// 🚨 É a MESMA classe do E110 campo 11 (02/08): cada total, isolado, está
// certo; o que não fecha é a EXPRESSÃO — e é a apuração que vira a GUIA. A R17
// confere o E110 consigo mesmo; esta confere contra os FILHOS, que é onde o
// gerador monta o número num passo diferente.
// ════════════════════════════════════════════════════════════════════════════
describe('📖 os ajustes do E110 batem com os E111', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prevalidarSpedFiscal } = require('../sefaz-backend/sped-prevalidacao.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildBlocoE } = require('../sefaz-backend/sped-fiscal-blocoE.js');
    const REG0000 = L('0000', '020', '0', '01072026', '31072026', 'EMPRESA X', '11111111000191');
    type ErroE = { regra: string; campo?: string; mensagem?: string };
    const so111 = (r: { erros: ErroE[] }): ErroE[] => r.erros.filter((e) => e.regra === 'e110-x-e111');

    // Os quatro tipos que o E110 separa, um de cada, com o código real da
    // tabela 5.1.1 de SP (UF + 6 dígitos; 3º = '0' = apuração própria).
    //
    // 🐛 E A PRIMEIRA VERSÃO DESTAS FIXTURES ESTAVA ERRADA — pelo MESMO vício
    // que este PR já corrigiu no D100: **eu contei o caractere errado.** O
    // código é `UF + 6 dígitos`, então o "3º caractere" é o 1º DÍGITO e o "4º"
    // é o 2º dígito — `SP001002` tem 4º caractere '0', não '1'. Os quatro
    // ajustes caíram todos no campo 04 e a regra concordou (nasce verde), que
    // é o certo: **quem estava errado era a fixture.** Posição se lê contando,
    // nunca de olho.
    const AJUSTES = [
        { codigo: 'SP000001', descricao: 'outros débitos', valor: 100 },      // 3º '0' · 4º '0'
        { codigo: 'SP010002', descricao: 'estorno de crédito', valor: 50 },   // 3º '0' · 4º '1'
        { codigo: 'SP020003', descricao: 'outros créditos', valor: 30 },      // 3º '0' · 4º '2'
        { codigo: 'SP030004', descricao: 'estorno de débito', valor: 20 },    // 3º '0' · 4º '3'
    ];
    const blocoE = () => buildBlocoE({
        competenciaInicio: '2026-07', competenciaFim: '2026-07',
        empresa: { cnpj: '11111111000191', _regime: 'lucro', dadosFiscais: { uf: 'SP' } },
        notas: [], ajustesApuracao: AJUSTES, warnings: [] as string[],
    }).map(sq);

    it('nasce VERDE sobre o bloco E do gerador REAL, com os 4 tipos de ajuste', () => {
        const linhas = blocoE();
        // guarda: sem E111 o teste passaria por vazio
        expect(linhas.filter((l: string) => l.startsWith('|E111|'))).toHaveLength(4);
        expect(so111(prevalidarSpedFiscal([REG0000, ...linhas]))).toEqual([]);
    });

    it('acusa o total de ajuste a débito adulterado', () => {
        const linhas = blocoE().map((l: string) => (l.startsWith('|E110|')
            ? l.replace('|100,00|', '|999,00|') : l));
        const e = so111(prevalidarSpedFiscal([REG0000, ...linhas]));
        expect(e.some((x) => String(x.campo).includes('VL_TOT_AJ_DEBITOS'))).toBe(true);
    });

    it('acusa o estorno de crédito adulterado', () => {
        const linhas = blocoE().map((l: string) => (l.startsWith('|E110|')
            ? l.replace('|50,00|', '|55,00|') : l));
        const e = so111(prevalidarSpedFiscal([REG0000, ...linhas]));
        expect(e.some((x) => String(x.campo).includes('VL_ESTORNOS_CRED'))).toBe(true);
    });

    // ⚠️ O 3º caractere separa a apuração PRÓPRIA (E111) da ST (E220): um
    // código de ST no meio não pode ser somado no E110, e a lista `validos` do
    // dono já o manda para o outro registro.
    it('ajuste de ST (3º caractere 1) não entra na conta do E110', () => {
        const comSt = buildBlocoE({
            competenciaInicio: '2026-07', competenciaFim: '2026-07',
            empresa: { cnpj: '11111111000191', _regime: 'lucro', dadosFiscais: { uf: 'SP' } },
            notas: [],
            ajustesApuracao: [...AJUSTES, { codigo: 'SP100005', descricao: 'ST', valor: 700 }],
            warnings: [] as string[],
        }).map(sq);
        expect(so111(prevalidarSpedFiscal([REG0000, ...comSt]))).toEqual([]);
    });

    it('arquivo sem E110 fica MUDO', () => {
        expect(so111(prevalidarSpedFiscal([REG0000]))).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 R38 — os campos 03/07 do E110 vêm dos C197.
//
// 🚨 Esta regra NOMEIA uma premissa do app que o Guia contraria. O gerador do
// DIFAL escreve, no próprio aviso, *"o DÉBITO na apuração não vem do C197 —
// lance o ajuste correspondente na aba Ajustes E111"*, e crava os campos 03/07
// em ZERO. O Guia diz que eles são a Σ dos C197. O app NÃO escolhe qual das
// duas: o COD_AJ é ESTADUAL e é ele que decide — a regra diz as DUAS saídas.
// ════════════════════════════════════════════════════════════════════════════
describe('📖 os campos 03/07 do E110 vêm dos C197', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prevalidarSpedFiscal } = require('../sefaz-backend/sped-prevalidacao.js');
    const REG0000 = L('0000', '020', '0', '01072026', '31072026', 'EMPRESA X', '11111111000191');
    // |E110|02..|03 VL_AJ_DEBITOS|04|05|06|07 VL_AJ_CREDITOS|08|09|10|11|12|13|14|15|
    const e110 = (ajDeb = '0,00', ajCred = '0,00') => L('E110',
        '0,00', ajDeb, '0,00', '0,00', '0,00', ajCred, '0,00', '0,00',
        '0,00', '0,00', '0,00', '0,00', '0,00', '0,00');
    // |C197|COD_AJ|DESCR|COD_ITEM|VL_BC|ALIQ|VL_ICMS|VL_OUTROS|
    const c197 = (cod: string, vl: string) =>
        L('C197', cod, 'DIFAL', '', '1000,00', '18,00', vl, '0,00');
    const so197 = (r: { erros: Array<{ regra: string; campo?: string; acao?: string }> }) =>
        r.erros.filter((e) => e.regra === 'e110-x-c197');

    // 🚨 O ESTADO DE HOJE: o app emite o C197 e crava o campo 03 em zero.
    it('acusa o C197 de DÉBITO com o campo 03 zerado — a premissa que o Guia contraria', () => {
        const e = so197(prevalidarSpedFiscal([REG0000, c197('SP300000', '60,00'), e110()]));
        expect(e).toHaveLength(1);
        expect(String(e[0].campo)).toContain('VL_AJ_DEBITOS');
        // A ação DIZ as duas saídas e proíbe deduzir.
        expect(String(e[0].acao)).toMatch(/DUAS vezes/);
        expect(String(e[0].acao)).toMatch(/Não deduza/);
    });

    it('com o campo 03 somando os C197, não acusa', () => {
        expect(so197(prevalidarSpedFiscal([REG0000, c197('SP300000', '60,00'), e110('60,00')]))).toEqual([]);
    });

    it('C197 de CRÉDITO cai no campo 07', () => {
        const e = so197(prevalidarSpedFiscal([REG0000, c197('SP000000', '40,00'), e110()]));
        expect(String(e[0].campo)).toContain('VL_AJ_CREDITOS');
    });

    // ⚠️ O 4º caractere fora da lista do Guia ('0' ou '3'..'8') não entra na
    // soma — somá-lo inventaria divergência sobre arquivo correto.
    it('4º caractere fora da lista do Guia não entra na soma', () => {
        expect(so197(prevalidarSpedFiscal([REG0000, c197('SP310000', '60,00'), e110()]))).toEqual([]);
    });

    // ⚠️ E o caso COMUM da carteira: sem C197 nenhum, a regra fica MUDA — é o
    // que faz ela servir, porque hoje quase ninguém cadastrou o COD_AJ.
    it('arquivo sem C197 fica MUDO', () => {
        expect(so197(prevalidarSpedFiscal([REG0000, e110()]))).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 R39 — os ajustes do E210 (ST) batem com os E220 filhos.
//
// 🚨 Até 29/08 o gerador punha os ajustes do E220 nos campos 07 e 10 — os do
// DOCUMENTO FISCAL (C197) —, deixando 06 e 09 zerados com os E220 logo abaixo.
// O SALDO fechava; o campo é que mentia. É o E110 campo 11 (02/08) e o IPI em
// E200/E210 (04/08) de novo.
//
// ⚠️ O PAREAMENTO É PELA SEQUÊNCIA: a apuração de ST é POR UF e o arquivo tem
// um E200/E210 por estado — cada UF aqui é uma GNRE. Somar todos os E220
// contra o primeiro E210 acusaria arquivo CERTO (a lição do D100 × D190).
// ════════════════════════════════════════════════════════════════════════════
describe('📖 os ajustes do E210 (ST) batem com os E220', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prevalidarSpedFiscal } = require('../sefaz-backend/sped-prevalidacao.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildBlocoE } = require('../sefaz-backend/sped-fiscal-blocoE.js');
    const REG0000 = L('0000', '020', '0', '01072026', '31072026', 'EMPRESA X', '11111111000191');
    type ErroSt = { regra: string; campo?: string; mensagem?: string };
    const so220 = (r: { erros: ErroSt[] }): ErroSt[] => r.erros.filter((e) => e.regra === 'e210-x-e220');

    // Duas UFs: SP (a da empresa, que recebe os ajustes) e MG (só retenção).
    const blocoE = () => buildBlocoE({
        competenciaInicio: '2026-07', competenciaFim: '2026-07',
        empresa: { cnpj: '11111111000191', _regime: 'lucro', dadosFiscais: { uf: 'SP' } },
        notas: [
            { direcao: 'saida', status: 'autorizado', ufDest: 'SP', totais: { vST: 1000 } },
            { direcao: 'saida', status: 'autorizado', ufDest: 'MG', totais: { vST: 500 } },
        ],
        ajustesApuracao: [
            { codigo: 'SP100001', descricao: 'outros débitos ST', valor: 100 },
            { codigo: 'SP120002', descricao: 'outros créditos ST', valor: 30 },
        ],
        warnings: [] as string[],
    }).map(sq);

    it('nasce VERDE sobre o bloco E do gerador REAL, com ST em duas UFs', () => {
        const linhas = blocoE();
        // guardas: sem E210/E220 o teste passaria por vazio
        expect(linhas.filter((l: string) => l.startsWith('|E210|'))).toHaveLength(2);
        expect(linhas.filter((l: string) => l.startsWith('|E220|'))).toHaveLength(2);
        expect(so220(prevalidarSpedFiscal([REG0000, ...linhas]))).toEqual([]);
    });

    // 🔴 É EXATAMENTE o que o app fazia antes: o ajuste no campo do C197 e o
    // campo do E220 zerado.
    it('acusa o "outros débitos ST" zerado com E220 de débito no arquivo', () => {
        const linhas = blocoE().map((l: string) => (l.startsWith('|E210|') && l.includes('|1000,00|')
            ? l.replace('|1000,00|100,00|0,00|', '|1000,00|0,00|100,00|') : l));
        const e = so220(prevalidarSpedFiscal([REG0000, ...linhas]));
        expect(e).toHaveLength(1);
        expect(String(e[0].campo)).toContain('VL_OUT_DEB_ST');
    });

    // ⚠️ O campo 06 é um PISO — o Guia soma ao E220 o ICMS-ST dos C190 de
    // entrada —, então MAIOR não acusa; só MENOR.
    it('o campo 06 é PISO: maior que os E220 não acusa, menor acusa', () => {
        const maior = blocoE().map((l: string) => (l.startsWith('|E210|') && l.includes('|1000,00|')
            ? l.replace('|30,00|', '|80,00|') : l));
        expect(so220(prevalidarSpedFiscal([REG0000, ...maior]))).toEqual([]);
        const menor = blocoE().map((l: string) => (l.startsWith('|E210|') && l.includes('|1000,00|')
            ? l.replace('|30,00|', '|10,00|') : l));
        const e = so220(prevalidarSpedFiscal([REG0000, ...menor]));
        expect(e.some((x) => String(x.campo).includes('VL_OUT_CRED_ST'))).toBe(true);
    });

    // 🚨 A UF de MG não tem ajuste nenhum — somar os E220 de SP contra ela
    // acusaria um E210 CERTO. É a lição do D100 × D190, no mesmo dia.
    it('o E210 da outra UF não herda os E220 de SP', () => {
        const linhas = blocoE();
        const mg = linhas.filter((l: string) => l.startsWith('|E210|') && l.includes('|500,00|'));
        expect(mg).toHaveLength(1);
        expect(so220(prevalidarSpedFiscal([REG0000, ...linhas]))).toEqual([]);
    });

    it('arquivo sem ST fica MUDO', () => {
        expect(so220(prevalidarSpedFiscal([REG0000]))).toEqual([]);
    });
});
