import { montarMovimentoFiscalContabil } from '../sefaz-backend/movimento-fiscal-contabil.js';

describe('movimento_fiscal_cfi_v1', () => {
    const cnpj = '42907639000103';
    const base = {
        id: 'nfse-300', tipoDoc: 'NFSe', direcao: 'saida', competencia: '2026-06',
        numero: '300', dhEmi: '2026-06-26T12:00:00-03:00', valorTotal: 1889.07,
        tomadorNome: 'AVACY DISTRIBUIDORA E COMERCIO LTDA', tomadorCnpj: '12345678000190',
        empresaCnpj: cnpj, valorIss: 0, valores: { baseCalculo: 1889.07, liquido: 1889.07 },
    };

    it('entrega servicos prestados normalizados e totalizados sem PDF intermediario', () => {
        const r = montarMovimentoFiscalContabil({
            cnpjEmpresa: cnpj, competencia: '2026-06', movimento: 'servicos_prestados',
            documentos: [base, { ...base, id: 'cancelada', numero: '301', status: 'cancelado' }],
        });
        expect(r.contrato).toBe('movimento_fiscal_cfi_v1');
        expect(r.resumo).toEqual({ notas: 1, total: 1889.07, semDocumentoContraparte: 0 });
        expect(r.notas[0]).toMatchObject({
            idOrigem: 'nfse-300', numero: '300', data: '2026-06-26', valor: 1889.07,
            participanteNome: 'AVACY DISTRIBUIDORA E COMERCIO LTDA', participanteDocumento: '12345678000190',
        });
    });

    it('nao mistura servicos tomados com prestados', () => {
        const r = montarMovimentoFiscalContabil({
            cnpjEmpresa: cnpj, competencia: '2026-06', movimento: 'servicos_tomados', documentos: [base],
        });
        expect(r.resumo.notas).toBe(0);
        expect(r.resumo.total).toBe(0);
    });

    it('nao troca o valor bruto da nota pela base reduzida de ISS', () => {
        const r = montarMovimentoFiscalContabil({
            cnpjEmpresa: cnpj, competencia: '2026-06', movimento: 'servicos_prestados',
            documentos: [{ ...base, valorServicos: undefined, valorTotal: 5755.54, valores: { baseCalculo: 4604.43 } }],
        });
        expect(r.notas[0].valor).toBe(5755.54);
        expect(r.notas[0].baseCalculoIss).toBe(4604.43);
        expect(r.resumo.total).toBe(5755.54);
    });
});
