/**
 * Smoke test do gerador DANFSe.
 *
 * jsPDF eh ESM-only, sem suporte direto no jest CJS. Mockamos como stub
 * minimo que aceita todas as chamadas e devolve um Blob - o objetivo aqui
 * eh garantir que a NOSSA logica nao quebra em entradas degeneradas (CNPJ
 * vazio, valor zero, status incomum), nao validar o PDF binario do jsPDF.
 */
jest.mock('jspdf', () => {
    return {
        __esModule: true,
        default: jest.fn().mockImplementation(() => {
            const noop = () => {};
            const noopChainable = () => api;
            const api: any = {
                setFillColor: noop, setDrawColor: noop, setTextColor: noop,
                setLineWidth: noop, setFont: noop, setFontSize: noop,
                rect: noop, roundedRect: noop, line: noop,
                text: noop, splitTextToSize: () => [''], getTextWidth: () => 10,
                addPage: noopChainable, setPage: noopChainable,
                internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 }, getNumberOfPages: () => 1 },
                output: (kind: string) => {
                    if (kind === 'blob') return new Blob(['%PDF-1.7\n%fake-pdf\n%%EOF'.padEnd(2000)], { type: 'application/pdf' });
                    return '';
                },
                save: noop,
            };
            return api;
        }),
    };
});

import { gerarDanfseBlob, baixarDanfse } from '../services/danfseGenerator';
import type { NfseNacionalEmitida } from '../types';

const nfseValida: NfseNacionalEmitida = {
    id: 'doc1',
    empresaId: 'emp1',
    numero: '000001',
    chave: '12345678901234567890123456789012345678901234567890',
    dataEmissao: '2026-06-01',
    emitidaEm: '2026-06-01T10:00:00Z',
    status: 'autorizada' as any,
    prestador: { cnpj: '11222333000181', im: '12345', nome: 'Prestador Demo Ltda' },
    tomador: { cnpj: '99888777000165', cpf: null, nome: 'Tomador Demo SA' },
    servico: {
        codigoNbs: '1.0506.10.00',
        descricao: 'Servico de consultoria contabil mensal',
        valor: 1000,
        aliquotaIss: 5,
        issValor: 50,
        issRetido: 0,
    },
    valores: { bruto: 1000, deducoes: 0, issRetido: 0, liquido: 1000 },
    modeUsado: 'mock',
};

describe('gerarDanfseBlob', () => {
    it('gera um Blob valido com NFS-e completa', () => {
        const blob = gerarDanfseBlob(nfseValida, true);
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.size).toBeGreaterThan(1000); // PDF minimo nao-vazio
        expect(blob.type).toBe('application/pdf');
    });

    it('aceita modoTeste=false (sem watermark) sem quebrar', () => {
        const blob = gerarDanfseBlob(nfseValida, false);
        expect(blob.size).toBeGreaterThan(1000);
    });

    it('aceita tomador CPF (pessoa fisica) em vez de CNPJ', () => {
        const nfse: NfseNacionalEmitida = {
            ...nfseValida,
            tomador: { cnpj: null, cpf: '52998224725', nome: 'Pessoa Fisica Demo' },
        };
        const blob = gerarDanfseBlob(nfse);
        expect(blob.size).toBeGreaterThan(1000);
    });

    it('NAO QUEBRA com valor 0 (situacao degenerada)', () => {
        const nfse: NfseNacionalEmitida = {
            ...nfseValida,
            servico: { ...nfseValida.servico, valor: 0, issValor: 0 },
            valores: { bruto: 0, deducoes: 0, issRetido: 0, liquido: 0 },
        };
        const blob = gerarDanfseBlob(nfse);
        expect(blob.size).toBeGreaterThan(1000);
    });

    it('NAO QUEBRA com chave curta ou prestador sem nome', () => {
        const nfse: NfseNacionalEmitida = {
            ...nfseValida,
            chave: 'CHAVE_PROVISORIA',
            prestador: { cnpj: '11222333000181' },
        };
        const blob = gerarDanfseBlob(nfse);
        expect(blob.size).toBeGreaterThan(1000);
    });

    it('NAO QUEBRA com status cancelada (deve renderizar carimbo)', () => {
        const nfse: NfseNacionalEmitida = {
            ...nfseValida,
            status: 'cancelada' as any,
            canceladaEm: '2026-06-02T10:00:00Z',
            motivoCancelamento: 'Erro na emissao - solicitacao do cliente',
        };
        const blob = gerarDanfseBlob(nfse);
        expect(blob.size).toBeGreaterThan(1000);
    });

    it('NAO QUEBRA com servico.descricao muito longa (wrap)', () => {
        const nfse: NfseNacionalEmitida = {
            ...nfseValida,
            servico: {
                ...nfseValida.servico,
                descricao: 'Servicos de consultoria contabil mensal '.repeat(50),
            },
        };
        const blob = gerarDanfseBlob(nfse);
        expect(blob.size).toBeGreaterThan(1000);
    });
});

describe('baixarDanfse', () => {
    it('exporta a funcao (smoke)', () => {
        expect(typeof baixarDanfse).toBe('function');
    });
});
