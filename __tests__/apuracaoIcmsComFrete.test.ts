/**
 * 🚚 O ICMS DO FRETE (D190) ENTRA NA APURAÇÃO — E110 e RAICMS.
 *
 * Paulo, 30/09, A CASTELLANO · 08/2026: *"não está pegando o ICMS do 1352 —
 * CT-e"*. O Resumo por CFOP mostrava o frete com R$ 346,67 de ICMS e a
 * apuração declarava 62.509,90 de crédito — exatamente 346,67 a menos que a
 * soma das entradas (62.041,97 + 346,67 + 467,93).
 *
 * 📖 Guia 3.2.3, E110 campos 02/06: soma do VL_ICMS dos C190, C590, D190, D590,
 * D730 pelo CFOP. O app somava só o bloco C.
 *
 * Fatos cobrados: o crédito do CT-e tomado soma na apuração (RAICMS/E110) e no
 * E110 do arquivo; CST informado 90 e CT-e de terceiro não somam (a mesma
 * régua do D190); a pré-validação confere C190 + D190 e não acusa o arquivo
 * certo.
 */
import { apurarIcmsProprio } from '../sefaz-backend/apuracao-icms-raicms.js';
// @ts-expect-error módulo .js puro sem tipos
import { somarIcmsDoBlocoD } from '../sefaz-backend/sped-fiscal-blocoD.js';
// @ts-expect-error módulo .js puro sem tipos
import { buildBlocoE } from '../sefaz-backend/sped-fiscal-blocoE.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';

const EMPRESA = '51227692000146';
const campos = (l: string) => l.trim().split('|');
const num = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

const compra = () => ({
    id: 'n1', tipo: 'NFe', modelo: '55', direcao: 'entrada', numero: '1', serie: '1', status: 'autorizado', modFrete: '9',
    chave: '35260800000000000100550010000000011000000011', dhEmi: '2026-08-10', cnpjEmit: '00000000000100', cnpjDest: EMPRESA,
    empresaCnpj: EMPRESA, emitente: { cnpjCpf: '00000000000100', nome: 'FORNECEDOR', uf: 'SP' }, destinatario: { cnpjCpf: EMPRESA },
    cfopEscriturado: '1101', totais: { vNF: 1000, vProd: 1000, vBC: 1000, vICMS: 180 },
    itens: [{ nItem: '1', cfop: '5101', cst: '00', orig: '0', vProd: 1000, vDesc: 0, vBC: 1000, aliqIcms: 18, vICMS: 180 }],
});
const cte = (extra: Record<string, unknown> = {}) => ({
    id: 'c1', tipoDoc: 'CTe', tipo: 'CTe', modelo: '57', direcao: 'entrada', numero: '99', status: 'autorizado',
    chave: '35260844555666000177570010000000991234567890', dhEmi: '2026-08-12', cnpjEmit: '44555666000177',
    cnpjDest: EMPRESA, empresaCnpj: EMPRESA, cnpjTomadorCte: EMPRESA, cfop: '5352', cstIcms: '00', aliqIcms: 12,
    valorTotal: 2888.95, totais: { vBC: 2888.95, vICMS: 346.67 }, codMunIniCte: '3550308', codMunFimCte: '3550308',
    ...extra,
});
const dados = (notas: any[]) => ({
    empresa: { cnpj: EMPRESA, _regime: 'lucro', dadosFiscais: { uf: 'SP' } },
    regimeEscrituracao: 'LUCRO_PRESUMIDO', competencia: '2026-08', competenciaFim: '2026-08',
    notas, ajustesApuracao: [], saldoCredorIcmsAnterior: 0, warnings: [] as string[],
});

describe('a apuração soma o ICMS do frete tomado (D190) ao do bloco C', () => {
    it('RAICMS/E110: crédito = 180,00 da compra + 346,67 do CT-e', () => {
        const d = dados([compra(), cte()]);
        expect(somarIcmsDoBlocoD(d.notas, 'entrada', d)).toBeCloseTo(346.67, 2);
        expect(apurarIcmsProprio(d).ap.vlTotCreditos).toBeCloseTo(526.67, 2);
    });

    it('CST 90 informado no CT-e ("sem crédito") e CT-e de terceiro não somam — a mesma régua do D190', () => {
        const d90 = dados([compra(), cte({ cstEscriturado: '90' })]);
        expect(apurarIcmsProprio(d90).ap.vlTotCreditos).toBeCloseTo(180, 2);
        const dTerc = dados([compra(), cte({ cnpjTomadorCte: '07141537000110' })]);
        expect(apurarIcmsProprio(dTerc).ap.vlTotCreditos).toBeCloseTo(180, 2);
    });

    it('o E110 do ARQUIVO declara o mesmo crédito', () => {
        const d = dados([compra(), cte()]);
        const linhas: string[] = buildBlocoE(d);
        const e110 = campos(linhas.find((l) => l.startsWith('|E110|')) as string);
        expect(num(e110[6])).toBeCloseTo(526.67, 2);
    });
});

describe('a pré-validação confere C190 + D190 (regra literal do PVA)', () => {
    const arquivo = (e110Creditos: string) => [
        '|0000|017|0|01082026|31082026|A CASTELLANO|51227692000146||SP|103460625111|3550308|||A|1|',
        '|C100|0|1|00000000000100|55|00|001|1|35260800000000000100550010000000011000000011|10082026|10082026|1000,00|0|0,00|0,00|1000,00|9|0,00|0,00|0,00|1000,00|180,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|',
        '|C190|000|1101|18,00|1000,00|1000,00|180,00|0,00|0,00|0,00|0,00||',
        '|D100|0|1|44555666000177|57|00|001||99|35260844555666000177570010000000991234567890|12082026|12082026|0||2888,95|0,00|9|2888,95|2888,95|346,67|0,00|||3550308|3550308|',
        '|D190|000|1352|12,00|2888,95|2888,95|346,67|||',
        `|E110|0,00|0,00|0,00|0,00|${e110Creditos}|0,00|0,00|0,00|0,00|0,00|0,00|0,00|${e110Creditos}|0,00|`,
    ];
    const errosE110 = (linhas: string[]) => (prevalidarSpedFiscal(linhas).erros || []).filter((e: any) => e.regra === 'e110-creditos');

    it('E110 = C190 + D190 (526,67): sem acusação', () => {
        expect(errosE110(arquivo('526,67'))).toEqual([]);
    });

    it('E110 só com o C190 (180,00): acusa, com o esperado 526,67', () => {
        const e = errosE110(arquivo('180,00'));
        expect(e).toHaveLength(1);
        expect(e[0].esperado).toBe('526.67');
    });
});
