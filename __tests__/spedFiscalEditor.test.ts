/**
 * Testes do editor SPED Fiscal (parser + rebuilder).
 * Trava o invariante critico: round-trip fiel (sem edicoes, sai identico)
 * e totalizadores recalculados pra passar no PVA.
 */

// @ts-expect-error — modulo .js puro
import { parseSpedFiscalParaEdicao, tiposEditaveis, colunasDoTipo } from '../sefaz-backend/sped-fiscal-editor-parser.js';
// @ts-expect-error — modulo .js puro
import { reconstruirSped } from '../sefaz-backend/sped-fiscal-editor-rebuilder.js';

// SPED minimo realista: 0000, 0001, 0150, 0200, 0990, C001, C100, C170, C190, C990,
// E001, E110, E990, 9001, 9900*, 9990, 9999.
const SPED_MINI = [
    '|0000|017|0|01012026|31012026|S P EXEMPLO LTDA|12345678000190|SP|123456789012|3550308||A|',
    '|0001|0|',
    '|0150|123|FORNEC X|1058|99888777000166|||3550308||RUA Y|100||CENTRO|',
    '|0200|001|PRODUTO TESTE|||UN|00|12345678|||||0000000|',
    '|0990|5|',
    '|C001|0|',
    '|C100|1|0|123|55|00|1|100|35260112345678000190550010000000011000000017|01012026|01012026|1000,00|0|0,00|0,00|1000,00|9|0,00|0,00|0,00|1000,00|180,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
    '|C170|1|001||0,00|UN|0,00|0,00||000|5102||0,00|0,00|0,00|0,00|0,00|0,00||||0,00|0,00|0,00||0,00|0,00|0,00|0,00|0,00||0,00|0,00|0,00|0,00|0,00||0,00|',
    '|C190|000|5102|18,00|1000,00|1000,00|180,00|0,00|0,00|0,00|0,00||',
    '|C990|5|',
    '|E001|0|',
    '|E110|180,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|180,00|0,00|180,00|0,00|0,00|',
    '|E990|3|',
    '|9001|0|',
    '|9900|0000|1|',
    '|9900|0001|1|',
    '|9900|0150|1|',
    '|9900|0200|1|',
    '|9900|0990|1|',
    '|9900|C001|1|',
    '|9900|C100|1|',
    '|9900|C170|1|',
    '|9900|C190|1|',
    '|9900|C990|1|',
    '|9900|E001|1|',
    '|9900|E110|1|',
    '|9900|E990|1|',
    '|9900|9001|1|',
    '|9900|9900|17|',
    '|9900|9990|1|',
    '|9900|9999|1|',
    '|9990|19|',
    '|9999|33|',
].join('\r\n') + '\r\n';

describe('parseSpedFiscalParaEdicao', () => {
    it('parse minimo: indexa todas as linhas e os editaveis', () => {
        const r = parseSpedFiscalParaEdicao(SPED_MINI);
        expect(r.linhas.length).toBe(33);
        expect(r.resumo.registrosPorTipo['0000']).toBe(1);
        expect(r.resumo.registrosPorTipo['C170']).toBe(1);
        expect(r.resumo.registrosPorTipo['9900']).toBe(17);
        expect(r.editaveis['C170']).toHaveLength(1);
        expect(r.editaveis['C190']).toHaveLength(1);
        expect(r.editaveis['C190'][0].campos.CFOP).toBe('5102');
        expect(r.editaveis['C170'][0].campos.CFOP).toBe('5102');
        expect(r.editaveis['C170'][0].campos.CST_ICMS).toBe('000');
        expect(r.editaveis['C170'][0].campos.NCM).toBeUndefined(); // NCM nao esta no C170 (esta no 0200)
        expect(r.editaveis['0200']).toHaveLength(1);
        expect(r.editaveis['0200'][0].campos.COD_NCM).toBe('12345678');
    });

    it('preserva ordem das linhas (idx sequencial)', () => {
        const r = parseSpedFiscalParaEdicao(SPED_MINI);
        for (let i = 0; i < r.linhas.length; i++) {
            expect(r.linhas[i].idx).toBe(i);
        }
    });

    it('linhas mal-formadas (sem pipe inicial) sao contabilizadas como _invalida', () => {
        const sujo = SPED_MINI + 'LINHA SEM PIPE\r\n' + '|tipoSemFim';
        const r = parseSpedFiscalParaEdicao(sujo);
        expect(r.resumo.registrosPorTipo['_invalida']).toBe(2);
    });

    it('linhas vazias sao ignoradas (Guia Pratico nao admite)', () => {
        const com = SPED_MINI + '\r\n\r\n\r\n';
        const r = parseSpedFiscalParaEdicao(com);
        expect(r.linhas.length).toBe(33); // mesma contagem
    });

    it('aceita C190 com COD_OBS final omitido e leva para aba editavel', () => {
        const semCodObs = SPED_MINI.replace(
            '|C190|000|5102|18,00|1000,00|1000,00|180,00|0,00|0,00|0,00|0,00||',
            '|C190|000|5102|18,00|1000,00|1000,00|180,00|0,00|0,00|0,00|0,00|',
        );
        const r = parseSpedFiscalParaEdicao(semCodObs);
        expect(r.editaveis['C190']).toHaveLength(1);
        expect(r.editaveis['C190'][0].campos.COD_OBS).toBe('');
        expect(r.resumo.layoutMismatch['C190']).toBeUndefined();
    });

    it('tiposEditaveis lista os layouts conhecidos', () => {
        const t = tiposEditaveis();
        expect(t).toContain('C170');
        expect(t).toContain('C100');
        expect(t).toContain('E110');
        expect(t).toContain('E210');
        expect(t).toContain('E250');
        expect(t).toContain('E310');
        expect(t).toContain('E316');
    });

    it('colunasDoTipo devolve nomes na ordem do SPED', () => {
        const cols = colunasDoTipo('C170');
        expect(cols![0]).toBe('NUM_ITEM');
        expect(cols).toContain('CFOP');
        expect(colunasDoTipo('E210')).toContain('VL_ICMS_RECOL_ST');
        expect(colunasDoTipo('E250')).toEqual([
            'COD_OR', 'VL_OR', 'DT_VCTO', 'COD_REC', 'NUM_PROC',
            'IND_PROC', 'PROC', 'TXT_COMPL', 'MES_REF',
        ]);
        expect(colunasDoTipo('E310')![0]).toBe('IND_MOV_FCP_DIFAL');
        expect(colunasDoTipo('E310')).toContain('VL_RECOL_DIFAL');
        expect(colunasDoTipo('E310')).toContain('VL_RECOL_FCP');
        expect(colunasDoTipo('E316')).toContain('VL_OR');
        expect(colunasDoTipo('REGISTRO_INEXISTENTE')).toBeNull();
    });

    it('leva E210/E250/E310/E316 para abas editaveis', () => {
        const sped = [
            '|0000|017|0|01052026|31052026|S P EXEMPLO LTDA|12345678000190|SP|123456789012|3550308||A|',
            '|E001|0|',
            '|E210|1|0|0|0|0|0|7177,45|0|0|7177,45|0|7177,45|0|0|',
            '|E250|002|7177,45|22062026|146-6|||||052026|',
            '|E310|1|0|773,64|0|0|0|773,64|0|773,64|0|0|0|0|0|0|0|0|0|0|0|0|',
            '|E316|000|773,64|18052026|100102|||||052026|',
            '|E990|6|',
            '|9999|7|',
        ].join('\r\n') + '\r\n';

        const r = parseSpedFiscalParaEdicao(sped);

        expect(r.editaveis['E210'][0].campos.VL_RETENCAO_ST).toBe('7177,45');
        expect(r.editaveis['E210'][0].campos.VL_ICMS_RECOL_ST).toBe('7177,45');
        expect(r.editaveis['E250'][0].campos.COD_REC).toBe('146-6');
        expect(r.editaveis['E250'][0].campos.MES_REF).toBe('052026');
        expect(r.editaveis['E310'][0].campos.VL_TOT_DEBITOS_DIFAL).toBe('773,64');
        expect(r.editaveis['E310'][0].campos.VL_RECOL_DIFAL).toBe('773,64');
        expect(r.editaveis['E316'][0].campos.VL_OR).toBe('773,64');
        expect(r.resumo.layoutMismatch['E210']).toBeUndefined();
        expect(r.resumo.layoutMismatch['E250']).toBeUndefined();
        expect(r.resumo.layoutMismatch['E310']).toBeUndefined();
        expect(r.resumo.layoutMismatch['E316']).toBeUndefined();
    });

    it('lanca em texto vazio/invalido', () => {
        expect(() => parseSpedFiscalParaEdicao('')).toThrow(/vazio/);
        expect(() => parseSpedFiscalParaEdicao(null)).toThrow();
    });
});

describe('reconstruirSped — round-trip', () => {
    it('SEM EDICOES: round-trip preserva todas as linhas e recalcula Bloco 9', () => {
        const parsed = parseSpedFiscalParaEdicao(SPED_MINI);
        const out = reconstruirSped(parsed, []);
        // 1) Numero total de linhas tem que bater com R9999
        const lines = out.split('\r\n').filter(Boolean);
        const r9999 = lines.find((l: string) => l.startsWith('|9999|'));
        const total = Number((r9999 || '').match(/\|9999\|(\d+)\|/)?.[1]);
        expect(total).toBe(lines.length);
        // 2) R9990 = total de linhas no Bloco 9 (9001..9999 inclusive)
        const r9990 = lines.find((l: string) => l.startsWith('|9990|'));
        const totalBloco9 = Number((r9990 || '').match(/\|9990\|(\d+)\|/)?.[1]);
        const bloco9Real = lines.filter((l: string) => /^\|9[09]\d{2}\|/.test(l)).length;
        expect(totalBloco9).toBe(bloco9Real);
        // 3) Cada registro original (fora Bloco 9) aparece intacto
        const orig = SPED_MINI.split('\r\n').filter(l => l && !/^\|9[09]\d{2}\|/.test(l));
        for (const lOrig of orig) {
            expect(lines).toContain(lOrig);
        }
    });

    it('COM EDICAO: aplica CFOP novo no C170 e mantem resto', () => {
        const parsed = parseSpedFiscalParaEdicao(SPED_MINI);
        const c170 = parsed.editaveis['C170'][0];
        // Constroi array de campos novos: tipo + ordem do LAYOUT C170
        const cols = colunasDoTipo('C170')!;
        const original = parsed.linhas[c170.idx].campos;
        const novos = [...original];
        const cfopIdx = cols.indexOf('CFOP') + 1; // +1 porque tipo eh idx 0
        novos[cfopIdx] = '5101'; // troca CFOP 5102 -> 5101
        const out = reconstruirSped(parsed, [{ idx: c170.idx, campos: novos }]);
        const linhaC170 = out.split('\r\n').find((l: string) => l.startsWith('|C170|'));
        expect(linhaC170).toContain('|5101|');
        expect(linhaC170).not.toContain('|5102|');
    });

    it('COM EDICAO: aplica alteracao em E250/E316 e recalcula Bloco 9', () => {
        const sped = [
            '|0000|017|0|01052026|31052026|S P EXEMPLO LTDA|12345678000190|SP|123456789012|3550308||A|',
            '|E001|0|',
            '|E210|1|0|0|0|0|0|7177,45|0|0|7177,45|0|7177,45|0|0|',
            '|E250|002|7177,45|22062026|146-6|||||052026|',
            '|E310|1|0|773,64|0|0|0|773,64|0|773,64|0|0|0|0|0|0|0|0|0|0|0|0|',
            '|E316|000|773,64|18052026|100102|||||052026|',
            '|E990|6|',
            '|9001|0|',
            '|9900|0000|1|',
            '|9900|E001|1|',
            '|9900|E210|1|',
            '|9900|E250|1|',
            '|9900|E310|1|',
            '|9900|E316|1|',
            '|9900|E990|1|',
            '|9900|9001|1|',
            '|9900|9900|11|',
            '|9900|9990|1|',
            '|9900|9999|1|',
            '|9990|13|',
            '|9999|21|',
        ].join('\r\n') + '\r\n';
        const parsed = parseSpedFiscalParaEdicao(sped);
        const e250 = parsed.editaveis['E250'][0];
        const e316 = parsed.editaveis['E316'][0];
        const e250Campos = [...parsed.linhas[e250.idx].campos];
        const e316Campos = [...parsed.linhas[e316.idx].campos];
        e250Campos[2] = '7178,45';
        e316Campos[3] = '19052026';

        const out = reconstruirSped(parsed, [
            { idx: e250.idx, campos: e250Campos },
            { idx: e316.idx, campos: e316Campos },
        ]);

        const lines = out.split('\r\n').filter(Boolean);
        expect(lines).toContain('|E250|002|7178,45|22062026|146-6|||||052026|');
        expect(lines).toContain('|E316|000|773,64|19052026|100102|||||052026|');
        expect(lines.find((l: string) => l === '|9900|E250|1|')).toBeTruthy();
        expect(lines.find((l: string) => l === '|9900|E316|1|')).toBeTruthy();
        const r9999 = lines.find((l: string) => l.startsWith('|9999|'));
        expect(Number((r9999 || '').match(/\|9999\|(\d+)\|/)?.[1])).toBe(lines.length);
    });

    it('COM INSERCAO: adiciona C190 e recalcula Bloco 9', () => {
        const parsed = parseSpedFiscalParaEdicao(SPED_MINI);
        const c170idx = parsed.editaveis['C170'][0].idx;
        const out = reconstruirSped(parsed, [{
            insertAfterIdx: c170idx,
            campos: ['C190', '000', '5102', '18,00', '1000,00', '1000,00', '180,00', '0,00', '0,00', '0,00', '0,00', ''],
        }]);
        const lines = out.split('\r\n').filter(Boolean);
        expect(lines.filter((l: string) => l.startsWith('|C190|'))).toHaveLength(2);
        expect(lines.find((l: string) => l === '|9900|C190|2|')).toBeTruthy();
    });

    it('rejeita troca de tipo (campo 0)', () => {
        const parsed = parseSpedFiscalParaEdicao(SPED_MINI);
        const c170idx = parsed.editaveis['C170'][0].idx;
        const novos = ['X999', '1']; // tentativa de trocar tipo
        expect(() => reconstruirSped(parsed, [{ idx: c170idx, campos: novos }]))
            .toThrow(/nao pode trocar tipo/);
    });

    it('R9900 inclui CONTAGEM correta de cada tipo + ele proprio', () => {
        const parsed = parseSpedFiscalParaEdicao(SPED_MINI);
        const out = reconstruirSped(parsed, []);
        const lines = out.split('\r\n').filter(Boolean);
        // C170 = 1 ocorrencia no SPED original (sem Bloco 9)
        const r9900_c170 = lines.find((l: string) => /^\|9900\|C170\|/.test(l));
        expect(r9900_c170).toBe('|9900|C170|1|');
        // 9900 conta a si mesmo
        const r9900_9900 = lines.find((l: string) => /^\|9900\|9900\|/.test(l));
        expect(r9900_9900).toBeTruthy();
    });

    it('lanca em edicao com campos nao-array', () => {
        const parsed = parseSpedFiscalParaEdicao(SPED_MINI);
        expect(() => reconstruirSped(parsed, [{ idx: 0, campos: 'bla' as any }]))
            .toThrow(/array/);
    });
});
