/**
 * DIFAL de aquisição no bloco C (C195/C197).
 *
 * O que está travado aqui: só uso/consumo e ativo entram (revenda é outro
 * trilho), e SEM o código de ajuste do estado o registro NÃO é inventado.
 */
import {
    notaGeraDifalAquisicao, aliqInterestadual, calcularDifalDaNota, montarC197Difal,
} from '../sefaz-backend/sped-difal-c197.js';

const notaMG = (itens: any[], extra: Record<string, unknown> = {}) => ({
    chave: 'CH1', numero: '900', direcao: 'entrada',
    emitente: { uf: 'MG' }, itens, ...extra,
});

describe('notaGeraDifalAquisicao', () => {
    it('entrada interestadual com material de uso/consumo entra', () => {
        expect(notaGeraDifalAquisicao(notaMG([{ cfop: '2556', vProd: 1000 }]), 'SP')).toBe(true);
    });

    it('mercadoria para revenda NÃO entra (é outro trilho)', () => {
        expect(notaGeraDifalAquisicao(notaMG([{ cfop: '2102', vProd: 1000 }]), 'SP')).toBe(false);
    });

    it('compra dentro do estado não gera DIFAL', () => {
        const dentro = notaMG([{ cfop: '1556', vProd: 1000 }], { emitente: { uf: 'SP' } });
        expect(notaGeraDifalAquisicao(dentro, 'SP')).toBe(false);
    });

    it('saída e nota cancelada ficam fora', () => {
        expect(notaGeraDifalAquisicao(notaMG([{ cfop: '2556', vProd: 1 }], { direcao: 'saida' }), 'SP')).toBe(false);
        expect(notaGeraDifalAquisicao(notaMG([{ cfop: '2556', vProd: 1 }], { situacao: 'cancelada' }), 'SP')).toBe(false);
    });
});

describe('aliqInterestadual', () => {
    it('a destacada no item vence a derivação', () => {
        expect(aliqInterestadual({ aliqIcms: 4 }, 'MG')).toEqual({ aliq: 4, derivada: false });
    });

    it('sem destaque, deriva pela UF: Sul/Sudeste 12%, demais 7%', () => {
        expect(aliqInterestadual({}, 'MG')).toEqual({ aliq: 12, derivada: true });
        expect(aliqInterestadual({}, 'BA')).toEqual({ aliq: 7, derivada: true });
    });

    it('produto importado força 4%', () => {
        expect(aliqInterestadual({ orig: '1' }, 'MG')).toEqual({ aliq: 4, derivada: true });
    });
});

describe('calcularDifalDaNota', () => {
    it('base é só dos itens de uso/consumo e ativo', () => {
        const r = calcularDifalDaNota(
            notaMG([
                { cfop: '2556', vProd: 1000, aliqIcms: 12 },
                { cfop: '2102', vProd: 5000, aliqIcms: 12 },   // revenda: fora
            ]),
            { aliqInterna: 18, ufEmpresa: 'SP' },
        );
        expect(r.base).toBe(1000);
        expect(r.difal).toBe(60);      // 1000 × (18 − 12)%
        expect(r.itens).toBe(1);
    });

    it('interna menor que a interestadual não vira crédito', () => {
        const r = calcularDifalDaNota(
            notaMG([{ cfop: '2556', vProd: 1000, aliqIcms: 12 }]),
            { aliqInterna: 7, ufEmpresa: 'SP' },
        );
        expect(r.difal).toBe(0);
    });

    it('marca quando a alíquota interestadual foi derivada', () => {
        const r = calcularDifalDaNota(
            notaMG([{ cfop: '2551', vProd: 2000 }]),
            { aliqInterna: 18, ufEmpresa: 'SP' },
        );
        expect(r.aliqInterDerivada).toBe(true);
        expect(r.difal).toBe(120);     // 2000 × (18 − 12)%
    });
});

describe('montarC197Difal', () => {
    const base = {
        notas: [notaMG([{ cfop: '2556', vProd: 1000, aliqIcms: 12 }])],
        ufEmpresa: 'SP',
        aliqInternaPadrao: 18,
    };

    it('SEM código de ajuste o C197 NÃO é gerado — vira aviso com a ação', () => {
        const r = montarC197Difal(base);
        expect(r.linhasPorChave).toEqual({});
        expect(r.totalDifal).toBe(60);
        expect(r.avisos.join(' ')).toContain('código de ajuste');
        expect(r.avisos.join(' ')).toContain('não se inventa');
    });

    it('com o código cadastrado, gera a linha C197 da nota', () => {
        const r = montarC197Difal({ ...base, codigoAjuste: 'SP50000001' });
        expect(r.linhasPorChave.CH1).toEqual([
            'C197|SP50000001|DIFAL aquisicao interestadual||1000,00|18,00|60,00|0,00|',
        ]);
    });

    it('com COD_OBS cadastrado, o C195 vem antes do C197', () => {
        const r = montarC197Difal({ ...base, codigoAjuste: 'SP50000001', codObservacao: '001' });
        expect(r.linhasPorChave.CH1[0]).toBe('C195|001|DIFAL aquisicao interestadual|');
        expect(r.linhasPorChave.CH1).toHaveLength(2);
    });

    it('lembra que o débito do E110 vem do E111, não do C197', () => {
        const r = montarC197Difal({ ...base, codigoAjuste: 'SP50000001' });
        expect(r.avisos.join(' ')).toContain('Ajustes E111');
    });

    it('empresa sem compra interestadual de uso/consumo não recebe nada', () => {
        const r = montarC197Difal({
            ...base,
            notas: [notaMG([{ cfop: '2102', vProd: 9999, aliqIcms: 12 }])],
        });
        expect(r.porNota).toEqual([]);
        expect(r.avisos).toEqual([]);
        expect(r.totalDifal).toBe(0);
    });

    it('alíquota interna por nota vence a padrão', () => {
        const r = montarC197Difal({ ...base, aliqInternaPorChave: { CH1: 25 } });
        expect(r.totalDifal).toBe(130);   // 1000 × (25 − 12)%
    });
});
