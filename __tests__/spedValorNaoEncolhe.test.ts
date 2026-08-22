// ============================================================================
// 🚨 O FORMATADOR DE VALOR DO SPED ENCOLHIA O NÚMERO EM SILÊNCIO
//
// `formatValue` fazia `parseFloat(value)` cru. O `parseFloat` lê só o PREFIXO
// que ele entende — e as duas formas em que um valor chega como TEXTO neste
// projeto são justamente as que ele erra:
//
//   · '1.234,56' (pt-BR, como sai do e-Fiscal, de PDF e de colagem)
//        → parseFloat devolve 1.234 ⇒ o arquivo declara **1,23**
//   · '1234,56'  (digitado sem milhar)
//        → parseFloat devolve 1234  ⇒ os **centavos somem**
//
// Nas duas o arquivo sai com um número ERRADO E PLAUSÍVEL, que é o pior
// desfecho possível: o PVA aceita, e ninguém confere valor a olho. É a família
// do VL_OPR sem o IPI (20/08) — erro que o validador não recusa e só aparece
// na fiscalização.
//
// ⚠️ Ilegível continua saindo VAZIO. Campo de valor não recebe default, e ''
// o PVA acusa — número errado, não.
// ============================================================================
// @ts-expect-error — módulo backend .js sem .d.ts
import * as fmt from '../sefaz-backend/sped-fiscal-format.js';
import { auditarSaidaSped } from '../sefaz-backend/sped-auditoria-saida.js';

describe('🚨 formatValue não encolhe o número', () => {
    it('o número continua sendo o caminho normal, intocado', () => {
        expect(fmt.formatValue(1234.56)).toBe('1234,56');
        expect(fmt.formatValue(0)).toBe('0,00');
    });

    // 🔴 Os dois casos do defeito.
    it('pt-BR com milhar NÃO vira mil vezes menos', () => {
        expect(fmt.formatValue('1.234,56')).toBe('1234,56');
        expect(fmt.formatValue('26.148.319,35')).toBe('26148319,35');
    });

    it('pt-BR sem milhar NÃO perde os centavos', () => {
        expect(fmt.formatValue('1234,56')).toBe('1234,56');
    });

    it('e a forma JS com ponto decimal continua respondendo', () => {
        expect(fmt.formatValue('1234.56')).toBe('1234,56');
        expect(fmt.formatValue('1234')).toBe('1234,00');
    });

    // "1.234" sem vírgula é o milhar que o e-Fiscal imprime quando o valor é
    // redondo — a MESMA leitura de `parseValorMoeda`.
    it('"1.234" é milhar, não 1,234', () => {
        expect(fmt.formatValue('1.234')).toBe('1234,00');
    });

    it('o ilegível sai VAZIO, nunca zero nem um prefixo', () => {
        expect(fmt.formatValue('abc')).toBe('');
        expect(fmt.formatValue('12abc')).toBe('');
        expect(fmt.formatValue('')).toBe('');
        expect(fmt.formatValue(null)).toBe('');
        expect(fmt.formatValue(NaN)).toBe('');
    });

    it('casas decimais continuam parametrizáveis (alíquota, quantidade)', () => {
        expect(fmt.formatValue('18', 2)).toBe('18,00');
        expect(fmt.formatValue('0,86032111', 8)).toBe('0,86032111');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 E O NEGATIVO — o leiaute do SPED não carrega SINAL
//
// Quando um saldo pode ir para os dois lados ele tem DOIS campos (devedor ×
// credor); quando um ajuste soma ou abate, quem diz isso é o CÓDIGO da tabela
// 5.1.1. Um "-1.234,56" no arquivo é sempre uma destas duas coisas:
//
//   · subtração que passou do zero e ninguém segurou — foi o E210 em 21/08,
//     dedução maior que o saldo devedor;
//   · valor escrito no campo do lado errado — foi o E110 campo 11 em 02/08,
//     que recebia o saldo CREDOR num campo de saldo DEVEDOR.
//
// A verificação mora na AUDITORIA porque ela roda em TODO arquivo gerado, nas
// DUAS famílias — a lição de 21/08: trava nasce onde roda para todos os
// arquivos daquela família, senão protege o cliente que já quebrou e deixa o
// próximo descoberto.
// ═══════════════════════════════════════════════════════════════════════════
const l = (campos: string[]) => `|${campos.join('|')}|\r\n`;

describe('🚨 valor negativo no arquivo é acusado', () => {
    it('acusa o campo, dizendo qual é e por que não pode', () => {
        const r = auditarSaidaSped([
            l(['E110', '1000,00', '0,00', '0,00', '0,00', '0,00', '-1234,56', '0,00']),
        ]);
        const s = r.suspeitas.find((x: any) => x.tipo === 'valor-negativo');
        expect(s).toBeDefined();
        expect(s!.registro).toBe('E110');
        expect(s!.detalhe).toContain('-1234,56');
        expect(s!.detalhe).toMatch(/não usa sinal/i);
        expect(s!.gravidade).toBe('bloqueia');
    });

    it('arquivo com valores positivos passa — a trava nasce VERDE', () => {
        const r = auditarSaidaSped([
            l(['E110', '1000,00', '0,00', '0,00', '0,00', '0,00', '1234,56', '0,00']),
        ]);
        expect(r.suspeitas.some((x: any) => x.tipo === 'valor-negativo')).toBe(false);
    });

    // ⚠️ A assinatura é ESTREITA de propósito: código de ajuste, data, chave e
    // texto NÃO podem casar, senão a auditoria grita sobre arquivo certo — e
    // trava que grita sem motivo é trava desligada.
    it('não confunde código, data nem texto com número negativo', () => {
        const r = auditarSaidaSped([
            l(['E111', 'SP020799', 'CREDITO OUTORGADO - ART 41', '1000,00']),
            l(['0000', '020', '0', '01072026', '31072026', 'X - Y LTDA', '31947349000169']),
        ]);
        expect(r.suspeitas.some((x: any) => x.tipo === 'valor-negativo')).toBe(false);
    });

    it('muitos negativos não afogam o resto da auditoria', () => {
        const linhas = Array.from({ length: 9 }, (_, i) =>
            l([`C19${i % 10}`, '000', '5102', '18,00', '-10,00']));
        const r = auditarSaidaSped(linhas);
        const negativas = r.suspeitas.filter((x: any) => x.tipo === 'valor-negativo');
        expect(negativas.length).toBe(6);   // 5 nomeadas + 1 resumo
        expect(negativas[5].detalhe).toMatch(/e mais 4/);
    });
});
