/**
 * Crédito de ICMS na entrada — a régua e os LEITORES dela.
 *
 * 🚨 O CASO (09/09, Paulo, MV LIDER · comércio do SIMPLES · 08/2026):
 * *"Como faço para editar esses CFOPs que sobem com base e ICMS destacados?
 * Poderia ter uma opção igual essa das retenções, senão a escrituração fica
 * errada"* — Livro de Entradas totalizando **Base 14.773,62 · ICMS 2.623,17**
 * numa optante, que não se credita de ICMS (LC 123/2006, art. 23).
 *
 * A trava dos leitores é a lição de 07/09 (o cérebro do CFOP que chegava a UMA
 * aba): régua nova nasce com a lista de consumidores MEDIDA, senão o livro diz
 * uma coisa e o `.FML` diz outra — e a divergência aparece meses depois.
 */
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
    entradaGeraCreditoIcms, colunaDoCstInformado,
} from '../sefaz-backend/credito-icms-entrada.js';
import { ctxAlocacaoDoDoc, alocarTributacaoIcms } from '../services/iobSageExportService';

const raiz = resolve(__dirname, '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');
/** Varredura lê CÓDIGO, nunca a prosa que o explica (a mordida do ISS, 22/08). */
const semComentario = (s: string) => s
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

describe('entradaGeraCreditoIcms', () => {
    it('optante do Simples NÃO se credita — com a base legal junto', () => {
        const r = entradaGeraCreditoIcms({ regime: 'SIMPLES', direcao: 'entrada' });
        expect(r.credita).toBe(false);
        expect(r.baseLegal).toContain('LC 123');
        expect(r.motivo).toMatch(/Outras/i);
    });

    it('Lucro Presumido e Real creditam — nada muda para quem tem direito', () => {
        expect(entradaGeraCreditoIcms({ regime: 'LUCRO_PRESUMIDO', direcao: 'entrada' }).credita).toBe(true);
        expect(entradaGeraCreditoIcms({ regime: 'LUCRO_REAL', direcao: 'entrada' }).credita).toBe(true);
    });

    it('regime AUSENTE ou INDEFINIDO mantém o comportamento antigo', () => {
        // Ausência não é prova: tirar crédito de quem talvez tenha direito é o
        // erro caro, e quem cobra o cadastro em branco é o farol de cadastro.
        expect(entradaGeraCreditoIcms({}).credita).toBe(true);
        expect(entradaGeraCreditoIcms({ regime: '', direcao: 'entrada' }).credita).toBe(true);
        expect(entradaGeraCreditoIcms({ regime: 'INDEFINIDO', direcao: 'entrada' }).credita).toBe(true);
    });

    it('SAÍDA não passa pela régua — ali o destaque é DÉBITO, outro fato', () => {
        expect(entradaGeraCreditoIcms({ regime: 'SIMPLES', direcao: 'saida' }).credita).toBe(true);
    });

    it('aceita o regime em qualquer caixa — o cadastro não é normalizado na tela', () => {
        expect(entradaGeraCreditoIcms({ regime: 'simples', direcao: 'entrada' }).credita).toBe(false);
    });
});

describe('colunaDoCstInformado', () => {
    it('40/41/50 → isentas · 30/51/60/90 → outras · 00/10/20/70 → tributada', () => {
        for (const c of ['40', '41', '50']) expect(colunaDoCstInformado(c)).toBe('isentas');
        for (const c of ['30', '51', '60', '90']) expect(colunaDoCstInformado(c)).toBe('outras');
        for (const c of ['00', '10', '20', '70']) expect(colunaDoCstInformado(c)).toBe('tributada');
    });

    it('nada informado devolve null — e null não manda em nada', () => {
        expect(colunaDoCstInformado('')).toBeNull();
        expect(colunaDoCstInformado(null)).toBeNull();
        expect(colunaDoCstInformado(undefined)).toBeNull();
    });

    it('três dígitos: vale a TRIBUTAÇÃO, a origem é da mercadoria', () => {
        // Gravar "090" cru faria produto IMPORTADO virar NACIONAL no SPED — a
        // razão de o campo ser só a tributação (19/08).
        expect(colunaDoCstInformado('090')).toBe('outras');
        expect(colunaDoCstInformado('141')).toBe('isentas');
        // origem 7 (importada por conta própria) + tributação 00 = TRIBUTADA:
        // é justamente a mercadoria importada que a origem existe para não
        // perder — trocar a coluna por causa do 1º dígito seria o erro.
        expect(colunaDoCstInformado('700')).toBe('tributada');
    });

    it('código fora da Tabela B não vira balde inventado', () => {
        expect(colunaDoCstInformado('99')).toBeNull();
        expect(colunaDoCstInformado('abc')).toBeNull();
    });
});

describe('ctxAlocacaoDoDoc — dono único do contexto', () => {
    const nota = (over: any = {}) => ({
        id: 'X', tipo: 'NFe', tpNF: '0', direcao: 'entrada',
        itens: [{ vProd: 100, vBC: 100, vICMS: 18, cst: '00' }],
        ...over,
    });

    it('entrada de optante do Simples nasce SEM crédito', () => {
        const c = ctxAlocacaoDoDoc(nota(), { regimeTributario: 'SIMPLES' });
        expect(c.semCreditoIcms).toBe(true);
    });

    it('leva o CST informado NA NOTA — é ele que não chegava ao livro', () => {
        const c = ctxAlocacaoDoDoc(nota({ cstEscriturado: '90' }), { regimeTributario: 'LUCRO_REAL' });
        expect(c.cstEscriturado).toBe('90');
        expect(c.semCreditoIcms).toBe(false);
    });

    it('a direção sai da RÉGUA, não do campo cru — nota própria de entrada (tpNF=0)', () => {
        // Ela fica gravada como 'saida' até o backfill passar; lendo o campo
        // cru, a saída "não credita" nunca chegaria a valer nela.
        const c = ctxAlocacaoDoDoc(
            nota({ direcao: 'saida', tpNF: '0', empresaCnpj: '11111111000191', cnpjEmit: '11111111000191' }),
            { regimeTributario: 'SIMPLES' },
        );
        expect(c.semCreditoIcms).toBe(true);
    });

    it('sem contexto de empresa não afirma nada', () => {
        expect(ctxAlocacaoDoDoc(nota(), null).semCreditoIcms).toBe(false);
    });
});

/**
 * 🔒 A TRAVA DOS LEITORES. As colunas do livro têm TRÊS consumidores — Livro,
 * Resumo por CFOP e Exportar SAGE — e eles precisam responder IGUAL sobre a
 * mesma nota. Chamada sem o `ctx` volta a creditar em silêncio, e o número
 * fica plausível: o pior jeito de errar.
 */
describe('todos os leitores das colunas passam pelo mesmo contexto', () => {
    const CONSUMIDORES = [
        'services/relatoriosAgregacoes.ts',
        'components/Relatorios/index.tsx',
        'services/iobSageExportService.ts',
    ];

    it.each(CONSUMIDORES)('%s chama alocarTributacaoIcms COM contexto', (arquivo) => {
        const fonte = semComentario(ler(arquivo));
        const chamadas = fonte.match(/alocarTributacaoIcms\(/g) || [];
        expect(chamadas.length).toBeGreaterThan(0);
        // Toda chamada de produção passa por `ctxAlocacaoDoDoc` — montar o
        // objeto à mão é a segunda cópia com outra roupa (27/08).
        const semDono = fonte.match(/alocarTributacaoIcms\([^;]*?\)\s*;/gs) || [];
        for (const c of semDono) {
            expect(c).toMatch(/ctxAlocacaoDoDoc\(/);
        }
    });

    // ⚠️ Só quem MONTA o contexto entra aqui. `relatoriosAgregacoes.ts` apenas
    // DECLARA o campo na interface — cobrá-lo ali seria alarme sobre código
    // certo, o jeito conhecido de a equipe desligar a trava.
    it.each(['components/Relatorios/index.tsx', 'components/xml/XmlExportarIobSage.tsx'])(
        '%s entrega o REGIME no contexto da empresa', (arquivo) => {
            expect(semComentario(ler(arquivo))).toMatch(/regimeTributario:/);
        });

    it('o contrato do contexto DECLARA o regime — sem isso ele some na fronteira', () => {
        expect(semComentario(ler('services/relatoriosAgregacoes.ts')))
            .toMatch(/regimeTributario\?:/);
        expect(semComentario(ler('services/iobSageExportService.ts')))
            .toMatch(/regimeTributario\?:/);
    });

    it('quem resolve o regime é o DONO, nunca a coleção lida na tela', () => {
        for (const a of ['components/Relatorios/index.tsx', 'components/xml/XmlExportarIobSage.tsx']) {
            expect(semComentario(ler(a))).toMatch(/regimeDaEmpresa\(/);
        }
    });

    it('o crédito é decidido pela régua, nunca por um if de tela', () => {
        for (const a of ['services/iobSageExportService.ts', 'components/Relatorios/index.tsx']) {
            const fonte = semComentario(ler(a));
            expect(fonte).toMatch(/entradaGeraCreditoIcms\(/);
            // Nome do regime cravado numa comparação de tela é a segunda régua.
            expect(fonte).not.toMatch(/===\s*['"]SIMPLES['"]/);
        }
    });
});

/** A ponta a ponta: o número do print, pelo caminho que a produção usa. */
describe('MV LIDER 634934 — ponta a ponta', () => {
    const doc = () => ({
        id: 'mv', tipo: 'NFe', tpNF: '0', direcao: 'entrada',
        totais: { vNF: 964.99 },
        itens: [
            { vProd: 197.03, vICMS: 0, cst: '60' },
            { vProd: 192.51, vICMS: 0, cst: '60' },
            { vProd: 463.20, vICMS: 0, cst: '60' },
            { vProd: 112.25, vBC: 112.25, vICMS: 20.21, cst: '00' },
        ],
    });

    it('SIMPLES: o crédito de 20,21 sai do livro e vira Outras', () => {
        const a = alocarTributacaoIcms(
            doc().itens as any, 964.99,
            ctxAlocacaoDoDoc(doc(), { regimeTributario: 'SIMPLES' }),
        );
        expect(a.icms).toBe(0);
        expect(a.outras).toBeCloseTo(964.99, 2);
    });

    it('e o CST informado resolve o caso pontual mesmo no Lucro', () => {
        const a = alocarTributacaoIcms(
            doc().itens as any, 964.99,
            ctxAlocacaoDoDoc({ ...doc(), cstEscriturado: '60' }, { regimeTributario: 'LUCRO_PRESUMIDO' }),
        );
        expect(a.icms).toBe(0);
        expect(a.outras).toBeCloseTo(964.99, 2);
    });
});
