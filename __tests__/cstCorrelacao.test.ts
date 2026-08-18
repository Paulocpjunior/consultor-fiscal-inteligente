/**
 * cstCorrelacao — o CST segue o CFOP escriturado.
 *
 * Paulo, 18/08: *"adiciona o CST para validarmos a operação. Exemplo do consumo:
 * a nota vai vir 5102/5101, vamos registrar como 1556. Aí que está a chave do
 * SPED: o CST do fornecedor vai vir como 00, temos que indicar 90 para essas
 * operações."*
 *
 * É a mesma assimetria do CFOP, um campo adiante — a nota é do FORNECEDOR.
 */
// @ts-ignore — módulo JS do backend
import {
    cstDoLancamento, partesDoCst, resumirCst, CST_POR_DESTINO, DESTINOS_SEM_DECISAO,
// @ts-ignore
} from '../sefaz-backend/cst-correlacao.js';

describe('partesDoCst aceita as duas formas do XML', () => {
    it('2 dígitos assume origem nacional; 3 dígitos separam origem e tributação', () => {
        expect(partesDoCst('00')).toEqual({ origem: '0', tributacao: '00' });
        expect(partesDoCst('000')).toEqual({ origem: '0', tributacao: '00' });
        expect(partesDoCst('100')).toEqual({ origem: '1', tributacao: '00' });
        expect(partesDoCst('060')).toEqual({ origem: '0', tributacao: '60' });
    });

    it('sem CST não inventa nada', () => {
        expect(partesDoCst('')).toBeNull();
        expect(partesDoCst(null)).toBeNull();
        expect(partesDoCst('abc')).toBeNull();
    });
});

describe('o caso do Paulo: 5102 escriturado como 1556', () => {
    it('CST 00 do fornecedor vira 090 na entrada de uso/consumo', () => {
        const r = cstDoLancamento('00', '1556');
        expect(r.situacao).toBe('convertido');
        expect(r.cst).toBe('090');
        expect(r.motivo).toMatch(/é o do FORNECEDOR/);
    });

    it('vale para as três faixas — 1556, 2556 e 3556 têm o mesmo destino', () => {
        for (const cfop of ['1556', '2556', '3556']) {
            expect(cstDoLancamento('000', cfop).cst).toBe('090');
        }
    });

    it('e para a transferência de material de uso/consumo (1557)', () => {
        expect(cstDoLancamento('00', '1557').cst).toBe('090');
    });

    it('CST 20 (base reduzida) é a mesma operação — também converte', () => {
        expect(cstDoLancamento('020', '1556').cst).toBe('090');
    });
});

describe('🚨 a origem da mercadoria NÃO é apagada', () => {
    it('produto importado (origem 1) vira 190, nunca 090', () => {
        const r = cstDoLancamento('100', '1556');
        expect(r.cst).toBe('190');
        // Escrever '090' afirmaria dentro do SPED que um produto importado é
        // nacional — a origem é fato da MERCADORIA, não da operação.
        expect(r.cst).not.toBe('090');
    });

    it('todas as origens da Tabela A sobrevivem à conversão', () => {
        for (const o of ['0', '1', '2', '3', '4', '5', '6', '7', '8']) {
            expect(cstDoLancamento(`${o}00`, '1556').cst).toBe(`${o}90`);
        }
    });
});

describe('o que a régua se RECUSA a converter', () => {
    it('CST que já declara um fato próprio é MANTIDO e dito', () => {
        // 60 = ST cobrada anteriormente. Vira 90 e o livro perde justamente a
        // informação que ele precisa ter.
        for (const cst of ['040', '041', '050', '051', '060', '070']) {
            const r = cstDoLancamento(cst, '1556');
            expect(r.situacao).toBe('preservado-por-situacao');
            expect(r.cst).toBe(cst);
            expect(r.motivo).toMatch(/apagaria/);
        }
    });

    it('CSOSN do Simples não pertence a esta tabela', () => {
        // 102 = Simples sem permissão de crédito. Converter misturaria tabelas.
        expect(cstDoLancamento('102', '1556').situacao).toBe('preservado-por-situacao');
    });

    it('🚨 ATIVO (1551/2551) NÃO converte — fica NOMEADO como decisão em aberto', () => {
        const r = cstDoLancamento('000', '1551');
        expect(r.situacao).toBe('nao-decidido');
        expect(r.cst).toBe('000');
        // O motivo diz POR QUE não é o mesmo caso: no ativo há crédito por CIAP.
        expect(r.motivo).toMatch(/CIAP/);
        expect(DESTINOS_SEM_DECISAO['551']).toBeTruthy();
    });

    it('CFOP de mercadoria comum não é tocado', () => {
        for (const cfop of ['1101', '1102', '1403', '2102']) {
            const r = cstDoLancamento('000', cfop);
            expect(r.situacao).toBe('preservado');
            expect(r.cst).toBe('000');
        }
    });

    it('SAÍDA nunca converte — é a nota que o cliente emitiu', () => {
        expect(cstDoLancamento('000', '5556').situacao).toBe('preservado');
        expect(cstDoLancamento('000', '5102').situacao).toBe('preservado');
    });

    it('item sem CST não recebe CST deduzido do CFOP', () => {
        const r = cstDoLancamento('', '1556');
        expect(r.situacao).toBe('sem-cst');
        expect(r.cst).toBeNull();
        expect(r.motivo).toMatch(/não é deduzido do CFOP/);
    });
});

describe('cada entrada da tabela carrega a FONTE', () => {
    it('nenhum de-para foi escrito de memória', () => {
        for (const k of Object.keys(CST_POR_DESTINO)) {
            expect(String((CST_POR_DESTINO as any)[k].fonte).length).toBeGreaterThan(30);
        }
    });
});

describe('resumo com a causa junto do número', () => {
    it('conta o que converteu e transforma o resto em UMA pergunta', () => {
        const r = resumirCst([
            { cst: '000', cfop: '1556' },
            { cst: '000', cfop: '1556' },
            { cst: '000', cfop: '1551' },
            { cst: '000', cfop: '1551' },
            { cst: '000', cfop: '1551' },
            { cst: '060', cfop: '1556' },
            { cst: '', cfop: '1556' },
        ]);
        expect(r.convertidos).toBe(2);
        const avisos = r.avisos.join(' | ');
        expect(avisos).toMatch(/3 item\(ns\) escriturado\(s\) como ativo imobilizado/);
        expect(avisos).toMatch(/1 item\(ns\) de uso\/consumo vieram com CST que não é 00\/20/);
        expect(avisos).toMatch(/1 item\(ns\) sem CST/);
    });

    it('nada a dizer não vira aviso', () => {
        expect(resumirCst([{ cst: '000', cfop: '1102' }]).avisos).toHaveLength(0);
        expect(resumirCst([]).avisos).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// A TRAVA DOS LEITORES — campo que só a tela honra faria o SPED sair com o
// CST velho, e a conferência daria certo. Mesma regra do cfopPorNota.
// ═══════════════════════════════════════════════════════════════════════════
import * as fs from 'fs';
import * as path from 'path';

describe('o SPED honra o CST escriturado', () => {
    const blocoC = fs.readFileSync(
        path.resolve(__dirname, '../sefaz-backend/sped-fiscal-blocoC.js'), 'utf8',
    );

    it('C170 e C190 passam pela régua — 2 chamadas, nenhuma a menos', () => {
        // A DEFINIÇÃO da função casa com o mesmo texto — só as CHAMADAS contam.
        const chamadas = blocoC.match(/(?<!function )cstEscriturado\(item, /g) || [];
        expect(chamadas).toHaveLength(2);
        expect(blocoC).toContain("import { cstDoLancamento } from './cst-correlacao.js'");
    });

    it('nenhum dos dois volta a formatar o CST cru por conta própria', () => {
        // Era esta linha, duplicada, que existia antes em C170 e C190.
        expect(blocoC).not.toMatch(/const cstFmt = cst\.length === 2/);
    });
});
