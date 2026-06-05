/**
 * Testes da analise de recuperacao PIS/COFINS monofasico.
 * Real (industria plastico, nao-monofasico) -> 0 itens (sem ruido).
 * Sintetico monofasico tributado -> dispara com valor recuperavel.
 */
import * as fs from 'fs';

// @ts-expect-error — modulo .js puro
import { parseSpedFiscalParaEdicao, colunasDoTipo } from '../sefaz-backend/sped-fiscal-editor-parser.js';
// @ts-expect-error — modulo .js puro
import { analisarRecuperacaoMonofasico, ehNcmMonofasico } from '../sefaz-backend/sped-contrib-recuperacao.js';

// C170 contrib (36 campos) com defaults; override por nome de coluna.
function c170Contrib(over: Record<string, string> = {}): string {
    const cols: string[] = colunasDoTipo('C170', 'contribuicoes');
    const campos = cols.map((c: string) => over[c] ?? '');
    campos[cols.indexOf('NUM_ITEM')] = over.NUM_ITEM ?? '1';
    campos[cols.indexOf('COD_ITEM')] = over.COD_ITEM ?? '001';
    return '|C170|' + campos.join('|') + '|';
}

// SPED Contribuicoes minimo com 1 item (0200 define o NCM).
function montaContrib(ncm: string, c170Over: Record<string, string>): any {
    const txt = [
        '|0000|006|0|01012026|31012026|EMP|12345678000190|SP|3550308|0|0|',
        '|0001|0|',
        `|0200|001|PRODUTO|||UN|01|${ncm}|||20|`,
        '|0990|3|',
        '|C001|0|',
        c170Contrib({ COD_ITEM: '001', ...c170Over }),
        '|C990|1|',
        '|M001|0|',
        '|M200|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
        '|M600|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
        '|M990|3|',
    ].join('\r\n') + '\r\n';
    return parseSpedFiscalParaEdicao(txt);
}

describe('ehNcmMonofasico', () => {
    it('reconhece familias monofasicas', () => {
        expect(ehNcmMonofasico('27101259')).toBe(true);  // combustivel
        expect(ehNcmMonofasico('30049099')).toBe(true);  // medicamento
        expect(ehNcmMonofasico('33030010')).toBe(true);  // perfume
        expect(ehNcmMonofasico('22021000')).toBe(true);  // refrigerante
        expect(ehNcmMonofasico('40111000')).toBe(true);  // pneu
    });
    it('NAO marca NCM nao-monofasico (plastico 3901/3902)', () => {
        expect(ehNcmMonofasico('39011030')).toBe(false);
        expect(ehNcmMonofasico('39021000')).toBe(false);
        expect(ehNcmMonofasico('')).toBe(false);
    });
});

describe('analisarRecuperacaoMonofasico — arquivo real (plastico)', () => {
    it('industria de plastico real -> 0 itens, 0 recuperavel', () => {
        const p = '/root/.claude/uploads/397fe5b6-3431-4ff6-b38a-f6d52ff24969/bdab40d8-MODELO_EFD_CONT.txt';
        if (!fs.existsSync(p)) return;
        const parsed = parseSpedFiscalParaEdicao(fs.readFileSync(p, 'latin1'));
        const r = analisarRecuperacaoMonofasico(parsed);
        expect(r.aplicavel).toBe(true);
        expect(r.resumo.qtdItens).toBe(0);
        expect(r.total).toBe(0);
    });
});

describe('analisarRecuperacaoMonofasico — dispara em monofasico tributado', () => {
    it('combustivel (2710) com CST_PIS/COFINS 01 e valor pago -> recuperavel', () => {
        const parsed = montaContrib('27101259', {
            CST_PIS: '01', VL_PIS: '16,50', CST_COFINS: '01', VL_COFINS: '76,00',
        });
        const r = analisarRecuperacaoMonofasico(parsed);
        expect(r.resumo.qtdItens).toBe(1);
        expect(r.totalPis).toBe(16.50);
        expect(r.totalCofins).toBe(76.00);
        expect(r.total).toBe(92.50);
        expect(r.itens[0].ncm).toBe('27101259');
    });

    it('monofasico com CST 04 (correto) -> NAO recuperavel', () => {
        const parsed = montaContrib('30049099', {
            CST_PIS: '04', VL_PIS: '0,00', CST_COFINS: '04', VL_COFINS: '0,00',
        });
        expect(analisarRecuperacaoMonofasico(parsed).resumo.qtdItens).toBe(0);
    });

    it('NAO-monofasico com CST 01 tributado -> NAO recuperavel (correto tributar)', () => {
        const parsed = montaContrib('39011030', {
            CST_PIS: '01', VL_PIS: '16,50', CST_COFINS: '01', VL_COFINS: '76,00',
        });
        expect(analisarRecuperacaoMonofasico(parsed).resumo.qtdItens).toBe(0);
    });

    it('so PIS indevido (COFINS ok) -> conta so PIS', () => {
        const parsed = montaContrib('22021000', {
            CST_PIS: '01', VL_PIS: '10,00', CST_COFINS: '06', VL_COFINS: '0,00',
        });
        const r = analisarRecuperacaoMonofasico(parsed);
        expect(r.totalPis).toBe(10.00);
        expect(r.totalCofins).toBe(0);
    });
});

describe('analisarRecuperacaoMonofasico — escopo', () => {
    it('EFD ICMS/IPI -> nao aplicavel', () => {
        const r = analisarRecuperacaoMonofasico({ tipoSped: 'fiscal', linhas: [] });
        expect(r.aplicavel).toBe(false);
    });
});
