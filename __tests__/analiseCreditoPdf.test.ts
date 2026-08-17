/**
 * Testes smoke dos geradores de PDF da analise de creditos PIS/COFINS.
 *
 * jsPDF eh ESM-only e nao roda direto no jest CJS. Mocamos como stub minimo
 * que aceita todas as chamadas e devolve um Blob. O objetivo aqui eh garantir
 * que a NOSSA logica NAO QUEBRA em entradas degeneradas (efiscal vazio,
 * credito null, Simples Nacional sem credito, lancamentos vazios), nao
 * validar o PDF binario.
 */
jest.mock('jspdf', () => {
    return {
        __esModule: true,
        jsPDF: jest.fn().mockImplementation(() => {
            const noop = () => {};
            const api: any = {
                setFillColor: noop, setDrawColor: noop, setTextColor: noop,
                setLineWidth: noop, setFont: noop, setFontSize: noop,
                rect: noop, line: noop, text: noop,
                splitTextToSize: () => [''], getTextWidth: () => 10,
                addPage: noop, setPage: noop,
                internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
                getNumberOfPages: () => 1,
                output: (kind: string) => {
                    if (kind === 'blob') return new Blob(['%PDF-1.7\n%fake'], { type: 'application/pdf' });
                    return '';
                },
            };
            return api;
        }),
    };
});

import { gerarEfiscalPdf, gerarExtratoPdf, baixarBlob } from '../services/analiseCreditoPdf';
import type { EfiscalPdfParsed } from '../services/efiscalPdfParserService';
import type { CreditoEfiscal } from '../services/efiscalCreditoService';

const efiscalDemo = (): EfiscalPdfParsed => ({
    empresaCodigo: 'EMP1',
    empresaNome: 'Demo Ltda',
    empresaCnpj: '11.222.333/0001-81',
    periodo: '04/2026',
    notas: [
        { emissao: '15/04/2026', numero: '1', serie: '1', cnpjCpf: '22.222.222/0001-22',
          razaoSocial: 'Forn X', valorNf: 1000, baseCalculo: 1000, aliquota: 5,
          valorIss: 50, issRetido: 0, pagina: 1 },
    ],
    fornecedores: [
        { cnpjCpf: '22.222.222/0001-22', razaoSocial: 'Forn X', qtdNotas: 1,
          somaValorNf: 1000, somaBaseCalculo: 1000, somaValorIss: 50, somaIssRetido: 0 },
    ],
    totalImpresso:  { valorNf: 1000, baseCalculo: 1000, valorIss: 50, issRetido: 0 },
    totalCalculado: { valorNf: 1000, baseCalculo: 1000, valorIss: 50, issRetido: 0 },
    rodapeEncontrado: true,
    validacao: { ok: true, divergencias: [], situacao: 'confere' as const },
    rawTextLength: 500,
});

const creditoDemo = (): CreditoEfiscal => ({
    regime: 'REAL',
    geraCredito: true,
    aliquota: { label: 'PIS 1,65% / COFINS 7,60%', pis: 0.0165, cofins: 0.0760 },
    baseTotal: 1000,
    creditoPis: 16.5,
    creditoCofins: 76,
    creditoTotal: 92.5,
    fornecedoresClassificados: [],
    categorias: [
        { categoria: 'aluguel', qtdFornecedores: 1, qtdNotas: 1,
          somaBaseCalculo: 1000, somaValorNf: 1000,
          fornecedores: [], notas: [{ emissao: '15/04/2026', numero: '1', serie: '1',
            cnpjCpf: '22.222.222/0001-22', razaoSocial: 'Forn X',
            valorNf: 1000, baseCalculo: 1000, aliquota: 5, valorIss: 50,
            issRetido: 0, pagina: 1 }],
        } as any,
    ],
});

const creditoSimples = (): CreditoEfiscal => ({
    regime: 'SIMPLES',
    geraCredito: false,
    aliquota: { label: 'Sem credito (Simples Nacional)', pis: 0, cofins: 0 },
    baseTotal: 0,
    creditoPis: 0,
    creditoCofins: 0,
    creditoTotal: 0,
    fornecedoresClassificados: [],
    categorias: [],
});

describe('gerarEfiscalPdf', () => {
    it('gera Blob valido com efiscal + credito', async () => {
        const blob = await gerarEfiscalPdf(efiscalDemo(), creditoDemo());
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('application/pdf');
    });

    it('aceita credito = null (sem credito calculado)', async () => {
        const blob = await gerarEfiscalPdf(efiscalDemo(), null);
        expect(blob).toBeInstanceOf(Blob);
    });

    it('Simples Nacional (geraCredito=false) renderiza aviso sem quebrar', async () => {
        const blob = await gerarEfiscalPdf(efiscalDemo(), creditoSimples());
        expect(blob).toBeInstanceOf(Blob);
    });

    it('efiscal sem fornecedores nem notas nao quebra', async () => {
        const efiscal: EfiscalPdfParsed = {
            ...efiscalDemo(),
            notas: [],
            fornecedores: [],
            totalImpresso:  { valorNf: 0, baseCalculo: 0, valorIss: 0, issRetido: 0 },
            totalCalculado: { valorNf: 0, baseCalculo: 0, valorIss: 0, issRetido: 0 },
        };
        const blob = await gerarEfiscalPdf(efiscal, creditoDemo());
        expect(blob).toBeInstanceOf(Blob);
    });
});

describe('gerarExtratoPdf', () => {
    it('gera Blob valido com lancamentos', async () => {
        const blob = await gerarExtratoPdf({
            lancamentos: [
                { data: '15/04/2026', favorecido: 'Forn X', descricao: 'Aluguel',
                  valor: 1000, categoriaSugerida: 'aluguel', confianca: 'ALTA' } as any,
            ],
            categoriasCredito: ['aluguel', 'limpeza'],
            baseCreditos: 1000,
            creditoPis: 16.5,
            creditoCofins: 76,
            creditoTotal: 92.5,
        });
        expect(blob).toBeInstanceOf(Blob);
    });

    it('lancamentos vazios nao quebram', async () => {
        const blob = await gerarExtratoPdf({
            lancamentos: [],
            categoriasCredito: ['aluguel'],
            baseCreditos: 0,
            creditoPis: 0,
            creditoCofins: 0,
            creditoTotal: 0,
        });
        expect(blob).toBeInstanceOf(Blob);
    });

    it('ignora lancamentos com categoriaSugerida=null', async () => {
        const blob = await gerarExtratoPdf({
            lancamentos: [
                { data: '15/04/2026', favorecido: 'X', descricao: 'd1',
                  valor: 100, categoriaSugerida: null, confianca: 'SEM_MATCH' } as any,
            ],
            categoriasCredito: ['aluguel'],
            baseCreditos: 0,
            creditoPis: 0,
            creditoCofins: 0,
            creditoTotal: 0,
        });
        expect(blob).toBeInstanceOf(Blob);
    });
});

describe('baixarBlob', () => {
    beforeAll(() => {
        // jsdom nao implementa URL.createObjectURL
        if (!(URL as any).createObjectURL) {
            (URL as any).createObjectURL = jest.fn(() => 'blob:fake');
        }
    });

    it('cria <a download> e dispara click', () => {
        const blob = new Blob(['x'], { type: 'application/pdf' });
        const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        baixarBlob(blob, 'teste.pdf');
        expect(click).toHaveBeenCalledTimes(1);
        click.mockRestore();
    });
});
