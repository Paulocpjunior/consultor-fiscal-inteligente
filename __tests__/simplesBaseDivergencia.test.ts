/**
 * Varredura das bases do Simples — quem estava pagando a maior pelo RBT12
 * inflado (detalhamento por CNAE somando acima do total lançado).
 *
 * Ancorada no caso real JD DE SOUZA ITAPEVI (Anexo IV, 06/2026): base correta
 * 635.302,87 × base usada 664.180,87 → DAS 2.981,84 × 3.012,58.
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

import { analisarDivergenciaBase, varrerBasesSimples } from '../services/simplesBaseDivergencia';
import type { SimplesNacionalEmpresa } from '../types';

const MESES: Record<string, number> = {
    '2025-06': 46_707.00, '2025-07': 38_737.58, '2025-08': 57_222.00,
    '2025-09': 78_166.29, '2025-10': 60_965.00, '2025-11': 41_135.00,
    '2025-12': 42_350.00, '2026-01': 38_342.00, '2026-02': 73_480.00,
    '2026-03': 23_100.00, '2026-04': 53_110.00, '2026-05': 81_988.00,
};
const RPA = 60_275.50;
const PA = new Date(2026, 5, 1);

const detalheMes = () => ({
    'serv::x::4120400::IV': { valor: RPA, issRetido: true },
});

const empresa = (over: any = {}) => ({
    id: 'jd', nome: 'JD DE SOUZA ITAPEVI', cnpj: '03.341.363/0001-89',
    cnae: '4120400', anexo: 'IV', folha12: 0,
    faturamentoManual: { ...MESES, '2026-06': RPA },
    faturamentoMensalDetalhado: { '2026-06': detalheMes() },
    ...over,
}) as unknown as SimplesNacionalEmpresa;

/** Empresa com o detalhamento de 04/2026 somando 28.878,00 a mais. */
const empresaInflada = () => empresa({
    faturamentoMensalDetalhado: {
        '2026-06': detalheMes(),
        '2026-04': { 'a::x::4120400::IV': { valor: 81_988.00 } }, // total do mês: 53.110,00
    },
});

describe('detecção da divergência', () => {
    it('empresa sem detalhamento acima do total não aparece', () => {
        expect(analisarDivergenciaBase(empresa(), PA)).toBeNull();
    });

    it('acha o mês, o excedente e as duas bases', () => {
        const r = analisarDivergenciaBase(empresaInflada(), PA)!;
        expect(r.meses).toHaveLength(1);
        expect(r.meses[0]).toMatchObject({ competencia: '2026-04', total: 53_110, detalhado: 81_988 });
        expect(r.meses[0]!.excedente).toBeCloseTo(28_878, 2);
        expect(r.rbt12Correto).toBeCloseTo(635_302.87, 2);
        expect(r.rbt12Antigo).toBeCloseTo(664_180.87, 2);
        expect(r.excedente).toBeCloseTo(28_878, 2);
    });

    it('mede o impacto em R$ recalculando nas DUAS bases (nada de regra de três)', () => {
        const r = analisarDivergenciaBase(empresaInflada(), PA)!;
        expect(r.dasCorreto).toBeCloseTo(2_981.84, 2);   // extrato do PGDAS-D
        expect(r.dasAntigo).toBeCloseTo(3_012.58, 2);    // o que o app mostrava
        expect(r.diferenca).toBeCloseTo(30.74, 2);
    });

    it('detalhamento MENOR que o total não é divergência (nunca inflou nada)', () => {
        const menor = empresa({
            faturamentoMensalDetalhado: {
                '2026-06': detalheMes(),
                '2026-04': { 'a::x::4120400::IV': { valor: 10_000 } },
            },
        });
        expect(analisarDivergenciaBase(menor, PA)).toBeNull();
    });

    it('mês sem total lançado não vira divergência (o detalhamento É o total)', () => {
        const semTotal = { ...MESES } as Record<string, number>;
        delete semTotal['2026-02'];
        const e = empresa({
            faturamentoManual: { ...semTotal, '2026-06': RPA },
            faturamentoMensalDetalhado: {
                '2026-06': detalheMes(),
                '2026-02': { 'a::x::4120400::IV': { valor: 73_480 } },
            },
        });
        expect(analisarDivergenciaBase(e, PA)).toBeNull();
    });
});

describe('varredura da carteira', () => {
    it('lista só as afetadas, pior primeiro, e soma o impacto', () => {
        const outra = { ...empresaInflada(), id: 'x2', nome: 'OUTRA LTDA' } as SimplesNacionalEmpresa;
        const r = varrerBasesSimples([empresa(), empresaInflada(), outra], PA);
        expect(r.total).toBe(3);
        expect(r.afetadas).toHaveLength(2);
        expect(r.impactoTotal).toBeCloseTo(61.48, 2);
        expect(r.farol).toBe('atencao');
        expect(r.resumo).toMatch(/2 empresa\(s\) com detalhamento acima do total/);
    });

    it('carteira limpa é verde e diz isso', () => {
        const r = varrerBasesSimples([empresa()], PA);
        expect(r.afetadas).toHaveLength(0);
        expect(r.farol).toBe('ok');
        expect(r.resumo).toMatch(/Nenhuma divergência/);
    });

    it('cadastro quebrado não derruba a varredura inteira', () => {
        const r = varrerBasesSimples([null as any, empresaInflada()], PA);
        expect(r.afetadas).toHaveLength(1);
    });
});
