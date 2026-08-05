import {
    mesesDoPeriodo, montarMeses, totalDeclaracao, avisosDaDeclaracao,
} from '../services/declaracaoFaturamento';

describe('mesesDoPeriodo', () => {
    it('devolve os meses do período, inclusive as pontas', () => {
        expect(mesesDoPeriodo('2026-01', '2026-06')).toEqual([
            '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
        ]);
    });

    it('atravessa a virada do ano', () => {
        expect(mesesDoPeriodo('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    });

    it('período invertido ou inválido devolve vazio (não inventa mês)', () => {
        expect(mesesDoPeriodo('2026-06', '2026-01')).toEqual([]);
        expect(mesesDoPeriodo('2026-13', '2026-14')).toEqual([]);
        expect(mesesDoPeriodo('', '2026-01')).toEqual([]);
    });

    it('recusa período absurdo (>60 meses) em vez de varrer o banco', () => {
        expect(mesesDoPeriodo('2020-01', '2026-01')).toEqual([]);
    });
});

describe('montarMeses — o app propõe, quem assina confirma', () => {
    const apurado = {
        '2026-01': { valor: 33616.15, docs: 12 },
        '2026-02': { valor: 0, docs: 0 },
    };

    it('sem ajuste, o valor do documento é o apurado', () => {
        const m = montarMeses(['2026-01'], apurado);
        expect(m[0].valor).toBe(33616.15);
        expect(m[0].ajustado).toBe(false);
    });

    it('ajuste do responsável vence e fica MARCADO', () => {
        const m = montarMeses(['2026-01'], apurado, { '2026-01': 40000 });
        expect(m[0].valor).toBe(40000);
        expect(m[0].apurado).toBe(33616.15);
        expect(m[0].ajustado).toBe(true);
    });

    it('digitar o mesmo valor do apurado NÃO marca como ajuste', () => {
        const m = montarMeses(['2026-01'], apurado, { '2026-01': 33616.15 });
        expect(m[0].ajustado).toBe(false);
    });

    it('mês sem documento lido é sinalizado — zero pode ser falha de captura', () => {
        const m = montarMeses(['2026-02'], apurado);
        expect(m[0].valor).toBe(0);
        expect(m[0].semDocumentos).toBe(true);
    });

    it('competência ausente do apurado não quebra: vira zero sinalizado', () => {
        const m = montarMeses(['2026-09'], apurado);
        expect(m[0].valor).toBe(0);
        expect(m[0].semDocumentos).toBe(true);
    });
});

describe('total e avisos', () => {
    it('soma os valores que VÃO no documento (com ajuste)', () => {
        const m = montarMeses(
            ['2026-01', '2026-02'],
            { '2026-01': { valor: 100.10, docs: 3 }, '2026-02': { valor: 200.20, docs: 4 } },
            { '2026-02': 300 },
        );
        expect(totalDeclaracao(m)).toBe(400.10);
    });

    it('avisa sobre mês vazio e sobre ajuste — o papel vai assinado', () => {
        const m = montarMeses(
            ['2026-01', '2026-02'],
            { '2026-01': { valor: 0, docs: 0 }, '2026-02': { valor: 200, docs: 4 } },
            { '2026-02': 300 },
        );
        const avisos = avisosDaDeclaracao(m);
        expect(avisos.join(' ')).toMatch(/sem nenhum documento capturado/);
        expect(avisos.join(' ')).toMatch(/2026-01/);
        expect(avisos.join(' ')).toMatch(/ajustado manualmente/);
    });

    it('tudo capturado e sem ajuste não gera aviso nenhum', () => {
        const m = montarMeses(['2026-01'], { '2026-01': { valor: 500, docs: 9 } });
        expect(avisosDaDeclaracao(m)).toEqual([]);
    });
});
