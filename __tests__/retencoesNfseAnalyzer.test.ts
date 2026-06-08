import {
    analisarRetencoes,
    validarRetencoesLinha,
    resumirRetencoes,
    consolidarPorPrestadorMes,
    type LinhaNfseCsv,
    ALIQ_CSRF_TOTAL,
} from '../services/retencoesNfseAnalyzer';

function linhaBase(over: Partial<LinhaNfseCsv> = {}): LinhaNfseCsv {
    return {
        direcao: 'Recebida',
        numero: '1',
        data: '2026-06-01',
        prestadorCnpj: '11.222.333/0001-81',
        prestadorNome: 'Prestador X',
        tomadorCnpj: '99.888.777/0001-65',
        tomadorNome: 'Tomador Y',
        valorServicos: 1000,
        iss: 0,
        codServico: '7490-1',
        discriminacao: '',
        ...over,
    };
}

describe('analisarRetencoes', () => {
    it('ISS retido vem da coluna iss > 0', () => {
        const a = analisarRetencoes(linhaBase({ iss: 50, valorServicos: 1000 }));
        expect(a.iss.retido).toBe(true);
        expect(a.iss.valor).toBe(50);
    });

    it('CSRF retido por texto na discriminacao', () => {
        const disc = 'Servico prestado. Retencoes: PIS R$ 6,50, COFINS R$ 30,00, CSLL R$ 10,00';
        const a = analisarRetencoes(linhaBase({ valorServicos: 1000, discriminacao: disc }));
        expect(a.pis.retido).toBe(true);
        expect(a.pis.valor).toBeCloseTo(6.5, 2);
        expect(a.cofins.valor).toBeCloseTo(30, 2);
        expect(a.csll.valor).toBeCloseTo(10, 2);
    });

    it('totalRetido soma ISS + INSS + CSRF + IRRF', () => {
        const disc = 'PIS R$ 6,50 COFINS R$ 30,00 CSLL R$ 10,00 IRRF R$ 15,00';
        const a = analisarRetencoes(linhaBase({ iss: 50, valorServicos: 1000, discriminacao: disc }));
        expect(a.totalRetido).toBeCloseTo(50 + 6.5 + 30 + 10 + 15, 2);
        expect(a.temAlgumaRetencao).toBe(true);
    });

    it('linha sem retencao retorna totalRetido=0', () => {
        const a = analisarRetencoes(linhaBase({ valorServicos: 1000 }));
        expect(a.totalRetido).toBe(0);
        expect(a.temAlgumaRetencao).toBe(false);
    });
});

describe('validarRetencoesLinha', () => {
    it('detecta erro quando retencao total > valor servico', () => {
        const linha = linhaBase({ valorServicos: 100 });
        const analise = analisarRetencoes(linha);
        analise.totalRetido = 150; // forca caso de erro
        const incs = validarRetencoesLinha(linha, analise);
        expect(incs.find(i => i.codigo === 'RETENCAO_MAIOR_QUE_SERVICO')).toBeDefined();
    });

    it('IRRF abaixo do piso R$ 10 (Lei 9.430/96 art. 67) gera alerta', () => {
        const linha = linhaBase({ valorServicos: 500, discriminacao: 'IRRF R$ 7,50' });
        const analise = analisarRetencoes(linha);
        const incs = validarRetencoesLinha(linha, analise);
        const piso = incs.find(i => i.codigo === 'IRRF_ABAIXO_PISO');
        expect(piso).toBeDefined();
        expect(piso!.severidade).toBe('alerta');
    });

    it('CSRF abaixo do piso R$ 10 (Lei 13.137/15) gera alerta', () => {
        const linha = linhaBase({ valorServicos: 100, discriminacao: 'PIS R$ 0,65 COFINS R$ 3,00 CSLL R$ 1,00' });
        const analise = analisarRetencoes(linha);
        const incs = validarRetencoesLinha(linha, analise);
        const piso = incs.find(i => i.codigo === 'CSRF_ABAIXO_PISO');
        expect(piso).toBeDefined();
    });

    it('CSRF correta a 4,65% sobre R$ 1000 NAO gera alerta de inconsistencia', () => {
        const valor = 1000;
        const esperado = valor * ALIQ_CSRF_TOTAL;     // 46,50
        const disc = `PIS R$ 6,50 COFINS R$ 30,00 CSLL R$ 10,00`;
        const linha = linhaBase({ valorServicos: valor, discriminacao: disc });
        const analise = analisarRetencoes(linha);
        expect(analise.totalRetido).toBeCloseTo(esperado, 2);
        const incs = validarRetencoesLinha(linha, analise);
        expect(incs.find(i => i.codigo === 'CSRF_INCONSISTENTE')).toBeUndefined();
    });

    it('IRRF a 1,5% (aliquota usual) NAO gera alerta de atipica', () => {
        const linha = linhaBase({ valorServicos: 2000, discriminacao: 'IRRF R$ 30,00' });
        const analise = analisarRetencoes(linha);
        const incs = validarRetencoesLinha(linha, analise);
        expect(incs.find(i => i.codigo === 'IRRF_ALIQUOTA_ATIPICA')).toBeUndefined();
    });

    it('IRRF a 2,5% (atipica) gera alerta', () => {
        const linha = linhaBase({ valorServicos: 2000, discriminacao: 'IRRF R$ 50,00' });
        const analise = analisarRetencoes(linha);
        const incs = validarRetencoesLinha(linha, analise);
        expect(incs.find(i => i.codigo === 'IRRF_ALIQUOTA_ATIPICA')).toBeDefined();
    });

    it('prestador Simples + CSRF (Recebida) gera alerta', () => {
        const cnpjPrestador = '11.222.333/0001-81';
        const linha = linhaBase({
            direcao: 'Recebida',
            prestadorCnpj: cnpjPrestador,
            valorServicos: 1000,
            discriminacao: 'PIS R$ 6,50 COFINS R$ 30,00 CSLL R$ 10,00',
        });
        const analise = analisarRetencoes(linha);
        const incs = validarRetencoesLinha(linha, analise, {
            cnpjsSimples: new Set([cnpjPrestador.replace(/\D/g, '')]),
        });
        expect(incs.find(i => i.codigo === 'CSRF_PRESTADOR_SIMPLES')).toBeDefined();
    });
});

describe('resumirRetencoes', () => {
    it('agrega totalRetido e contagem por tributo', () => {
        const a1 = analisarRetencoes(linhaBase({ iss: 50, valorServicos: 1000, discriminacao: 'IRRF R$ 15,00' }));
        const a2 = analisarRetencoes(linhaBase({ iss: 25, valorServicos: 500, discriminacao: 'PIS R$ 3,25' }));
        const r = resumirRetencoes([a1, a2]);
        expect(r.porTributo.iss.valor).toBe(75);
        expect(r.porTributo.iss.qtd).toBe(2);
        expect(r.porTributo.irrf.valor).toBe(15);
        expect(r.porTributo.pis.valor).toBeCloseTo(3.25, 2);
        expect(r.notasComRetencao).toBe(2);
    });
});

describe('consolidarPorPrestadorMes', () => {
    it('agrupa notas por prestador+mes (apenas direcao=Recebida)', () => {
        const linhas: LinhaNfseCsv[] = [
            linhaBase({ direcao: 'Recebida', data: '2026-06-15', prestadorCnpj: '11111111000111', valorServicos: 1000 }),
            linhaBase({ direcao: 'Recebida', data: '2026-06-25', prestadorCnpj: '11111111000111', valorServicos: 500 }),
            linhaBase({ direcao: 'Recebida', data: '2026-07-10', prestadorCnpj: '11111111000111', valorServicos: 2000 }),
        ];
        const items = linhas.map(l => ({ linha: l, analise: analisarRetencoes(l) }));
        const r = consolidarPorPrestadorMes(items);
        const jun = r.find(x => x.competencia === '2026-06');
        expect(jun?.valorTotal).toBe(1500);
        expect(jun?.qtdNotas).toBe(2);
        const jul = r.find(x => x.competencia === '2026-07');
        expect(jul?.valorTotal).toBe(2000);
    });

    it('ignora linhas direcao=Emitida no consolidado', () => {
        const linhas: LinhaNfseCsv[] = [
            linhaBase({ direcao: 'Emitida', data: '2026-06-15', prestadorCnpj: '11111111000111', valorServicos: 999 }),
            linhaBase({ direcao: 'Recebida', data: '2026-06-15', prestadorCnpj: '11111111000111', valorServicos: 1000 }),
        ];
        const items = linhas.map(l => ({ linha: l, analise: analisarRetencoes(l) }));
        const r = consolidarPorPrestadorMes(items);
        expect(r).toHaveLength(1);
        expect(r[0].valorTotal).toBe(1000);
    });
});
