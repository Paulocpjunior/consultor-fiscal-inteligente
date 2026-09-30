/**
 * 🧾 CRÉDITO DE ICMS DA COMPRA DE FORNECEDOR DO SIMPLES (LC 123/2006, art. 23).
 *
 * Paulo, 30/09, A CASTELLANO · NF 6565 da NATHYPEL (CSOSN 101): "PERMITE O
 * APROVEITAMENTO DO CRÉDITO DE ICMS NO VALOR DE R$ 52,73 CORRESPONDENTE À
 * ALÍQUOTA DE 3,48%" — e a escrituração saía com base e ICMS zero.
 *
 * Fatos cobrados: os três parsers leem `pCredSN`/`vCredICMSSN` (ausente =
 * sem campo); o backfill os recupera; a régua aplica só na compra para
 * comercialização/industrialização e respeita o informado na nota; o CST do
 * declarante substitui o CSOSN (origem do item); o C170/C190 do SPED e o
 * Livro/Resumo/SAGE creditam o mesmo valor; optante do Simples não credita;
 * CST informado "sem crédito" tira; uso/consumo fica fora e DITO; a tela tem
 * o campo por nota.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    creditoSimplesDoItem, cstDeEntradaDoCsosn, creditoSimplesDoTexto, conferirAliquotaCreditoSimples,
    cfopDeComercializacaoOuIndustrializacao, ehItemCsosn,
} from '../sefaz-backend/credito-icms-simples.js';
import { extrairItens } from '../sefaz-backend/xml-importer.js';
import { CAMPOS_RECUPERAVEIS } from '../sefaz-backend/backfill-itens-fiscais.js';
// @ts-expect-error módulo .js puro sem tipos
import { buildBlocoC } from '../sefaz-backend/sped-fiscal-blocoC.js';
import { alocarTributacaoIcms, ctxAlocacaoDoDoc } from '../services/iobSageExportService';

const RAIZ = join(__dirname, '..');
const campos = (l: string) => l.trim().split('|');
const num = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const TEXTO = 'Duplicata - Num.: 001, Venc.: 03/09/2026 - Valor R$ 1.515,10 DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. '
    + 'PERMITE O APROVEITAMENTO DO CRÉDITO DE ICMS  E NO VALOR DE R$ 52.73 CORRESPONDENTE À ALÍQUOTA DE 3.48%. NOS TERMOS DO ART. 23 DA LC 123/2006.';

const itemSn = (extra: Record<string, unknown> = {}) => ({
    nItem: '1', cProd: 'F1', xProd: 'FITA GOMADA SEM REFORCO 60MM', ncm: '48114910', cfop: '5102', unidade: 'KG',
    qCom: 109, vUnCom: 13.9, vProd: 1515.10, vDesc: 0, cst: '101', orig: '0', vBC: 0, vICMS: 0, aliqIcms: 0,
    pCredSN: 3.48, vCredICMSSN: 52.73, ...extra,
});

describe('a régua pura', () => {
    it('XML com pCredSN, compra para industrialização (1101): aplica o crédito do documento', () => {
        const r = creditoSimplesDoItem(itemSn(), { cfopLancado: '1101' });
        expect(r).toMatchObject({ tem: true, aplica: true, vBC: 1515.1, aliq: 3.48, vICMS: 52.73, por: 'xml' });
    });

    it('uso e consumo (1556) e ativo (1551): tem crédito no XML, mas NÃO aplica — e diz o porquê', () => {
        for (const cfop of ['1556', '2556', '1551']) {
            const r = creditoSimplesDoItem(itemSn(), { cfopLancado: cfop });
            expect(r.tem).toBe(true);
            expect(r.aplica).toBe(false);
            expect(r.motivo).toContain(cfop);
        }
        expect(creditoSimplesDoItem(itemSn(), {}).aplica).toBe(false); // sem CFOP não se afirma destino
    });

    it('o INFORMADO na nota vence o XML; 0 = sem crédito; sem nada = sem crédito', () => {
        const semTag = itemSn({ pCredSN: undefined, vCredICMSSN: undefined });
        expect(creditoSimplesDoItem(semTag, { cfopLancado: '1102' }).tem).toBe(false);
        const inf = creditoSimplesDoItem(semTag, { doc: { creditoSimplesInformado: { aliq: 3.48 } }, cfopLancado: '1102' });
        expect(inf).toMatchObject({ tem: true, aplica: true, aliq: 3.48, vICMS: 52.73, por: 'informado' });
        expect(creditoSimplesDoItem(itemSn(), { doc: { creditoSimplesInformado: { aliq: 0 } }, cfopLancado: '1102' }).tem).toBe(false);
        expect(creditoSimplesDoItem(itemSn({ vCredICMSSN: undefined }), { cfopLancado: '1102' }).vICMS).toBeCloseTo(52.73, 2);
    });

    it('os CFOPs de comercialização/industrialização (art. 23 §1º) nas três faixas', () => {
        for (const c of ['1101', '1102', '2102', '3101', '1403', '2401']) expect(cfopDeComercializacaoOuIndustrializacao(c)).toBe(true);
        for (const c of ['1556', '1551', '1407', '5102', '1949', '']) expect(cfopDeComercializacaoOuIndustrializacao(c)).toBe(false);
    });

    it('CSOSN vira CST do declarante com a ORIGEM do item (nunca o 1º dígito do CSOSN)', () => {
        expect(ehItemCsosn(itemSn())).toBe(true);
        expect(ehItemCsosn({ cst: '00' })).toBe(false);
        expect(cstDeEntradaDoCsosn(itemSn(), { creditoAplicado: true })).toBe('000');
        expect(cstDeEntradaDoCsosn(itemSn(), { creditoAplicado: false })).toBe('090');
        expect(cstDeEntradaDoCsosn(itemSn({ orig: '2' }), { creditoAplicado: true })).toBe('200');
        expect(cstDeEntradaDoCsosn(itemSn({ cst: '500' }), {})).toBe('060');
        expect(cstDeEntradaDoCsosn(itemSn({ cst: '201' }), { creditoAplicado: true })).toBe('010');
        expect(cstDeEntradaDoCsosn(itemSn({ orig: '' }), {})).toBeNull();
        expect(cstDeEntradaDoCsosn({ cst: '00', orig: '0' }, {})).toBeNull();
    });

    it('o texto de informações adicionais SUGERE alíquota e valor (e só isso)', () => {
        expect(creditoSimplesDoTexto(TEXTO)).toEqual({ aliq: 3.48, valor: 52.73 });
        expect(creditoSimplesDoTexto('Venda de mercadoria')).toBeNull();
        expect(conferirAliquotaCreditoSimples('3,48')).toEqual({ ok: true, aliq: 3.48 });
        expect(conferirAliquotaCreditoSimples('')).toEqual({ ok: true, aliq: null });
        expect(conferirAliquotaCreditoSimples('0')).toEqual({ ok: true, aliq: 0 });
        expect(conferirAliquotaCreditoSimples('25').ok).toBe(false);
        expect(conferirAliquotaCreditoSimples('abc').ok).toBe(false);
    });
});

describe('a captura lê o crédito do XML e o backfill recupera', () => {
    const det = (icms: string) => `<det nItem="1"><prod><cProd>F1</cProd><xProd>FITA</xProd><NCM>48114910</NCM><CFOP>5102</CFOP><uCom>KG</uCom>`
        + `<qCom>109</qCom><vUnCom>13.90</vUnCom><vProd>1515.10</vProd></prod><imposto><ICMS>${icms}</ICMS></imposto></det>`;

    it('ICMSSN101: pCredSN e vCredICMSSN lidos; ICMS normal: null (ausente ≠ zero)', () => {
        const [sn] = extrairItens(det('<ICMSSN101><orig>0</orig><CSOSN>101</CSOSN><pCredSN>3.4800</pCredSN><vCredICMSSN>52.73</vCredICMSSN></ICMSSN101>'));
        expect(sn).toMatchObject({ cst: '101', orig: '0', pCredSN: 3.48, vCredICMSSN: 52.73 });
        const [normal] = extrairItens(det('<ICMS00><orig>0</orig><CST>00</CST><vBC>1515.10</vBC><pICMS>18</pICMS><vICMS>272.72</vICMS></ICMS00>'));
        expect(normal.pCredSN).toBeNull();
        expect(normal.vCredICMSSN).toBeNull();
    });

    it('o ♻️ Reler itens recupera pCredSN, vCredICMSSN e orig do XML guardado', () => {
        for (const c of ['pCredSN', 'vCredICMSSN', 'orig']) expect(CAMPOS_RECUPERAVEIS).toContain(c);
    });

    it('o parser do navegador e o do SharePoint leem os mesmos dois campos (paridade)', () => {
        for (const arq of ['services/xmlParserService.ts', 'sefaz-backend/sharepoint-auto-sync.js']) {
            const src = readFileSync(join(RAIZ, arq), 'utf8');
            expect(src).toContain("'pCredSN'");
            expect(src).toContain("'vCredICMSSN'");
        }
    });
});

// ─── A escrituração: SPED, Livro, Resumo, SAGE ───────────────────────────────
const nota = (extra: Record<string, unknown> = {}, itemExtra: Record<string, unknown> = {}) => ({
    id: 'n6565', tipo: 'NFe', modelo: '55', direcao: 'entrada', numero: '6565', serie: '1', modFrete: '9', tpNF: '1', status: 'autorizado',
    chave: '35260822919493000109550010000065651300008220', dhEmi: '2026-08-04T07:11:00-03:00', dataEmissao: '2026-08-04',
    cnpjEmit: '22919493000109', cnpjDest: '51227692000146', empresaCnpj: '51227692000146',
    emitente: { cnpjCpf: '22919493000109', nome: 'NATHYPEL', uf: 'SP' }, destinatario: { cnpjCpf: '51227692000146' },
    totais: { vNF: 1515.10, vProd: 1515.10, vDesc: 0, vBC: 0, vICMS: 0 },
    cfopEscriturado: '1101',
    itens: [itemSn(itemExtra)], infAdic: TEXTO, ...extra,
});
const gerar = (n: any, regime = 'LUCRO_PRESUMIDO') => {
    const warnings: string[] = [];
    const linhas: string[] = buildBlocoC({
        empresa: { cnpj: '51227692000146', dadosFiscais: { uf: 'SP' } }, regimeEscrituracao: regime,
        competencia: '2026-08', notas: [n], warnings,
    });
    return { linhas, warnings, c170: campos(linhas.find((l) => l.startsWith('|C170|')) as string), c190: campos(linhas.find((l) => l.startsWith('|C190|')) as string) };
};

describe('SPED ICMS/IPI: C170/C190 com o crédito do Simples e CST do declarante', () => {
    it('Lucro, compra para industrialização: CST 000, base 1.515,10, alíquota 3,48, ICMS 52,73 — C190 igual', () => {
        const { c170, c190, warnings } = gerar(nota());
        expect(c170[10]).toBe('000');
        expect(num(c170[13])).toBeCloseTo(1515.10, 2);
        expect(num(c170[14])).toBeCloseTo(3.48, 2);
        expect(num(c170[15])).toBeCloseTo(52.73, 2);
        expect(c190[2]).toBe('000');
        expect(num(c190[6])).toBeCloseTo(1515.10, 2);
        expect(num(c190[7])).toBeCloseTo(52.73, 2);
        expect(warnings.some((w) => /Crédito do Simples \(LC 123, art\. 23\)/.test(w))).toBe(true);
    });

    it('comprador optante do Simples: não credita (CST 090, zeros)', () => {
        const { c170 } = gerar(nota(), 'SIMPLES');
        expect(c170[10]).toBe('090');
        expect(num(c170[15])).toBe(0);
    });

    it('CST 90 informado na nota: a pessoa disse "sem crédito" — zeros', () => {
        const { c170 } = gerar(nota({ cstEscriturado: '90' }));
        expect(c170[10]).toBe('090');
        expect(num(c170[15])).toBe(0);
    });

    it('lançada como uso e consumo (1556): sem crédito, CST 090, e o aviso diz que não foi aproveitado', () => {
        const { c170, warnings } = gerar(nota({ cfopEscriturado: '1556' }));
        expect(c170[10]).toBe('090');
        expect(num(c170[15])).toBe(0);
        expect(warnings.some((w) => /NÃO aproveitado/.test(w))).toBe(true);
    });

    it('XML sem pCredSN + alíquota INFORMADA na nota: o C170 credita pelo informado', () => {
        const { c170 } = gerar(nota({ creditoSimplesInformado: { aliq: 3.48 } }, { pCredSN: undefined, vCredICMSSN: undefined }));
        expect(num(c170[15])).toBeCloseTo(52.73, 2);
    });
});

describe('Livro / Resumo por CFOP / SAGE: o mesmo crédito pela mesma régua', () => {
    const ctx = { regimeTributario: 'LUCRO_PRESUMIDO', naturezaAtividade: 'industria' } as any;

    it('Lucro: base 1.515,10, ICMS 52,73, alíquota 3,48', () => {
        const d = nota() as any;
        const a = alocarTributacaoIcms(d.itens, 1515.10, ctxAlocacaoDoDoc(d, ctx));
        expect(a.base).toBeCloseTo(1515.10, 2);
        expect(a.icms).toBeCloseTo(52.73, 2);
        expect(a.aliquota).toBeCloseTo(3.48, 2);
    });

    it('Simples: sem crédito — o item vai para Outras', () => {
        const d = nota() as any;
        const a = alocarTributacaoIcms(d.itens, 1515.10, ctxAlocacaoDoDoc(d, { ...ctx, regimeTributario: 'SIMPLES' }));
        expect(a.base).toBe(0);
        expect(a.icms).toBe(0);
        expect(a.outras).toBeCloseTo(1515.10, 2);
    });

    it('uso e consumo informado: sem crédito', () => {
        const d = nota({ cfopEscriturado: '1556' }) as any;
        const a = alocarTributacaoIcms(d.itens, 1515.10, ctxAlocacaoDoDoc(d, ctx));
        expect(a.icms).toBe(0);
    });
});

describe('a tela tem o campo por nota, gravado pelo dono', () => {
    it('o detalhe da nota oferece informar/ajustar o crédito e o serviço confere pelo dono', () => {
        const detalhe = readFileSync(join(RAIZ, 'components/xml/XmlDocumentoDetalhe.tsx'), 'utf8');
        const servico = readFileSync(join(RAIZ, 'services/xmlFiscalService.ts'), 'utf8');
        expect(detalhe).toContain('definirCreditoSimplesDaNota(');
        expect(detalhe).toContain('creditoSimplesDoTexto(');
        expect(servico).toContain('conferirAliquotaCreditoSimples(');
        expect(servico).toContain('creditoSimplesInformado');
    });
});
