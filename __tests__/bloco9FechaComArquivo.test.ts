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
