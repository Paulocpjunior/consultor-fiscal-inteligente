// ============================================================================
// 🚨 O BLOCO 9 TINHA DUAS IMPLEMENTAÇÕES — e ele é a ARITMÉTICA DE FECHAMENTO
//
// O 9900 conta cada tipo de registro, o 9990 conta as linhas do próprio bloco
// e o **9999 conta o ARQUIVO INTEIRO**. O PVA confere os três, e o mecanismo é
// o MESMO nas duas famílias: ele lê os registros que de fato saíram, nunca uma
// lista (é o desenho certo — lista de registros envelhece no primeiro bloco
// novo).
//
// As duas implementações eram idênticas linha por linha, e é justamente aí que
// a segunda cópia é perigosa: **não há defeito hoje, e a próxima correção
// entra numa só**. Foi o que aconteceu com o `getContadorPadrao` (20/08, dois
// arquivos do mesmo mês declarando contabilistas diferentes) e com o
// `UNIDADES_PADRAO` (22/08) — nesta MESMA dupla de arquivos.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo backend .js sem .d.ts (só o teste o importa)
import { buildBloco9 } from '../sefaz-backend/sped-fiscal-bloco9.js';
import { buildBloco9_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';

const RAIZ = join(__dirname, '..');

const l = (campos: string[]) => `|${campos.join('|')}|\r\n`;

const arquivo = [
    l(['0000', '020', '0', '01072026', '31072026', 'X LTDA', '31947349000169']),
    l(['0001', '0']),
    l(['0150', 'P1', 'FORNECEDOR LTDA']),
    l(['0190', 'UN', 'UNIDADE']),
    l(['0200', 'ABC', 'PRODUTO']),
    l(['0990', '5']),
    l(['C001', '0']),
    l(['C100', '0', '1', 'P1', '55', '00', '001', '3485']),
    l(['C170', '001', 'ABC', '', '1,000', 'UN', '1000,00']),
    l(['C190', '000', '1102', '18,00', '1000,00']),
    l(['C990', '4']),
];

describe('🚨 as duas famílias fecham o arquivo pela MESMA conta', () => {
    it('9001, 9900s, 9990 e 9999 saem idênticos', () => {
        expect(buildBloco9_Contrib(arquivo)).toEqual(buildBloco9(arquivo));
    });

    // Os três números que o PVA confere, com o arquivo de exemplo na mão.
    it('e a conta fecha: o 9999 conta o arquivo INTEIRO', () => {
        const b9 = buildBloco9(arquivo);
        const total = arquivo.length + b9.length;
        expect(b9[b9.length - 1]).toBe(l(['9999', String(total)]));
        // O 9990 conta só as linhas do bloco 9.
        expect(b9[b9.length - 2]).toBe(l(['9990', String(b9.length)]));
    });

    it('o 9900 conta por REGISTRO, nunca por lista — bloco novo já entra', () => {
        const b9 = buildBloco9(arquivo).join('');
        // Um registro que só existe neste arquivo de exemplo aparece contado.
        expect(b9).toContain('|9900|C190|1|');
        expect(b9).toContain('|9900|0150|1|');
        // E os quatro do próprio bloco 9 se contam.
        expect(b9).toContain('|9900|9999|1|');
    });

    it('a implementação é UMA — a cópia virou re-exportação', () => {
        const src = readFileSync(join(RAIZ, 'sefaz-backend/sped-contrib-blocos.js'), 'utf8');
        expect(src).toMatch(/export \{ buildBloco9 as buildBloco9_Contrib \}/);
        // A aritmética não pode voltar a existir aqui.
        expect(src).not.toContain("contagem['9990']");
    });
});
