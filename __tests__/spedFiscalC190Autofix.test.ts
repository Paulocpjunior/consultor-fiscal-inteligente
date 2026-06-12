/**
 * Testes da auto-correção do C190 (totalizador) a partir dos C170.
 *
 * Cenário real: contador edita um VL_ITEM no C170 mas esquece de refazer o
 * C190 → PVA rejeita. Antes só apontávamos (R8); agora corrigimos e avisamos.
 */
// @ts-expect-error — módulo .js puro
import { corrigirC190 } from '../sefaz-backend/sped-fiscal-c190-autofix.js';

// Helper: monta `parsed` no formato do parser-editor (idx/tipo/campos).
// campos[0] = tipo. Demais conforme layout SPED.
function mkParsed(linhas: Array<{ tipo: string; campos: string[] }>) {
    return {
        tipoSped: 'fiscal',
        linhas: linhas.map((l, i) => ({ idx: i, tipo: l.tipo, campos: [l.tipo, ...l.campos], original: '' })),
    };
}

// C170 com layout 1-based: campos passados já SEM o tipo (helper adiciona).
// Posições relativas ao array final (com tipo em [0]):
//   [6]=VL_ITEM [9]=CST [10]=CFOP [12]=VL_BC [13]=ALIQ [14]=VL_ICMS
function c170({ vlItem, cst, cfop, vlBc, aliq, vlIcms }: any): { tipo: string; campos: string[] } {
    const campos = new Array(20).fill('');
    campos[5] = vlItem;   // idx 6 no array final (tipo em 0)
    campos[8] = cst;      // idx 9
    campos[9] = cfop;     // idx 10
    campos[11] = vlBc;    // idx 12
    campos[12] = aliq;    // idx 13
    campos[13] = vlIcms;  // idx 14
    return { tipo: 'C170', campos };
}

// C190: [1]=CST [2]=CFOP [3]=ALIQ [4]=VL_OPR [5]=VL_BC [6]=VL_ICMS
function c190({ cst, cfop, aliq, vlOpr, vlBc, vlIcms }: any): { tipo: string; campos: string[] } {
    return { tipo: 'C190', campos: [cst, cfop, aliq, vlOpr, vlBc, vlIcms] };
}

describe('corrigirC190', () => {
    it('corrige C190 quando soma dos C170 diverge', () => {
        // Dois C170 (CST 000, CFOP 5102, aliq 18) somam VL_ITEM=300, VL_ICMS=54.
        // C190 está com VL_OPR=200 / VL_ICMS=36 (errado — contador editou C170).
        const parsed = mkParsed([
            { tipo: 'C100', campos: new Array(10).fill('').map((_, i) => i === 6 ? '123' : '') },
            c170({ vlItem: '100,00', cst: '000', cfop: '5102', vlBc: '100,00', aliq: '18,00', vlIcms: '18,00' }),
            c170({ vlItem: '200,00', cst: '000', cfop: '5102', vlBc: '200,00', aliq: '18,00', vlIcms: '36,00' }),
            c190({ cst: '000', cfop: '5102', aliq: '18,00', vlOpr: '200,00', vlBc: '200,00', vlIcms: '36,00' }),
        ]);
        const r = corrigirC190(parsed);
        expect(r.resumo.c190Corrigidos).toBe(1);
        // VL_OPR 200→300, VL_BC 200→300, VL_ICMS 36→54 = 3 campos
        expect(r.resumo.camposAjustados).toBe(3);
        const ed = r.edicoes[0];
        expect(ed.campos[4]).toBe('300,00'); // VL_OPR
        expect(ed.campos[5]).toBe('300,00'); // VL_BC_ICMS
        expect(ed.campos[6]).toBe('54,00');  // VL_ICMS
    });

    it('NÃO corrige quando C190 já bate (dentro da tolerância de 2 centavos)', () => {
        const parsed = mkParsed([
            { tipo: 'C100', campos: ['', '', '', '', '', '', '777'] },
            c170({ vlItem: '50,00', cst: '000', cfop: '5102', vlBc: '50,00', aliq: '18,00', vlIcms: '9,00' }),
            // C190 com 1 centavo de diferença — dentro da tolerância, não mexe.
            c190({ cst: '000', cfop: '5102', aliq: '18,00', vlOpr: '50,01', vlBc: '50,00', vlIcms: '9,00' }),
        ]);
        const r = corrigirC190(parsed);
        expect(r.resumo.c190Corrigidos).toBe(0);
        expect(r.edicoes).toHaveLength(0);
    });

    it('gera ajuste de/para legível por campo', () => {
        const parsed = mkParsed([
            { tipo: 'C100', campos: ['', '', '', '', '', '', '999'] },
            c170({ vlItem: '100,00', cst: '000', cfop: '5102', vlBc: '100,00', aliq: '18,00', vlIcms: '18,00' }),
            c190({ cst: '000', cfop: '5102', aliq: '18,00', vlOpr: '90,00', vlBc: '100,00', vlIcms: '18,00' }),
        ]);
        const r = corrigirC190(parsed);
        const aj = r.ajustes.find((a: any) => a.campo === 'VL_OPR');
        expect(aj).toBeTruthy();
        expect(aj.de).toBe('90,00');
        expect(aj.para).toBe('100,00');
        expect(aj.doc).toBe('999');
        expect(aj.mensagem).toContain('VL_OPR 90,00 → 100,00');
    });

    it('separa por documento (C100) — não mistura combinações entre docs', () => {
        const parsed = mkParsed([
            { tipo: 'C100', campos: ['', '', '', '', '', '', 'A'] },
            c170({ vlItem: '100,00', cst: '000', cfop: '5102', vlBc: '0', aliq: '18,00', vlIcms: '0' }),
            c190({ cst: '000', cfop: '5102', aliq: '18,00', vlOpr: '100,00', vlBc: '0,00', vlIcms: '0,00' }),
            { tipo: 'C100', campos: ['', '', '', '', '', '', 'B'] },
            c170({ vlItem: '500,00', cst: '000', cfop: '5102', vlBc: '0', aliq: '18,00', vlIcms: '0' }),
            // doc B C190 errado (200 em vez de 500)
            c190({ cst: '000', cfop: '5102', aliq: '18,00', vlOpr: '200,00', vlBc: '0,00', vlIcms: '0,00' }),
        ]);
        const r = corrigirC190(parsed);
        // Só o doc B corrige (doc A já batia). 1 C190, 1 campo (VL_OPR).
        expect(r.resumo.c190Corrigidos).toBe(1);
        expect(r.ajustes[0].doc).toBe('B');
        expect(r.ajustes[0].para).toBe('500,00');
    });

    it('cria C190 faltante quando existe C170 sem totalizador', () => {
        const parsed = mkParsed([
            { tipo: 'C100', campos: ['', '', '', '', '', '', '777'] },
            c170({ vlItem: '100,00', cst: '000', cfop: '5102', vlBc: '100,00', aliq: '18,00', vlIcms: '18,00' }),
        ]);
        const r = corrigirC190(parsed);
        expect(r.resumo.c190Criados).toBe(1);
        expect(r.resumo.c190Corrigidos).toBe(0);
        expect(r.edicoes[0]).toMatchObject({
            insertAfterIdx: 1,
            campos: ['C190', '000', '5102', '18,00', '100,00', '100,00', '18,00', '0,00', '0,00', '0,00', '0,00', ''],
        });
        expect(r.ajustes[0].mensagem).toContain('C190 faltante criado');
    });

    it('C190 sem C170 correspondente não é corrigido, mas cria o totalizador faltante do C170 real', () => {
        const parsed = mkParsed([
            { tipo: 'C100', campos: ['', '', '', '', '', '', 'X'] },
            c170({ vlItem: '100,00', cst: '000', cfop: '5102', vlBc: '0', aliq: '18,00', vlIcms: '0' }),
            // C190 de combinação que não existe em nenhum C170
            c190({ cst: '000', cfop: '6108', aliq: '12,00', vlOpr: '999,00', vlBc: '0,00', vlIcms: '0,00' }),
        ]);
        const r = corrigirC190(parsed);
        expect(r.resumo.c190Corrigidos).toBe(0);
        expect(r.resumo.c190Criados).toBe(1);
    });

    it('não aplica em SPED de Contribuições (C190 é EFD ICMS/IPI)', () => {
        const parsed = { tipoSped: 'contribuicoes', linhas: [] };
        const r = corrigirC190(parsed);
        expect(r.edicoes).toHaveLength(0);
        expect(r.resumo.c190Corrigidos).toBe(0);
    });

    it('parsed inválido/vazio não quebra', () => {
        expect(() => corrigirC190(null as any)).not.toThrow();
        expect(() => corrigirC190({} as any)).not.toThrow();
        expect(corrigirC190({ linhas: [] } as any).edicoes).toHaveLength(0);
    });
});
