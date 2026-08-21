/**
 * Varredura de IPI (motivação: caso Experte 06/2026) — classifica cada empresa
 * de Lucro: "pronta" (há mês-modelo com IPI no MIT → transmite sozinha) vs
 * "precisa_lancamento" (1º IPI da empresa → lançar 1x no e-CAC).
 */
import {
    normalizarCompetencia, calcularIpiApuradoFicha, acharFichaCompetencia, fichasDasCompetencias,
    classificarIpiEmpresa, resumirVarreduraIpi,
} from '../sefaz-backend/ipi-varredura';

describe('normalizarCompetencia', () => {
    it('aceita YYYY-MM, YYYY-MM-DD e MM/YYYY', () => {
        expect(normalizarCompetencia('2026-06')).toBe('2026-06');
        expect(normalizarCompetencia('2026-06-15')).toBe('2026-06');
        expect(normalizarCompetencia('06/2026')).toBe('2026-06');
    });
    it('null para lixo', () => {
        expect(normalizarCompetencia('junho')).toBeNull();
        expect(normalizarCompetencia('')).toBeNull();
        expect(normalizarCompetencia(null)).toBeNull();
    });
});

describe('calcularIpiApuradoFicha — mesma fórmula do lucroService', () => {
    it('max(0, ipiRecolher - saldoCredorIpi)', () => {
        expect(calcularIpiApuradoFicha({ ipiRecolher: 7352.9 })).toBe(7352.9);
        expect(calcularIpiApuradoFicha({ ipiRecolher: 1000, saldoCredorIpi: 300 })).toBe(700);
        expect(calcularIpiApuradoFicha({ ipiRecolher: 500, saldoCredorIpi: 900 })).toBe(0);
    });
    it('0 sem ficha ou sem IPI', () => {
        expect(calcularIpiApuradoFicha(null)).toBe(0);
        expect(calcularIpiApuradoFicha({})).toBe(0);
        expect(calcularIpiApuradoFicha({ ipiRecolher: 0 })).toBe(0);
    });
});

describe('acharFichaCompetencia', () => {
    const fichas = [
        { mesReferencia: '2026-05', ipiRecolher: 1 },
        { mesReferencia: '2026-06', ipiRecolher: 2 },
    ];
    it('acha pela competência normalizada', () => {
        expect(acharFichaCompetencia(fichas, '2026-06')?.ipiRecolher).toBe(2);
        expect(acharFichaCompetencia(fichas, '06/2026')?.ipiRecolher).toBe(2);
    });
    it('null quando não há', () => {
        expect(acharFichaCompetencia(fichas, '2026-07')).toBeNull();
        expect(acharFichaCompetencia(null, '2026-06')).toBeNull();
    });
});

describe('classificarIpiEmpresa', () => {
    it('sem IPI → sem_ipi', () => {
        expect(classificarIpiEmpresa({ ipiApurado: 0, temModeloIpi: false }).status).toBe('sem_ipi');
    });
    it('IPI + modelo → pronta', () => {
        const r = classificarIpiEmpresa({ ipiApurado: 7352.9, temModeloIpi: true });
        expect(r.status).toBe('pronta');
        expect(r.prioridade).toBe(1);
    });
    it('IPI sem modelo → precisa_lancamento (e-CAC 1x)', () => {
        const r = classificarIpiEmpresa({ ipiApurado: 100, temModeloIpi: false });
        expect(r.status).toBe('precisa_lancamento');
        expect(r.acao).toMatch(/e-CAC/);
        expect(r.prioridade).toBe(3);
    });
    it('erro de consulta prevalece sobre modelo desconhecido', () => {
        const r = classificarIpiEmpresa({ ipiApurado: 100, temModeloIpi: false, erroConsulta: 'cStat 656' });
        expect(r.status).toBe('erro_consulta');
        expect(r.acao).toMatch(/656/);
    });
});

describe('resumirVarreduraIpi', () => {
    it('conta por status e soma IPI em risco (precisa + erro)', () => {
        const resumo = resumirVarreduraIpi([
            { status: 'pronta', ipiApurado: 1000 },
            { status: 'precisa_lancamento', ipiApurado: 500 },
            { status: 'erro_consulta', ipiApurado: 200 },
            { status: 'sem_ipi', ipiApurado: 0 },
            { status: 'sem_ipi', ipiApurado: 0 },
        ]);
        expect(resumo).toEqual({
            total: 5, comIpi: 3, pronta: 1, precisaLancamento: 1,
            erroConsulta: 1, semIpi: 2,
            ipiTotalApurado: 1700, ipiTotalEmRisco: 700,
        });
    });
});

// ═══ A RÉGUA ÚNICA DA LEITURA DA FICHA — a classe do defeito do F550 ════════
//
// 21/08 (AFFITTARE 1139): o F550 saiu vazio porque a régua lia a ficha pela
// forma do INPUT do cálculo. Ao varrer os OUTROS leitores apareceu a segunda
// metade do mesmo defeito: quatro deles comparavam `f.mesReferencia === comp`
// na mão, e o campo aparece em três formatos. Igualdade estrita não devolve
// erro — devolve NADA, indistinguível de "a ficha não foi lançada".
describe('🚨 fichasDasCompetencias — a régua no plural (trimestral e mensal)', () => {
    const fichas = [
        { mesReferencia: '2026-01', v: 1 },
        { mesReferencia: '02/2026', v: 2 },        // formato antigo
        { mesReferencia: '2026-03-01', v: 3 },     // com dia
        { mesReferencia: '2026-04', v: 4 },
    ];

    it('acha o trimestre inteiro apesar dos três formatos', () => {
        const r = fichasDasCompetencias(fichas, ['2026-01', '2026-02', '2026-03']);
        expect(r.map((f: any) => f.v)).toEqual([1, 2, 3]);
    });

    it('aceita competência única (mensal) e normaliza os DOIS lados', () => {
        expect(fichasDasCompetencias(fichas, '02/2026').map((f: any) => f.v)).toEqual([2]);
        expect(fichasDasCompetencias(fichas, '2026-02').map((f: any) => f.v)).toEqual([2]);
    });

    it('competência ilegível devolve lista VAZIA — nunca a lista inteira', () => {
        expect(fichasDasCompetencias(fichas, 'junho/26')).toEqual([]);
        expect(fichasDasCompetencias(fichas, [])).toEqual([]);
        expect(fichasDasCompetencias(null, '2026-01')).toEqual([]);
    });

    it('acharFichaCompetencia continua devolvendo UMA — e pelas três formas', () => {
        expect((acharFichaCompetencia(fichas, '2026-03') as any)?.v).toBe(3);
        expect((acharFichaCompetencia(fichas, '01/2026') as any)?.v).toBe(1);
    });
});
