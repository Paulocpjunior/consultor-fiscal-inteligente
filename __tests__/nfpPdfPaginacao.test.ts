/** @jest-environment node */
import { gerarRelatorioPdfNfp } from '../services/nfpProCloudPdf';

const mockDrawn: { text: string; bottom: number }[] = [];
let mockPages = 1;
jest.mock('jspdf', () => ({
    jsPDF: function () {
        const api: any = {
            internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
            splitTextToSize: (text: string, width: number) => String(text).match(new RegExp('.{1,' + Math.max(1, Math.floor(width / 2)) + '}', 'g')) || [''],
            text: (text: string | string[], _x: number, y: number) => {
                const lines = Array.isArray(text) ? text : [text];
                mockDrawn.push({ text: lines.join(''), bottom: y + (lines.length - 1) * 3.8 });
            },
            addPage: () => { mockPages++; },
            getNumberOfPages: () => mockPages,
            output: () => new Blob([]),
        };
        for (const method of ['setFont', 'setFontSize', 'setTextColor', 'setDrawColor', 'setLineWidth', 'line', 'setFillColor', 'rect', 'roundedRect', 'setPage']) api[method] = () => api;
        return api;
    },
}));

test('multi-page manual observation is drawn within pages through its final marker', async () => {
    mockDrawn.length = 0;
    mockPages = 1;
    await gerarRelatorioPdfNfp({
        taxaSelic: 0, taxProfile: null,
        analise: {
            empresaId: 'test', empresaNome: 'TESTE', empresaCnpj: '00000000000000',
            fonte: 'offline', dataAnalise: '2026-09-21', analisadoPor: 'test',
            debitos: [], parcelamentos: [], certidoes: [], acoes: [], planoAcao: [],
            obrigacoes: [{
                id: 'o', empresaId: 'test', esfera: 'estadual', sigla: 'EFD',
                nome: 'EFD', periodicidade: 'mensal', status: 'pendente',
                observacao: 'Pendencia de escrituracao. '.repeat(700) + 'FIM_DA_OBSERVACAO',
            }],
        },
    });
    expect(mockPages).toBeGreaterThan(10);
    expect(mockDrawn.map(x => x.text).join('')).toContain('FIM_DA_OBSERVACAO');
    expect(mockDrawn.filter(x => x.bottom > 297)).toEqual([]);
});
