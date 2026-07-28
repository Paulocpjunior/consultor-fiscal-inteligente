/**
 * RBT12 que define a FAIXA do Simples — caso JD DE SOUZA ITAPEVI (Anexo IV,
 * PA 06/2026), conferido contra o extrato oficial do PGDAS-D.
 *
 * Extrato:
 *   RPA (06/2026) ............ 60.275,50
 *   RBT12 .................... 635.302,87
 *   Anexo IV, 3ª faixa (10,20% − 12.420) → alíquota efetiva 8,245027%
 *   IRPJ 1.033,70 · CSLL 755,40 · COFINS 980,53 · PIS 212,21 · ISS 0,00
 *   Total do débito .......... 2.981,84
 *
 * O ISS zera porque a atividade (construção civil, subitens 7.02/7.05) está
 * com retenção/substituição — e a regra é a que o Paulo enunciou:
 *   ISS = alíquota efetiva × percentual de ISS do Anexo IV (40% na 3ª faixa).
 * O que sai do DAS é exatamente essa parcela; os federais continuam devidos.
 *
 * O app cobrava R$ 3.012,58 porque enquadrava por uma base inflada
 * (664.180,87) vinda do detalhamento por CNAE, e não pelo RBT12.
 */

jest.mock('../services/firebaseConfig', () => ({ db: null, auth: null, isFirebaseConfigured: false }));
jest.mock('firebase/firestore', () => ({
    collection: jest.fn(), getDocs: jest.fn(), doc: jest.fn(),
    setDoc: jest.fn(), getDoc: jest.fn(), query: jest.fn(),
    where: jest.fn(), deleteDoc: jest.fn(),
}));
jest.mock('../services/geminiService', () => ({
    extractDocumentData: jest.fn(), extractPgdasDataFromPdf: jest.fn(),
}));
jest.mock('../services/pgdasPdfParser', () => ({ parsePgdasExtrato: jest.fn() }));
jest.mock('../services/empresaUniquenessService', () => ({
    verificarCnpjDuplicado: jest.fn(), mensagemCnpjDuplicado: jest.fn(),
}));

import { calcularResumoEmpresa } from '../services/simplesNacionalService';
import type { SimplesNacionalEmpresa } from '../types';

const MESES_RBT12: Record<string, number> = {
    '2025-06': 46_707.00, '2025-07': 38_737.58, '2025-08': 57_222.00,
    '2025-09': 78_166.29, '2025-10': 60_965.00, '2025-11': 41_135.00,
    '2025-12': 42_350.00, '2026-01': 38_342.00, '2026-02': 73_480.00,
    '2026-03': 23_100.00, '2026-04': 53_110.00, '2026-05': 81_988.00,
};
const RPA = 60_275.50;
const RBT12 = 635_302.87;
const PA = new Date(2026, 5, 1); // junho/2026

/** Serviço do Anexo IV com ISS retido/substituído, como no extrato. */
const detalheDoMes = (issRetido: boolean) => ({
    'serv::x::4120400::IV': { valor: RPA, issRetido, icmsSt: false, isSup: false, isMonofasico: false, isImune: false, isExterior: false },
});

const empresa = (over: Partial<SimplesNacionalEmpresa> = {}) => ({
    id: 'jd', nome: 'JD DE SOUZA ITAPEVI', cnpj: '03341363000189',
    cnae: '4120400', anexo: 'IV', folha12: 0,
    faturamentoManual: { ...MESES_RBT12, '2026-06': RPA },
    faturamentoMensalDetalhado: { '2026-06': detalheDoMes(true) },
    ...over,
}) as unknown as SimplesNacionalEmpresa;

describe('CASO REAL — JD DE SOUZA ITAPEVI, PA 06/2026 (Anexo IV)', () => {
    it('o RBT12 é a soma dos 12 meses anteriores: R$ 635.302,87', () => {
        const r = calcularResumoEmpresa(empresa(), [], PA);
        expect(r.rbt12).toBeCloseTo(RBT12, 2);
        expect(r.rbt12Interno).toBeCloseTo(RBT12, 2);
        expect(r.rbt12Externo).toBe(0);
    });

    it('com ISS retido, o DAS bate com o extrato: R$ 2.981,84', () => {
        const r = calcularResumoEmpresa(empresa(), [], PA);
        expect(r.das_mensal).toBeCloseTo(2_981.84, 2);
    });

    it('sem retenção, o ISS entra e o DAS é o total cheio (R$ 4.969,73)', () => {
        // Prova a fórmula: o que a retenção tira é exatamente
        // alíquota efetiva × 40% (ISS da 3ª faixa do Anexo IV).
        const semRetencao = calcularResumoEmpresa(
            empresa({ faturamentoMensalDetalhado: { '2026-06': detalheDoMes(false) } } as any), [], PA);
        expect(semRetencao.das_mensal).toBeCloseTo(4_969.73, 2);

        const comRetencao = calcularResumoEmpresa(empresa(), [], PA);
        const iss = semRetencao.das_mensal - comRetencao.das_mensal;
        const aliqEfetiva = ((RBT12 * 0.102) - 12_420) / RBT12;
        expect(iss).toBeCloseTo(RPA * aliqEfetiva * 0.40, 2);
    });

    it('REGRESSÃO: detalhamento somando MAIS que o total do mês não infla a faixa', () => {
        // Era a causa: R$ 28.878,00 a mais no detalhamento de um mês entravam
        // no RBT12 interno (o que enquadra) e o DAS ia a R$ 3.012,58.
        const inflada = empresa({
            faturamentoMensalDetalhado: {
                '2026-06': detalheDoMes(true),
                // mês com total 53.110,00 e detalhamento de 81.988,00
                '2026-04': { 'a::x::4120400::IV': { valor: 81_988.00 } },
            },
        } as any);
        const r = calcularResumoEmpresa(inflada, [], PA);
        expect(r.rbt12).toBeCloseTo(RBT12, 2);
        expect(r.rbt12Interno).toBeCloseTo(RBT12, 2);
        expect(r.das_mensal).toBeCloseTo(2_981.84, 2);
        expect(r.das_mensal).not.toBeCloseTo(3_012.58, 2);
    });
});

describe('invariantes do RBT12', () => {
    it('interno + externo é SEMPRE igual ao global', () => {
        const r = calcularResumoEmpresa(empresa({
            faturamentoMensalDetalhado: {
                '2026-06': detalheDoMes(true),
                '2026-05': {
                    'int::x::4120400::IV': { valor: 50_000 },
                    'ext::x::4120400::IV': { valor: 31_988, isExterior: true },
                },
            },
        } as any), [], PA);
        expect(r.rbt12Interno + r.rbt12Externo).toBeCloseTo(r.rbt12, 2);
        expect(r.rbt12Externo).toBeCloseTo(31_988, 2);
        expect(r.rbt12).toBeCloseTo(RBT12, 2);
    });

    it('exterior maior que o total do mês não vira receita negativa no interno', () => {
        const r = calcularResumoEmpresa(empresa({
            faturamentoMensalDetalhado: {
                '2026-06': detalheDoMes(true),
                '2026-03': { 'ext::x::4120400::IV': { valor: 999_999, isExterior: true } },
            },
        } as any), [], PA);
        expect(r.rbt12Interno).toBeGreaterThanOrEqual(0);
        expect(r.rbt12Interno + r.rbt12Externo).toBeCloseTo(r.rbt12, 2);
    });

    it('mês sem total lançado usa a soma do detalhamento', () => {
        const semTotal = { ...MESES_RBT12 } as Record<string, number>;
        delete semTotal['2026-02']; // 73.480,00 só no detalhamento
        const r = calcularResumoEmpresa(empresa({
            faturamentoManual: { ...semTotal, '2026-06': RPA },
            faturamentoMensalDetalhado: {
                '2026-06': detalheDoMes(true),
                '2026-02': { 'a::x::4120400::IV': { valor: 73_480.00 } },
            },
        } as any), [], PA);
        expect(r.rbt12).toBeCloseTo(RBT12, 2);
    });
});
