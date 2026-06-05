/**
 * Testes do editor SPED para EFD Contribuicoes (PIS/COFINS).
 * Cobre: deteccao automatica do tipo, layout proprio do C170/M210/M610,
 * e a REDE DE SEGURANCA (layout divergente -> read-only, nunca corrompe).
 */

// @ts-expect-error — modulo .js puro
import { parseSpedFiscalParaEdicao, colunasDoTipo, tiposEditaveis } from '../sefaz-backend/sped-fiscal-editor-parser.js';
// @ts-expect-error — modulo .js puro
import { reconstruirSped } from '../sefaz-backend/sped-fiscal-editor-rebuilder.js';

// Helper: gera linha com a contagem EXATA do layout (placeholders), setando
// alguns campos por nome.
function linhaDe(tipo: string, overrides: Record<string, string> = {}): string {
    const cols: string[] = colunasDoTipo(tipo, 'contribuicoes');
    const vals = cols.map((c: string) => overrides[c] ?? '0,00');
    return '|' + tipo + '|' + vals.join('|') + '|';
}

// EFD Contribuicoes minimo: 0000 + 0150 + 0200 + C170 + M200/M210 + M600/M610 + 9*.
const C170_CONTRIB = linhaDe('C170', { NUM_ITEM: '1', COD_ITEM: '001', CST_PIS: '01', CST_COFINS: '01', VL_PIS: '16,50', VL_COFINS: '76,00' });
const M210 = linhaDe('M210', { CST_PIS: '01', VL_CONT_PER: '16,50' });
const M610 = linhaDe('M610', { CST_COFINS: '01', VL_CONT_PER: '76,00' });

const SPED_CONTRIB = [
    '|0000|006|0|01012026|31012026|S P EXEMPLO LTDA|12345678000190|SP|3550308|0|0|',
    '|0001|0|',
    '|0150|123|FORNEC X|1058|99888777000166|||3550308||RUA Y|100||CENTRO|',
    '|0200|001|PRODUTO|||UN|00|12345678|||||0000000|',
    '|0990|5|',
    '|C001|0|',
    C170_CONTRIB,
    '|C990|3|',
    '|M001|0|',
    '|M200|16,50|0,00|0,00|16,50|0,00|0,00|0,00|0,00|16,50|',
    M210,
    '|M600|76,00|0,00|0,00|76,00|0,00|0,00|0,00|0,00|76,00|',
    M610,
    '|M990|5|',
    '|9001|0|',
    '|9990|3|',
    '|9999|17|',
].join('\r\n') + '\r\n';

describe('EFD Contribuicoes — deteccao + layout', () => {
    it('detecta tipoSped=contribuicoes pela presenca de M200/M600', () => {
        const r = parseSpedFiscalParaEdicao(SPED_CONTRIB);
        expect(r.tipoSped).toBe('contribuicoes');
        expect(r.resumo.tipoSped).toBe('contribuicoes');
    });

    it('C170 contribuicoes = Fiscal sem VL_ABAT_NT (36 campos, CST_PIS/COFINS + CFOP)', () => {
        // VALIDADO contra arquivo real: o C170 do EFD Contribuicoes carrega os
        // mesmos campos de ICMS do Fiscal (CFOP, CST_ICMS) + PIS/COFINS, so
        // nao tem o VL_ABAT_NT final.
        const cols = colunasDoTipo('C170', 'contribuicoes');
        expect(cols).toHaveLength(36);
        expect(cols).toContain('CST_PIS');
        expect(cols).toContain('CST_COFINS');
        expect(cols).toContain('CFOP');       // contrib C170 TEM CFOP (confirmado em dado real)
        expect(cols).toContain('CST_ICMS');
        expect(cols).not.toContain('VL_ABAT_NT'); // unico campo a menos vs Fiscal
    });

    it('C170 editavel traz CST/valores por nome', () => {
        const r = parseSpedFiscalParaEdicao(SPED_CONTRIB);
        expect(r.editaveis['C170']).toHaveLength(1);
        expect(r.editaveis['C170'][0].campos.CST_PIS).toBe('01');
        expect(r.editaveis['C170'][0].campos.VL_COFINS).toBe('76,00');
    });

    it('M210/M610 editaveis (apuracao por CST)', () => {
        const r = parseSpedFiscalParaEdicao(SPED_CONTRIB);
        expect(r.editaveis['M210']).toHaveLength(1);
        expect(r.editaveis['M210'][0].campos.CST_PIS).toBe('01');
        expect(r.editaveis['M610'][0].campos.VL_CONT_PER).toBe('76,00');
    });

    it('tiposEditaveis(contribuicoes) inclui M210/M610', () => {
        const t = tiposEditaveis('contribuicoes');
        expect(t).toContain('M210');
        expect(t).toContain('M610');
        expect(t).toContain('C170');
    });
});

describe('EFD Contribuicoes — REDE DE SEGURANCA (layout divergente)', () => {
    it('C170 com contagem de campos errada vira READ-ONLY (nao editavel)', () => {
        // Linha C170 com 5 campos (muito menos que o layout) — deve cair fora.
        const spedRuim = SPED_CONTRIB.replace(C170_CONTRIB, '|C170|1|001|X|Y|');
        const r = parseSpedFiscalParaEdicao(spedRuim);
        expect(r.editaveis['C170']).toBeUndefined();           // nao editavel
        expect(r.resumo.layoutMismatch['C170']).toBeDefined(); // registrado
        expect(r.resumo.registrosPorTipo['C170']).toBe(1);     // mas preservado
    });

    it('round-trip preserva a linha C170 divergente intacta', () => {
        const spedRuim = SPED_CONTRIB.replace(C170_CONTRIB, '|C170|1|001|X|Y|');
        const r = parseSpedFiscalParaEdicao(spedRuim);
        const out = reconstruirSped(r, []);
        expect(out.split('\r\n')).toContain('|C170|1|001|X|Y|');
    });
});

describe('EFD Contribuicoes — round-trip + edicao', () => {
    it('sem edicoes: round-trip + Bloco 9 recalculado consistente', () => {
        const r = parseSpedFiscalParaEdicao(SPED_CONTRIB);
        const out = reconstruirSped(r, []);
        const lines = out.split('\r\n').filter(Boolean);
        const r9999 = lines.find((l: string) => l.startsWith('|9999|'));
        const total = Number((r9999 || '').match(/\|9999\|(\d+)\|/)?.[1]);
        expect(total).toBe(lines.length);
        // M200/M610 etc preservados
        expect(lines.find((l: string) => l.startsWith('|M200|'))).toBeTruthy();
        expect(lines.find((l: string) => l.startsWith('|M610|'))).toBeTruthy();
    });

    it('edita CST_PIS no M210 e mantem o resto', () => {
        const r = parseSpedFiscalParaEdicao(SPED_CONTRIB);
        const m210 = r.editaveis['M210'][0];
        const cols: string[] = colunasDoTipo('M210', 'contribuicoes');
        const original = r.linhas[m210.idx].campos;
        const novos = [...original];
        const cstIdx = cols.indexOf('CST_PIS') + 1;
        novos[cstIdx] = '02'; // troca CST 01 -> 02
        const out = reconstruirSped(r, [{ idx: m210.idx, campos: novos }]);
        const linhaM210 = out.split('\r\n').find((l: string) => l.startsWith('|M210|'));
        expect(linhaM210!.split('|')[2]).toBe('02');
    });
});
