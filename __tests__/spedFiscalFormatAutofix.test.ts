/**
 * Testes da auto-correção de FORMATO do SPED Fiscal.
 *
 * Cenário: ERPs exportam SPED com formato fora do padrão (espaços em códigos,
 * ponto decimal em valores). PVA da Receita rejeita por "campo inválido"
 * mesmo a semântica estando correta. Aqui só normaliza FORMATO — nunca muda
 * significado.
 */
// @ts-expect-error — módulo .js puro
import { corrigirFormato } from '../sefaz-backend/sped-fiscal-format-autofix.js';

function mkParsed(linhas: Array<{ tipo: string; campos: string[] }>) {
    return {
        tipoSped: 'fiscal',
        linhas: linhas.map((l, i) => ({ idx: i, tipo: l.tipo, campos: [l.tipo, ...l.campos], original: '' })),
    };
}

// Helpers que constroem linhas reais com os campos relevantes.
// C170 layout 1-based: [6]=VL_ITEM [9]=CST [10]=CFOP [12]=VL_BC [13]=ALIQ [14]=VL_ICMS
function c170Vals(overrides: Partial<{ cst: string; cfop: string; vlItem: string; vlIcms: string; vlBc: string }> = {}): { tipo: string; campos: string[] } {
    const c = new Array(36).fill('');
    c[5] = overrides.vlItem ?? '100,00';      // [6]
    c[8] = overrides.cst ?? '000';             // [9]
    c[9] = overrides.cfop ?? '5102';           // [10]
    c[11] = overrides.vlBc ?? '100,00';        // [12]
    c[13] = overrides.vlIcms ?? '18,00';       // [14]
    return { tipo: 'C170', campos: c };
}

function c190Vals(overrides: Partial<{ cst: string; cfop: string; vlOpr: string }> = {}): { tipo: string; campos: string[] } {
    return {
        tipo: 'C190',
        campos: [overrides.cst ?? '000', overrides.cfop ?? '5102', '18,00', overrides.vlOpr ?? '100,00', '100,00', '18,00'],
    };
}

describe('corrigirFormato — TRIM_CODIGO', () => {
    it('remove espaços de CFOP no C170', () => {
        const r = corrigirFormato(mkParsed([c170Vals({ cfop: ' 5102 ' })]));
        expect(r.resumo.linhasAjustadas).toBe(1);
        expect(r.resumo.camposAjustados).toBe(1);
        expect(r.edicoes[0].campos[10]).toBe('5102');
        const aj = r.ajustes[0];
        expect(aj.regra).toBe('TRIM_CODIGO');
        expect(aj.campo).toBe('CFOP');
        expect(aj.de).toBe(' 5102 ');
        expect(aj.para).toBe('5102');
        expect(aj.mensagem).toContain('espaços removidos');
    });

    it('remove espaços INTERNOS de NCM no 0200', () => {
        // ERP às vezes exporta "1234 5678" — PVA rejeita.
        // mkParsed adiciona o tipo em [0], então índice N aqui = N+1 no array final.
        // COD_NCM no 0200 fica no índice 7 do array final → seta no [6] aqui.
        const linha = { tipo: '0200', campos: new Array(11).fill('') };
        linha.campos[0] = 'PROD001';        // → [1]=COD_ITEM no array final
        linha.campos[6] = '1234 5678';      // → [7]=COD_NCM no array final
        const r = corrigirFormato(mkParsed([linha]));
        expect(r.resumo.camposAjustados).toBe(1);
        expect(r.edicoes[0].campos[7]).toBe('12345678');
        expect(r.ajustes[0].campo).toBe('COD_NCM');
    });

    it('normaliza VÁRIOS códigos numa linha — conta cada um', () => {
        // CFOP com espaço + CST com espaço + COD_ITEM com espaço
        const r = corrigirFormato(mkParsed([c170Vals({ cfop: ' 5102', cst: '00 0' })]));
        expect(r.resumo.camposAjustados).toBe(2);
    });

    it('não conta linha quando nada mudou', () => {
        const r = corrigirFormato(mkParsed([c170Vals({ cfop: '5102', cst: '000' })]));
        expect(r.resumo.linhasAjustadas).toBe(0);
        expect(r.edicoes).toHaveLength(0);
    });
});

describe('corrigirFormato — DECIMAL_PONTO', () => {
    it('troca ponto por vírgula em VL_ITEM do C170', () => {
        const r = corrigirFormato(mkParsed([c170Vals({ vlItem: '1956.03' })]));
        expect(r.resumo.camposAjustados).toBe(1);
        expect(r.edicoes[0].campos[6]).toBe('1956,03');
        const aj = r.ajustes[0];
        expect(aj.regra).toBe('DECIMAL_PONTO');
        expect(aj.campo).toBe('VL_ITEM');
        expect(aj.mensagem).toContain('ponto decimal');
    });

    it('NÃO toca em valor já com vírgula (esperado)', () => {
        const r = corrigirFormato(mkParsed([c170Vals({ vlItem: '1956,03' })]));
        expect(r.resumo.camposAjustados).toBe(0);
    });

    it('NÃO toca em "1.234,56" (separador de milhar) — formato ambíguo, conservador', () => {
        const r = corrigirFormato(mkParsed([c170Vals({ vlItem: '1.234,56' })]));
        expect(r.resumo.camposAjustados).toBe(0);
    });

    it('NÃO toca em valor inteiro sem decimal "100"', () => {
        const r = corrigirFormato(mkParsed([c170Vals({ vlItem: '100' })]));
        expect(r.resumo.camposAjustados).toBe(0);
    });

    it('aceita decimal de 1 dígito ("100.5" → "100,5")', () => {
        const r = corrigirFormato(mkParsed([c170Vals({ vlItem: '100.5' })]));
        expect(r.resumo.camposAjustados).toBe(1);
        expect(r.edicoes[0].campos[6]).toBe('100,5');
    });

    it('campo vazio fica vazio', () => {
        const r = corrigirFormato(mkParsed([c170Vals({ vlItem: '' })]));
        expect(r.resumo.camposAjustados).toBe(0);
    });

    it('corrige valor monetário em C190 também', () => {
        const r = corrigirFormato(mkParsed([c190Vals({ vlOpr: '1956.03' })]));
        expect(r.resumo.camposAjustados).toBe(1);
        expect(r.edicoes[0].campos[4]).toBe('1956,03');
        expect(r.ajustes[0].registro).toBe('C190');
        expect(r.ajustes[0].campo).toBe('VL_OPR');
    });
});

describe('corrigirFormato — combinado e edge cases', () => {
    it('ajusta CFOP + VL_ITEM na MESMA linha — 1 linha, 2 campos', () => {
        const r = corrigirFormato(mkParsed([c170Vals({ cfop: ' 5102 ', vlItem: '100.50' })]));
        expect(r.resumo.linhasAjustadas).toBe(1);
        expect(r.resumo.camposAjustados).toBe(2);
        expect(r.edicoes[0].campos[10]).toBe('5102');
        expect(r.edicoes[0].campos[6]).toBe('100,50');
    });

    it('resumo.porRegra acumula correto', () => {
        // 2 linhas C170: cada uma com 1 CFOP com espaço + 1 valor com ponto
        const r = corrigirFormato(mkParsed([
            c170Vals({ cfop: ' 5102', vlItem: '100.00' }),
            c170Vals({ cfop: '5102 ', vlItem: '200.00' }),
        ]));
        expect(r.resumo.porRegra.TRIM_CODIGO).toBe(2);
        expect(r.resumo.porRegra.DECIMAL_PONTO).toBe(2);
        expect(r.resumo.camposAjustados).toBe(4);
        expect(r.resumo.linhasAjustadas).toBe(2);
    });

    it('linhas que NÃO têm mapping de tipo (ex: 9900) são ignoradas', () => {
        const linha = { tipo: '9900', campos: ['C170', '850'] };
        const r = corrigirFormato(mkParsed([linha]));
        expect(r.resumo.linhasAjustadas).toBe(0);
    });

    it('não aplica em SPED de Contribuições', () => {
        const parsed = { tipoSped: 'contribuicoes', linhas: [] };
        const r = corrigirFormato(parsed);
        expect(r.edicoes).toHaveLength(0);
    });

    it('parsed inválido/vazio não quebra', () => {
        expect(() => corrigirFormato(null as any)).not.toThrow();
        expect(() => corrigirFormato({} as any)).not.toThrow();
        expect(corrigirFormato({ linhas: [] } as any).edicoes).toHaveLength(0);
    });
});
