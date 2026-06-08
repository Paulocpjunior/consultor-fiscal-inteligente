/**
 * Teste do Fator R com janela movel de 12 meses (folhaMensal).
 *
 * Antes: empresa.folha12 era valor unico congelado. Empresa com folha
 * variavel ao longo do ano ficava com Fator R errado, pulando entre
 * Anexo III e V indevidamente.
 *
 * Agora: se folhaMensal estiver definido, soma os 12 meses anteriores
 * a competencia (LC 123/06 art. 18 §5o-M).
 */

jest.mock('../services/firebaseConfig', () => ({
    db: null,
    auth: null,
    isFirebaseConfigured: false,
}));
jest.mock('firebase/firestore', () => ({
    collection: jest.fn(), getDocs: jest.fn(), doc: jest.fn(),
    setDoc: jest.fn(), getDoc: jest.fn(), query: jest.fn(),
    where: jest.fn(), deleteDoc: jest.fn(),
}));
jest.mock('../services/geminiService', () => ({
    extractDocumentData: jest.fn(),
    extractPgdasDataFromPdf: jest.fn(),
}));
jest.mock('../services/pgdasPdfParser', () => ({
    parsePgdasExtrato: jest.fn(),
}));
jest.mock('../services/empresaUniquenessService', () => ({
    verificarCnpjDuplicado: jest.fn().mockResolvedValue({ duplicado: false }),
    mensagemCnpjDuplicado: jest.fn(),
}));

import { calcularResumoEmpresa } from '../services/simplesNacionalService';
import type { SimplesNacionalEmpresa } from '../types';

const empresaBase: SimplesNacionalEmpresa = {
    id: 'emp1',
    nome: 'Servicos Variaveis Ltda',
    cnpj: '11.222.333/0001-81',
    cnae: '7311-4/00',
    anexo: 'III_V',     // Fator R decide entre III e V
    folha12: 0,
    faturamentoManual: {},
};

/**
 * Gera serie de faturamento para os N meses ANTERIORES a competencia
 * (mesBase, anoBase). O proprio mes da competencia nao entra (RBT12 olha
 * para tras). Ex: gerarSerie(50k, 12, 2026, 6) -> jun/2025 a mai/2026.
 */
function gerarSerie(receitaMensal: number, qtdMeses: number, anoBase: number, mesBase: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (let i = 1; i <= qtdMeses; i++) {
        const d = new Date(anoBase, mesBase - 1 - i, 1);
        const k = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        out[k] = receitaMensal;
    }
    return out;
}

describe('Fator R - folha12 (legado)', () => {
    it('usa folha12 unica quando folhaMensal nao existe', () => {
        const empresa = {
            ...empresaBase,
            folha12: 168_000,   // 28% de 600k
            faturamentoManual: gerarSerie(50_000, 12, 2026, 6),  // 12 meses x 50k = 600k
        };
        const r = calcularResumoEmpresa(empresa, [], new Date(2026, 5, 1));
        expect(r.fator_r).toBeCloseTo(0.28, 2);
        // Anexo III_V com fator_r >= 28% vira III
        expect(r.anexo_efetivo).toBe('III_V');
    });
});

describe('Fator R - folhaMensal (janela movel)', () => {
    it('soma exatamente os 12 meses anteriores a competencia', () => {
        // 12 meses anteriores a 06/2026 = 06/2025 a 05/2026.
        const folhaMensal: Record<string, number> = {};
        for (let i = 0; i < 12; i++) {
            const d = new Date(2026, 4 - i, 1);  // mai/2026 voltando 12 meses
            const k = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            folhaMensal[k] = 15_000;   // 12 x 15k = 180k
        }
        // Faturamento RBT12 = 600k (50k x 12 meses)
        const empresa = {
            ...empresaBase,
            folha12: 999_999,         // ignorado quando folhaMensal existe
            folhaMensal,
            faturamentoManual: gerarSerie(50_000, 12, 2026, 6),
        };
        const r = calcularResumoEmpresa(empresa, [], new Date(2026, 5, 1));
        // Fator R = 180k / 600k = 30% (>= 28% → Anexo III)
        expect(r.fator_r).toBeCloseTo(0.30, 2);
    });

    it('janela movel reflete mudanca real de folha (mes a mes muda)', () => {
        // Mes corrente 12/2026. Janela = 12/2025..11/2026.
        const folhaMensal: Record<string, number> = {
            '2025-12': 5_000, '2026-01': 5_000, '2026-02': 5_000, '2026-03': 5_000,
            '2026-04': 5_000, '2026-05': 5_000, '2026-06': 20_000, '2026-07': 20_000,
            '2026-08': 20_000, '2026-09': 20_000, '2026-10': 20_000, '2026-11': 20_000,
        };
        const total = Object.values(folhaMensal).reduce((a, b) => a + b, 0);
        // Soma = 6*5000 + 6*20000 = 30000 + 120000 = 150_000
        expect(total).toBe(150_000);

        const empresa = {
            ...empresaBase,
            folha12: 0,
            folhaMensal,
            faturamentoManual: gerarSerie(50_000, 12, 2026, 12),  // 600k
        };
        const r = calcularResumoEmpresa(empresa, [], new Date(2026, 11, 1));
        // Fator R = 150k / 600k = 25% (< 28% → Anexo V no III_V)
        expect(r.fator_r).toBeCloseTo(0.25, 2);
        expect(r.folha_12).toBe(150_000);
    });

    it('folhaMensal vazio cai no fallback folha12', () => {
        const empresa = {
            ...empresaBase,
            folha12: 300_000,
            folhaMensal: {},     // objeto presente mas vazio → fallback
            faturamentoManual: gerarSerie(50_000, 12, 2026, 6),
        };
        const r = calcularResumoEmpresa(empresa, [], new Date(2026, 5, 1));
        expect(r.folha_12).toBe(300_000);
        expect(r.fator_r).toBeCloseTo(0.50, 2);
    });
});
