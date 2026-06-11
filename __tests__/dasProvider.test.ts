// @ts-ignore modulo .js puro
import { normalizarRespostaDasSerpro } from '../sefaz-backend/das-response-normalizer.js';

describe('normalizarRespostaDasSerpro', () => {
    it('extrai PDF e detalhamento quando SERPRO retorna dados em array', () => {
        const result = {
            dados: [
                {
                    pdf: 'JVBERi0xLjQK',
                    detalhamentoDas: {
                        numeroDocumento: '07202616267783487',
                        dataVencimento: '20260622',
                        valores: { total: 4652.41 },
                    },
                },
            ],
        };

        expect(normalizarRespostaDasSerpro(result, 0)).toMatchObject({
            numeroDocumento: '07202616267783487',
            vencimento: '2026-06-22',
            valor: 4652.41,
            pdfBase64: 'JVBERi0xLjQK',
        });
    });

    it('mantem fallback para campos planos esperados', () => {
        const result = {
            dados: {
                numeroDarf: '123',
                linhaDigitavel: '858200000000',
                vencimento: '2026-06-20',
                pdfBase64: 'PDF',
            },
        };

        expect(normalizarRespostaDasSerpro(result, 10)).toMatchObject({
            numeroDocumento: '123',
            codigoBarras: '858200000000',
            vencimento: '2026-06-20',
            valor: 10,
            pdfBase64: 'PDF',
        });
    });
});
