import { classificarCfop, classificarPorCfop, ehCfopDeEntrada } from '../services/cfopClassifier';

describe('classificarCfop — venda', () => {
    it('5102 (venda no estado)', () => expect(classificarCfop('5102')).toBe('venda'));
    it('6102 (venda fora do estado)', () => expect(classificarCfop('6102')).toBe('venda'));
    it('5101 (venda industrial no estado)', () => expect(classificarCfop('5101')).toBe('venda'));
    it('7101 (exportacao)', () => expect(classificarCfop('7101')).toBe('venda'));
});

describe('classificarCfop — compra', () => {
    it('1102 (compra no estado)', () => expect(classificarCfop('1102')).toBe('compra'));
    it('2102 (compra fora do estado)', () => expect(classificarCfop('2102')).toBe('compra'));
    it('3102 (importacao)', () => expect(classificarCfop('3102')).toBe('compra'));
});

describe('classificarCfop — devolucao', () => {
    it('5202 (devolucao de compra) — antes era classificado como VENDA', () => {
        expect(classificarCfop('5202')).toBe('devolucao');
    });
    it('1201 (devolucao de venda — entrada) — antes era COMPRA', () => {
        expect(classificarCfop('1201')).toBe('devolucao');
    });
    it('6202 (devolucao compra outro estado)', () => {
        expect(classificarCfop('6202')).toBe('devolucao');
    });
    it('1411 (devolucao em operacao ST)', () => {
        expect(classificarCfop('1411')).toBe('devolucao');
    });
});

describe('classificarCfop — transferencia', () => {
    it('5151 (transferencia produzido — saida) — antes era VENDA', () => {
        expect(classificarCfop('5151')).toBe('transferencia');
    });
    it('1151 (entrada por transferencia) — antes era COMPRA', () => {
        expect(classificarCfop('1151')).toBe('transferencia');
    });
    it('2152 (transferencia de mercadoria adquirida)', () => {
        expect(classificarCfop('2152')).toBe('transferencia');
    });
});

describe('classificarCfop — remessa/retorno', () => {
    it('5901 (remessa para industrializacao) — antes era SERVICO_PRESTADO', () => {
        expect(classificarCfop('5901')).toBe('remessa');
    });
    it('1902 (retorno mercadoria remetida) — antes era SERVICO_TOMADO', () => {
        expect(classificarCfop('1902')).toBe('remessa');
    });
    it('5915 (remessa para conserto)', () => {
        expect(classificarCfop('5915')).toBe('remessa');
    });
});

describe('classificarCfop — servicos', () => {
    it('5353 (servico transporte prestado intermunicipal)', () => {
        expect(classificarCfop('5353')).toBe('servico_prestado');
    });
    it('1353 (servico transporte tomado)', () => {
        expect(classificarCfop('1353')).toBe('servico_tomado');
    });
    it('5304 (comunicacao prestada)', () => {
        expect(classificarCfop('5304')).toBe('servico_prestado');
    });
    it('1303 (comunicacao tomada)', () => {
        expect(classificarCfop('1303')).toBe('servico_tomado');
    });
});

describe('classificarCfop — invalidos', () => {
    it('string vazia → null', () => expect(classificarCfop('')).toBeNull());
    it('menos de 4 dígitos → null', () => expect(classificarCfop('510')).toBeNull());
    it('letras → null', () => expect(classificarCfop('ABCD')).toBeNull());
});

describe('classificarPorCfop — agregacao de documento', () => {
    it('NFe de venda (vários itens 5102) → venda', () => {
        const itens = [{ cfop: '5102' }, { cfop: '5102' }, { cfop: '5102' }];
        expect(classificarPorCfop(itens, 'saida')).toBe('venda');
    });

    it('NFe devolucao de compra (5202) → devolucao (antes virava venda)', () => {
        const itens = [{ cfop: '5202' }, { cfop: '5202' }];
        expect(classificarPorCfop(itens, 'saida')).toBe('devolucao');
    });

    it('NFe transferencia (5151) → transferencia (antes virava venda)', () => {
        const itens = [{ cfop: '5151' }];
        expect(classificarPorCfop(itens, 'saida')).toBe('transferencia');
    });

    it('NFe remessa para industrializacao (5901) → remessa (antes virava servico)', () => {
        const itens = [{ cfop: '5901' }];
        expect(classificarPorCfop(itens, 'saida')).toBe('remessa');
    });

    it('NFe sem CFOP reconhecido cai no fallback direcao=saida → venda', () => {
        // 5990 nao esta nas faixas modeladas → fallback
        const itens = [{ cfop: '5990' }];
        expect(classificarPorCfop(itens, 'saida')).toBe('venda');
    });

    it('Itens vazios → outro', () => {
        expect(classificarPorCfop([], 'entrada')).toBe('outro');
    });
});

describe('ehCfopDeEntrada', () => {
    it('1xxx, 2xxx, 3xxx → entrada', () => {
        expect(ehCfopDeEntrada('1102')).toBe(true);
        expect(ehCfopDeEntrada('2102')).toBe(true);
        expect(ehCfopDeEntrada('3102')).toBe(true);
    });
    it('5xxx, 6xxx, 7xxx → não-entrada', () => {
        expect(ehCfopDeEntrada('5102')).toBe(false);
        expect(ehCfopDeEntrada('6102')).toBe(false);
        expect(ehCfopDeEntrada('7102')).toBe(false);
    });
});
