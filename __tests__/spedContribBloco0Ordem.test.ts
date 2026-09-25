// ============================================================================
// 🧱 A ORDEM DO BLOCO 0 DO EFD-CONTRIBUIÇÕES — o 0500 é filho do 0001, não do 0140
//
// ELS (DISTRIBUIDORA DE BANANAS) 08/2026, 25/09: PVA com 127 erros, 123 deles
// "Organização hierárquica dos blocos/registros do arquivo está fora dos
// padrões estabelecidos" — um por 0150, 0190 e 0200 (37 + 9 + 77). O 0500 saía
// na linha 6, logo depois do 0140, e FECHAVA a subárvore dele: o PVA passava a
// esperar 0600 e recusava cada participante, unidade e item seguinte.
//
// A asserção cobra a POSIÇÃO (fato do leiaute), não a redação da linha.
// ============================================================================
// @ts-expect-error módulo .js puro sem tipos
import { buildBloco0Contrib } from '../sefaz-backend/sped-contrib-bloco0.js';

const dados = () => ({
    empresa: { cnpj: '65671243000105', nome: 'DISTRIBUIDORA DE BANANAS ELS LTDA' },
    competencia: '2026-08',
    regimeApuracao: '1',
    notas: [],
    itens: [{ codItem: 'BAN', descrItem: 'BANANA', unidInv: 'KG', tipoItem: '00' }],
    unidades: [{ unid: 'KG', descr: 'QUILOGRAMA' }],
    participantes: [{ codPart: '49167213000100', nome: 'RR COMERCIO', cnpj: '49167213000100', codMunIBGE: '2925758' }],
    contaContabilReceitaFinanceira: '3.1.1.01.0002',
    contaContabilReceitaFinanceiraNome: 'VENDAS DE MERCADORIA A PRAZO',
    contaContabilReceitaFinanceiraNivel: '5',
    warnings: [] as string[],
});

const reg = (l: string) => l.split('|')[1];

describe('🧱 o 0500 sai DEPOIS da subárvore do 0140 e ANTES do 0990', () => {
    const linhas: string[] = buildBloco0Contrib(dados());
    const regs = linhas.map(reg);

    it('o arquivo tem o 0500 (a conta está inteira no cadastro)', () => {
        expect(regs.filter((r) => r === '0500')).toHaveLength(1);
    });

    it('todo 0150, 0190 e 0200 vem ANTES do 0500', () => {
        const i0500 = regs.indexOf('0500');
        for (const r of ['0150', '0190', '0200']) {
            const ultimo = regs.lastIndexOf(r);
            expect(ultimo).toBeGreaterThan(-1);
            expect(ultimo).toBeLessThan(i0500);
        }
    });

    it('o 0500 vem depois do 0140 e o 0990 fecha o bloco', () => {
        expect(regs.indexOf('0500')).toBeGreaterThan(regs.indexOf('0140'));
        expect(regs[regs.length - 1]).toBe('0990');
        expect(regs.indexOf('0500')).toBe(regs.length - 2);
    });

    // A hierarquia inteira, na ordem do Guia Prático (só os que este arquivo emite).
    it('a sequência dos registros é a do leiaute', () => {
        const semRepeticao = regs.filter((r, i) => i === 0 || regs[i - 1] !== r);
        expect(semRepeticao).toEqual(['0000', '0001', '0100', '0110', '0140', '0150', '0190', '0200', '0500', '0990']);
    });

    it('o total do 0990 conta o 0500 onde ele está', () => {
        const l0990 = linhas[linhas.length - 1].split('|');
        expect(Number(l0990[2])).toBe(linhas.length);
    });
});
