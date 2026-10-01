/** @jest-environment node */
/**
 * 🚫 A DECLARAÇÃO DE FATURAMENTO NÃO LEVA OBSERVAÇÃO INTERNA AO PAPEL (01/10).
 *
 * Paulo, com o PDF impresso: *"aparecem observações sobre meses sem documentos
 * capturados e ajustes manuais nos valores. Essas informações são apenas
 * observações internas do sistema! não podem sair nas impressões aos
 * clientes"*. A trava gera o PDF de verdade (jsPDF de mentira que anota cada
 * texto) com mês AJUSTADO e confere o que foi escrito.
 */
import { gerarDeclaracaoFaturamentoPdf } from '../services/relatorioPdf';

const mockTextos: string[] = [];
jest.mock('jspdf', () => {
    const Ctor = function () {
        const api: any = {
            internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
            splitTextToSize: (t: string) => [String(t)],
            text: (t: string | string[]) => { mockTextos.push(Array.isArray(t) ? t.join(' ') : String(t)); return api; },
            getTextWidth: () => 10,
            addPage: () => api,
            save: () => api,
            addImage: () => api,
        };
        for (const m of ['setFont', 'setFontSize', 'setTextColor', 'setDrawColor', 'setLineWidth', 'line', 'setFillColor', 'rect', 'roundedRect']) api[m] = () => api;
        return api;
    };
    return { __esModule: true, default: Ctor, jsPDF: Ctor };
});

beforeAll(() => { (global as any).fetch = () => Promise.reject(new Error('sem logo no teste')); });

test('mês ajustado e avisos não aparecem no PDF; os valores e o total, sim', async () => {
    mockTextos.length = 0;
    await gerarDeclaracaoFaturamentoPdf({
        empresa: { nome: 'EMPRESA TESTE LTDA', cnpj: '11222333000181' },
        meses: [
            { competencia: '2026-07', valor: 1000, ajustado: true },
            { competencia: '2026-08', valor: 0 },
        ],
        identificacao: { responsavel: 'FULANO — Sócio', contador: 'CONTADOR — CRC' } as any,
        fileName: 'x.pdf',
    });
    const tudo = mockTextos.join(' | ');
    expect(tudo).toMatch(/1\.000,00/);
    expect(tudo).toMatch(/TOTAL/);
    expect(tudo).not.toMatch(/ajustad/i);
    expect(tudo).not.toMatch(/capturad/i);
    expect(tudo).not.toMatch(/conferir antes de assinar/i);
    expect(mockTextos.some((t) => /\*\s*$/.test(t))).toBe(false);
});
