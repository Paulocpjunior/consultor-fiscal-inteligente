/**
 * 🧾 IMPOSTOS DO ITEM NA NOTA DIGITADA — a linha do SAGE (Paulo, 29/09, com o
 * print do E-Fiscal: "Base ICMS 276.135,22 · Alíq. 18,0000 · Vlr. ICMS
 * 49.704,34 · Base Subst. Trib. · ICMS Subst. Trib." e o IPI): *"nesse lugar
 * onde lançamos manual precisa ter os campos BASE DE ICMS / ALIQUOTA / VALOR
 * DE ICMS - BASE SUBST TRIB. / ICMS SUBST. TRIB. - BASE IPI / VLR. IPI"*.
 *
 * Fatos cobrados: o item guarda o que foi informado e NADA do que não foi
 * (ausente ≠ zero); os totais do documento são a soma do informado e não
 * existem quando ninguém informou; o C170 do EFD ICMS/IPI e o do
 * EFD-Contribuições escrevem base, alíquota, ICMS, ST e IPI do item; a tela
 * tem os sete campos.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { montarNotaDigitada, impostosInformados, totaisDosImpostos, IMPOSTOS_DO_ITEM } from '../services/notaDigitada';
import { buildBlocoC_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-expect-error módulo .js puro sem tipos
import { buildBlocoC } from '../sefaz-backend/sped-fiscal-blocoC.js';

const RAIZ = join(__dirname, '..');
const campos = (l: string) => l.trim().split('|');
const num = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

const base = (itens: any[]) => ({
    empresaId: 'emp1', empresaCnpj: '51227692000146', empresaNome: 'A CASTELLANO', direcao: 'entrada' as const,
    numero: '55435', serie: '826', dhEmi: '2018-06-13', participanteNome: 'CENTRAL MESH', participanteDoc: '07141537000110', participanteUf: 'SP',
    valorTotal: 276135.22, itens, digitadaPorEmail: 'sandra@sp.com', createdByUid: 'uid1',
});
const itemSage = { cfop: '1101', ncm: '84749000', xProd: 'ELEM.FILT.TELA', vProd: 276135.22, vBC: 276135.22, aliqIcms: 18, vICMS: 49704.34 };

describe('o item guarda só o que foi informado', () => {
    it('base, alíquota e ICMS informados entram; ST e IPI não informados ficam FORA (não viram zero)', () => {
        const doc = montarNotaDigitada(base([itemSage]) as any) as any;
        const it = doc.itens[0];
        expect(it).toMatchObject({ vBC: 276135.22, aliqIcms: 18, vICMS: 49704.34 });
        for (const c of ['vBCST', 'vICMSST', 'vBCIPI', 'vIPI']) expect(c in it).toBe(false);
        expect(doc.totais).toEqual({ vNF: 276135.22, vBC: 276135.22, vICMS: 49704.34 });
    });

    it('sem imposto nenhum: item e totais como antes (só vNF)', () => {
        const doc = montarNotaDigitada(base([{ cfop: '1101', vProd: 100 }]) as any) as any;
        expect(doc.totais).toEqual({ vNF: 276135.22 });
        for (const c of IMPOSTOS_DO_ITEM) expect(c in doc.itens[0]).toBe(false);
    });

    it('os totais somam o informado de vários itens; ST vai em vST e alíquota não soma', () => {
        const t = totaisDosImpostos([
            { cfop: '1101', vProd: 100, vBC: 100, aliqIcms: 18, vICMS: 18, vBCST: 50, vICMSST: 9, vBCIPI: 100, vIPI: 5 },
            { cfop: '1101', vProd: 200, vBC: 200, aliqIcms: 12, vICMS: 24, vIPI: 10.005 },
        ]);
        expect(t).toEqual({ vBC: 300, vICMS: 42, vBCST: 50, vST: 9, vIPI: 15.01 });
        expect(impostosInformados({ cfop: '1101', vProd: 1, vICMS: 0 })).toEqual({ vICMS: 0 }); // zero DIGITADO é resposta
        expect(impostosInformados({ cfop: '1101', vProd: 1 })).toEqual({});
    });
});

describe('o C170 escreve os impostos digitados do item', () => {
    const itemCompleto = { ...itemSage, vBCST: 1000, vICMSST: 180, vBCIPI: 276135.22, vIPI: 2761.35 };

    it('EFD ICMS/IPI: base, alíquota, ICMS, base ST, ICMS ST, base IPI e IPI', () => {
        const doc = montarNotaDigitada(base([itemCompleto]) as any) as any;
        const linhas: string[] = buildBlocoC({ empresa: { cnpj: '51227692000146', dadosFiscais: { uf: 'SP' } }, competencia: '2018-06', notas: [{ ...doc, modFrete: '9' }], warnings: [] });
        const c = campos(linhas.find((l) => l.startsWith('|C170|')) as string);
        expect(num(c[13])).toBeCloseTo(276135.22, 2); // VL_BC_ICMS
        expect(num(c[14])).toBeCloseTo(18, 2);        // ALIQ_ICMS
        expect(num(c[15])).toBeCloseTo(49704.34, 2);  // VL_ICMS
        expect(num(c[16])).toBeCloseTo(1000, 2);      // VL_BC_ICMS_ST
        expect(num(c[18])).toBeCloseTo(180, 2);       // VL_ICMS_ST
        expect(num(c[22])).toBeCloseTo(276135.22, 2); // VL_BC_IPI
        expect(num(c[24])).toBeCloseTo(2761.35, 2);   // VL_IPI
        const c100 = campos(linhas.find((l) => l.startsWith('|C100|')) as string);
        expect(num(c100[21])).toBeCloseTo(276135.22, 2); // VL_BC_ICMS do cabeçalho pelos totais
        expect(num(c100[22])).toBeCloseTo(49704.34, 2);  // VL_ICMS
    });

    it('EFD-Contribuições: os mesmos campos do C170', () => {
        const doc = montarNotaDigitada(base([itemCompleto]) as any) as any;
        const linhas: string[] = buildBlocoC_Contrib({ empresa: { cnpj: '51227692000146' }, notas: [{ ...doc, modFrete: '9' }], regimeApuracao: '1', warnings: [] });
        const c = campos(linhas.find((l) => l.startsWith('|C170|')) as string);
        expect(num(c[13])).toBeCloseTo(276135.22, 2);
        expect(num(c[14])).toBeCloseTo(18, 2);
        expect(num(c[15])).toBeCloseTo(49704.34, 2);
        expect(num(c[16])).toBeCloseTo(1000, 2);
        expect(num(c[18])).toBeCloseTo(180, 2);
        expect(num(c[22])).toBeCloseTo(276135.22, 2);
        expect(num(c[24])).toBeCloseTo(2761.35, 2);
    });
});

describe('a tela tem os sete campos do item', () => {
    it('o formulário oferece cada imposto do item e o manda pelo mesmo nome que o montador lê', () => {
        const form = readFileSync(join(RAIZ, 'components/xml/NotaDigitadaForm.tsx'), 'utf8');
        expect(form).toContain('IMPOSTOS_DO_ITEM.map(');
        for (const c of IMPOSTOS_DO_ITEM) expect(form).toContain(`${c}Texto`);
        expect(form).toMatch(/Base ICMS ST/);
        expect(form).toMatch(/Base IPI/);
    });
});
