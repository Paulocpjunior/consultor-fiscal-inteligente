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

    // 🚨 ESTAS DUAS FIXTURES FORAM TROCADAS EM 29/08 — elas DOCUMENTAVAM o
    // defeito. As linhas eram montadas à mão (`join('|')`), sem o `|` inicial e
    // sem o `\r\n`, e o orquestrador junta os blocos com `join('')`: o
    // C195/C197 saía COLADO na linha anterior do bloco C.
    //
    // É a SEGUNDA instância viva do caso REALITY (21/08) achada no mesmo dia —
    // a primeira foi o bloco G —, e ela nunca apareceu porque o C197 só sai com
    // o COD_AJ da tabela 5.3 CADASTRADO, e ninguém cadastrou ainda. A mesma
    // sorte do IPI em E200/E210.
    it('com o código cadastrado, gera a linha C197 da nota', () => {
        const r = montarC197Difal({ ...base, codigoAjuste: 'SP50000001' });
        expect(r.linhasPorChave.CH1).toEqual([
            '|C197|SP50000001|DIFAL aquisicao interestadual||1000,00|18,00|60,00|0,00|\r\n',
        ]);
    });

    it('com COD_OBS cadastrado, o C195 vem antes do C197', () => {
        const r = montarC197Difal({ ...base, codigoAjuste: 'SP50000001', codObservacao: '001' });
        expect(r.linhasPorChave.CH1[0]).toBe('|C195|001|DIFAL aquisicao interestadual|\r\n');
        expect(r.linhasPorChave.CH1).toHaveLength(2);
    });

    // 🔒 A TRAVA DA CLASSE, não da linha: nenhuma linha do C195/C197 escapa do
    // buildLine. É a mesma pergunta que a R15 (`linhasMalformadas`) faz sobre o
    // arquivo — aqui ela nasce dentro do módulo, para o próximo registro não
    // repetir o atalho do `join('|')`.
    it('🔒 nenhuma linha do C195/C197 escapa do buildLine', () => {
        const r = montarC197Difal({ ...base, codigoAjuste: 'SP50000001', codObservacao: '001' });
        expect(r.linhasPorChave.CH1.length).toBeGreaterThan(0);
        for (const l of r.linhasPorChave.CH1) expect(l).toMatch(/^\|C19[57]\|.*\|\r\n$/);
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

describe('CFOP na ótica de quem recebe (o XML traz o do emitente)', () => {
    // A venda interestadual de material de uso/consumo sai do emitente como
    // 6556; pra quem recebe é 2556. Comparar direto com o CFOP do XML não
    // achava nada — mesmo defeito que escondeu a NF 110497 do painel DIFAL.
    const notaEmitida = {
        chave: 'CH9', numero: '77', direcao: 'entrada',
        emitente: { uf: 'MG' },
        itens: [{ cfop: '6556', vProd: 1000, aliqIcms: 12 }],
    };

    it('reconhece o CFOP 6556 do emitente como uso/consumo (2556)', () => {
        expect(notaGeraDifalAquisicao(notaEmitida, 'SP')).toBe(true);
        const r = calcularDifalDaNota(notaEmitida, { aliqInterna: 18, ufEmpresa: 'SP' });
        expect(r.base).toBe(1000);
        expect(r.difal).toBe(60);
    });

    it('venda para revenda (6102 → 2102) continua fora — é outro trilho', () => {
        const revenda = { ...notaEmitida, itens: [{ cfop: '6102', vProd: 1000, aliqIcms: 12 }] };
        expect(notaGeraDifalAquisicao(revenda, 'SP')).toBe(false);
    });

    it('UF do emitente cai na CHAVE quando não há cadastro', () => {
        const semUf = {
            chave: '33260608825779000196550010001104971117647682',
            direcao: 'entrada',
            itens: [{ cfop: '6556', vProd: 1000, aliqIcms: 12 }],
        };
        expect(notaGeraDifalAquisicao(semUf, 'SP')).toBe(true);
    });
});
