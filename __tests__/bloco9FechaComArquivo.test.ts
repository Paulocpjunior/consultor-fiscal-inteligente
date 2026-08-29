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
