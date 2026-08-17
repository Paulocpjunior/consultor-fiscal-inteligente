/**
 * Testes da logica PURA de merge de invoices manuais com PDF e-fiscal +
 * filtragem por ocultos. Extraida de components/AnaliseCreditoExtrato.tsx
 * (que tinha 2152 linhas) pra ser testavel sem render React.
 */
jest.mock('../services/firebaseConfig', () => ({
    db: null, auth: null, isFirebaseConfigured: false,
}));
jest.mock('firebase/firestore', () => ({
    collection: jest.fn(), getDocs: jest.fn(), doc: jest.fn(),
    setDoc: jest.fn(), getDoc: jest.fn(), query: jest.fn(),
    where: jest.fn(), deleteDoc: jest.fn(),
    addDoc: jest.fn(), updateDoc: jest.fn(), Timestamp: { now: jest.fn(() => ({ toMillis: () => 0 })) },
    limit: jest.fn(),
}));

import {
    mesclarInvoicesEFiltrarOcultos,
    chaveSinteticaInvoice,
} from '../services/analiseCreditoMerge';
import type { EfiscalPdfParsed, EfiscalNf, EfiscalFornecedorAgrupado } from '../services/efiscalPdfParserService';
import type { InvoiceManual } from '../services/invoicesManuaisService';
import { nfChave } from '../services/notasOcultasService';

const efiscalVazio = (): EfiscalPdfParsed => ({
    empresaCodigo: 'EMP1',
    empresaNome: 'Empresa Demo',
    empresaCnpj: '11.222.333/0001-81',
    periodo: '04/2026',
    notas: [],
    fornecedores: [],
    totalImpresso:  { valorNf: 0, baseCalculo: 0, valorIss: 0, issRetido: 0 },
    totalCalculado: { valorNf: 0, baseCalculo: 0, valorIss: 0, issRetido: 0 },
    rodapeEncontrado: true,
    validacao: { ok: true, divergencias: [], situacao: 'confere' as const },
    rawTextLength: 0,
});

const nfDemo = (over: Partial<EfiscalNf> = {}): EfiscalNf => ({
    emissao: '15/04/2026',
    numero: '1001',
    serie: '1',
    cnpjCpf: '22.222.222/0001-22',
    razaoSocial: 'Fornecedor X',
    valorNf: 1000,
    baseCalculo: 1000,
    aliquota: 5,
    valorIss: 50,
    issRetido: 0,
    pagina: 1,
    ...over,
});

const fornDemo = (over: Partial<EfiscalFornecedorAgrupado> = {}): EfiscalFornecedorAgrupado => ({
    cnpjCpf: '22.222.222/0001-22',
    razaoSocial: 'Fornecedor X',
    qtdNotas: 1,
    somaValorNf: 1000,
    somaBaseCalculo: 1000,
    somaValorIss: 50,
    somaIssRetido: 0,
    ...over,
});

const invoiceDemo = (over: Partial<InvoiceManual> = {}): InvoiceManual => ({
    id: 'inv-1234567890',
    empresaId: 'EMP1',
    periodoNormalizado: '04/2026',
    emissao: '20/04/2026',
    numero: '2001',
    serie: '1',
    cnpjCpf: '33.333.333/0001-33',
    razaoSocial: 'Fornecedor Y',
    valorNf: 500,
    baseCalculo: 500,
    aliquota: 5,
    valorIss: 25,
    issRetido: 0,
    criadoEm: Date.now(),
    criadoPor: 'user1',
    ...(over as any),
} as any);

describe('chaveSinteticaInvoice', () => {
    it('preserva digitos do CNPJ + sufixo do id', () => {
        const k = chaveSinteticaInvoice({ cnpjCpf: '33.333.333/0001-33', id: 'inv-abcdefgh' });
        expect(k).toBe('33333333000133__inv__abcdefgh');
    });

    it('aceita CNPJ vazio (caso invoice estrangeira)', () => {
        const k = chaveSinteticaInvoice({ cnpjCpf: '', id: 'foreign-1' });
        expect(k).toBe('__inv__oreign-1');  // slice(-8) de 'foreign-1' (9 chars)
    });

    it('chaves diferentes pra invoices com mesmo CNPJ mas ids distintos', () => {
        const k1 = chaveSinteticaInvoice({ cnpjCpf: '33.333.333/0001-33', id: 'inv-aaaaaaaa' });
        const k2 = chaveSinteticaInvoice({ cnpjCpf: '33.333.333/0001-33', id: 'inv-bbbbbbbb' });
        expect(k1).not.toBe(k2);
    });
});

describe('mesclarInvoicesEFiltrarOcultos — sem invoices nem ocultos', () => {
    it('preserva PDF original quando nao ha invoices nem ocultos', () => {
        const efiscal = { ...efiscalVazio(), notas: [nfDemo()], fornecedores: [fornDemo()] };
        const out = mesclarInvoicesEFiltrarOcultos({
            efiscal,
            invoicesManuais: [],
            overrides: new Map(),
            fornecedoresOcultos: new Set(),
            notasOcultas: new Set(),
        });
        expect(out.notasMescladas).toHaveLength(1);
        expect(out.fornFiltrados).toHaveLength(1);
        expect(out.fornFiltrados[0].somaValorNf).toBe(1000);
        expect(out.notasFiltradas).toHaveLength(1);
    });
});

describe('mesclarInvoicesEFiltrarOcultos — invoices SEM categoria agregam por CNPJ', () => {
    it('invoice de fornecedor existente AGREGA na linha do PDF (somando)', () => {
        const efiscal = { ...efiscalVazio(), notas: [nfDemo()], fornecedores: [fornDemo()] };
        const inv = invoiceDemo({
            cnpjCpf: '22.222.222/0001-22',  // mesmo CNPJ do PDF
            razaoSocial: 'Fornecedor X',
            valorNf: 300,
            baseCalculo: 300,
        });
        const out = mesclarInvoicesEFiltrarOcultos({
            efiscal, invoicesManuais: [inv],
            overrides: new Map(),
            fornecedoresOcultos: new Set(),
            notasOcultas: new Set(),
        });
        expect(out.fornFiltrados).toHaveLength(1);
        expect(out.fornFiltrados[0].qtdNotas).toBe(2);          // 1 PDF + 1 invoice
        expect(out.fornFiltrados[0].somaValorNf).toBe(1300);    // 1000 + 300
        expect(out.fornFiltrados[0].somaBaseCalculo).toBe(1300);
    });

    it('invoice de CNPJ novo CRIA linha nova', () => {
        const efiscal = { ...efiscalVazio(), notas: [nfDemo()], fornecedores: [fornDemo()] };
        const inv = invoiceDemo({ cnpjCpf: '44.444.444/0001-44' });
        const out = mesclarInvoicesEFiltrarOcultos({
            efiscal, invoicesManuais: [inv],
            overrides: new Map(),
            fornecedoresOcultos: new Set(),
            notasOcultas: new Set(),
        });
        expect(out.fornFiltrados).toHaveLength(2);
    });
});

describe('mesclarInvoicesEFiltrarOcultos — invoices COM categoria viram fornecedores sinteticos', () => {
    it('cada invoice categorizada cria fornecedor proprio (mesmo com CNPJ duplicado)', () => {
        const inv1 = invoiceDemo({ id: 'a-aaaaaaaa', cnpjCpf: '00.000.000/0000-00', categoria: 'aluguel' as any });
        const inv2 = invoiceDemo({ id: 'b-bbbbbbbb', cnpjCpf: '00.000.000/0000-00', categoria: 'limpeza' as any });
        const out = mesclarInvoicesEFiltrarOcultos({
            efiscal: efiscalVazio(),
            invoicesManuais: [inv1, inv2],
            overrides: new Map(),
            fornecedoresOcultos: new Set(),
            notasOcultas: new Set(),
        });
        // 2 invoices CNPJ identico mas IDs distintos -> 2 fornecedores sinteticos
        expect(out.fornFiltrados).toHaveLength(2);
        // overridesSinteticos contem ambas as categorias por chave sintetica
        expect(out.overridesSinteticos.size).toBe(2);
    });

    it('preserva overrides originais alem dos sinteticos', () => {
        const overridesOriginais = new Map<string, string>([
            ['22222222000122', 'manutencao'],
        ]);
        const inv = invoiceDemo({ id: 'inv-categoria', categoria: 'aluguel' as any });
        const out = mesclarInvoicesEFiltrarOcultos({
            efiscal: efiscalVazio(),
            invoicesManuais: [inv],
            overrides: overridesOriginais,
            fornecedoresOcultos: new Set(),
            notasOcultas: new Set(),
        });
        expect(out.overridesSinteticos.get('22222222000122')).toBe('manutencao');
        expect(out.overridesSinteticos.size).toBe(2);
    });
});

describe('mesclarInvoicesEFiltrarOcultos — filtros de ocultos', () => {
    it('FORNECEDOR oculto remove todas as NFs do CNPJ', () => {
        const efiscal = {
            ...efiscalVazio(),
            notas: [
                nfDemo({ numero: '1' }),
                nfDemo({ numero: '2' }),
                nfDemo({ cnpjCpf: '55.555.555/0001-55', numero: '3' }),
            ],
            fornecedores: [
                fornDemo({ qtdNotas: 2, somaValorNf: 2000 }),
                fornDemo({ cnpjCpf: '55.555.555/0001-55', somaValorNf: 1000, qtdNotas: 1 }),
            ],
        };
        const out = mesclarInvoicesEFiltrarOcultos({
            efiscal, invoicesManuais: [],
            overrides: new Map(),
            fornecedoresOcultos: new Set(['22222222000122']),  // oculta o primeiro
            notasOcultas: new Set(),
        });
        expect(out.fornFiltrados).toHaveLength(1);
        expect(out.fornFiltrados[0].cnpjCpf).toBe('55.555.555/0001-55');
        // NFs do CNPJ oculto tambem somem do retorno
        expect(out.notasFiltradas).toHaveLength(1);
        expect(out.notasFiltradas[0].numero).toBe('3');
    });

    it('NF INDIVIDUAL oculta desconta valores do fornecedor agregado', () => {
        const efiscal = {
            ...efiscalVazio(),
            notas: [
                nfDemo({ numero: '1', valorNf: 1000, baseCalculo: 1000, valorIss: 50 }),
                nfDemo({ numero: '2', valorNf: 500,  baseCalculo: 500,  valorIss: 25 }),
            ],
            fornecedores: [
                fornDemo({ qtdNotas: 2, somaValorNf: 1500, somaBaseCalculo: 1500, somaValorIss: 75 }),
            ],
        };
        // Oculta APENAS a NF #1
        const chaveOculta = nfChave('22.222.222/0001-22', '1', '1');
        const out = mesclarInvoicesEFiltrarOcultos({
            efiscal, invoicesManuais: [],
            overrides: new Map(),
            fornecedoresOcultos: new Set(),
            notasOcultas: new Set([chaveOculta]),
        });
        // Fornecedor continua existindo
        expect(out.fornFiltrados).toHaveLength(1);
        // Mas com valores agregados DESCONTADOS da NF oculta
        expect(out.fornFiltrados[0].qtdNotas).toBe(1);          // 2 - 1
        expect(out.fornFiltrados[0].somaValorNf).toBe(500);     // 1500 - 1000
        expect(out.fornFiltrados[0].somaBaseCalculo).toBe(500); // 1500 - 1000
        expect(out.fornFiltrados[0].somaValorIss).toBe(25);     // 75 - 50
        // notasFiltradas tambem nao contem a NF oculta
        expect(out.notasFiltradas).toHaveLength(1);
        expect(out.notasFiltradas[0].numero).toBe('2');
    });

    it('fornecedor com TODAS as NFs ocultas individualmente eh REMOVIDO', () => {
        const efiscal = {
            ...efiscalVazio(),
            notas: [
                nfDemo({ numero: '1' }),
                nfDemo({ numero: '2' }),
            ],
            fornecedores: [fornDemo({ qtdNotas: 2, somaValorNf: 2000 })],
        };
        const out = mesclarInvoicesEFiltrarOcultos({
            efiscal, invoicesManuais: [],
            overrides: new Map(),
            fornecedoresOcultos: new Set(),
            notasOcultas: new Set([
                nfChave('22.222.222/0001-22', '1', '1'),
                nfChave('22.222.222/0001-22', '2', '1'),
            ]),
        });
        expect(out.fornFiltrados).toHaveLength(0);
    });

    it('NF oculta de fornecedor INEXISTENTE no PDF nao quebra', () => {
        const efiscal = {
            ...efiscalVazio(),
            notas: [nfDemo()],
            fornecedores: [fornDemo()],
        };
        const out = mesclarInvoicesEFiltrarOcultos({
            efiscal, invoicesManuais: [],
            overrides: new Map(),
            fornecedoresOcultos: new Set(),
            notasOcultas: new Set([nfChave('99.999.999/9999-99', '9', '9')]),
        });
        // Nada muda — fornecedor original preservado
        expect(out.fornFiltrados).toHaveLength(1);
        expect(out.fornFiltrados[0].qtdNotas).toBe(1);
    });
});
