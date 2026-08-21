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

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 O CAMPO "VAI NO DOCUMENTO" COMIA A VÍRGULA — caso APATEL 0371 (21/08).
//
// A colaboradora colou os valores do e-Fiscal ("3.241.688,71") e a declaração
// ASSINADA saiu com 324.168.871,00 — cem vezes o faturamento; o total,
// R$ 4,2 BILHÕES numa empresa de R$ 42 milhões.
//
// Não era o parse: era o input controlado por `String(número)`, re-parseando o
// próprio texto exibido a cada tecla. Na tecla da vírgula, o parse devolvia o
// inteiro, o render apagava a vírgula da tela, e os dígitos seguintes grudavam:
// "3241688,71" → 324168871, sem nenhum erro aparecer.
//
// Correção: o campo guarda TEXTO (rascunho), o parse é a régua pura abaixo, e
// o que o app ENTENDEU aparece formatado ao lado ("ajustado = R$ …") — num
// papel assinado, a interpretação tem que ser visível ANTES do PDF.
// ═══════════════════════════════════════════════════════════════════════════
import { parseValorMoeda } from '../services/declaracaoFaturamento';
import * as fs from 'fs';
import * as path from 'path';

describe('🚨 parseValorMoeda — as formas que chegam de verdade', () => {
    it('o caso APATEL: colado do e-Fiscal, com ponto e vírgula', () => {
        expect(parseValorMoeda('3.241.688,71')).toBeCloseTo(3241688.71, 2);
        expect(parseValorMoeda('26.148.319,35')).toBeCloseTo(26148319.35, 2);
    });

    it('digitado sem milhar, e a forma JS com ponto decimal', () => {
        expect(parseValorMoeda('3241688,71')).toBeCloseTo(3241688.71, 2);
        expect(parseValorMoeda('3241688.71')).toBeCloseTo(3241688.71, 2);
        expect(parseValorMoeda('76178')).toBe(76178);
    });

    it('ponto de milhar SEM vírgula continua milhar (como o e-Fiscal imprime)', () => {
        expect(parseValorMoeda('1.234')).toBe(1234);
        expect(parseValorMoeda('1.234.567')).toBe(1234567);
    });

    it('prefixo R$ e espaços não atrapalham quem cola da tela', () => {
        expect(parseValorMoeda('R$ 3.241.688,71')).toBeCloseTo(3241688.71, 2);
    });

    it('ilegível devolve NULL, nunca um número inventado', () => {
        expect(parseValorMoeda('')).toBeNull();
        expect(parseValorMoeda('abc')).toBeNull();
        expect(parseValorMoeda('3.241,68,71')).toBeNull();
        expect(parseValorMoeda('-100')).toBeNull();
    });

    it('🚨 e o TEXTO INTEIRO digitado tecla a tecla fecha certo — a vírgula sobrevive', () => {
        // Com o estado guardando texto, o valor final do campo é o que a
        // pessoa digitou. É o cenário exato que o round-trip antigo quebrava.
        const teclas = '3241688,71'.split('');
        let texto = '';
        for (const t of teclas) texto += t;
        expect(parseValorMoeda(texto)).toBeCloseTo(3241688.71, 2);
    });
});

describe('🚨 a tela guarda TEXTO, nunca String(número) — a trava do round-trip', () => {
    const tela = fs.readFileSync(path.resolve(__dirname, '../components/Relatorios/index.tsx'), 'utf8');

    it('o input do "Vai no documento" é ligado ao rascunho de texto', () => {
        expect(tela).toMatch(/value=\{ajustesTexto\[m\.competencia\] \?\? ''\}/);
        // A forma antiga — re-formatar o número de volta pro campo — é barrada.
        expect(tela).not.toMatch(/String\(ajustes\[m\.competencia\]\)/);
    });

    it('quem interpreta é a régua pura, não um replace inline', () => {
        const bloco = tela.slice(tela.indexOf('const editar = (competencia'), tela.indexOf('const total = meses'));
        expect(bloco).toMatch(/parseValorMoeda\(texto\)/);
        expect(bloco).not.toMatch(/replace\(\/\\\.\/g/);
    });

    it('o que o app ENTENDEU aparece formatado, e o ilegível é dito em vermelho', () => {
        expect(tela).toMatch(/ajustado = \{fmtBRL\(m\.valor\)\}/);
        expect(tela).toMatch(/valor ilegível — use o formato/);
    });
});
