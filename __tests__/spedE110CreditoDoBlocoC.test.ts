// ============================================================================
// 🚨 O E110 SOMAVA O ICMS CRU DAS ENTRADAS — e o C190 do MESMO arquivo já saía
// ZERADO pela régua do crédito. O PVA cruza os dois.
//
// LEGACY COMERCIO DE LIVROS · DF · 08/2026 (11/09, Paulo, com o Relatório de
// Erros do PVA): *"O valor deve ser igual a soma do campo VL_ICMS dos registros
// (C190, C590, D190, D590, D730 para CFOP iniciado por 1 (exceto 1605), 2, 3 e
// CFOP 5605"* — `6 - VL_TOT_CREDITOS` · esperado 0,00 · conteúdo **4569,96**:
//   |E110|0,00|0,00|0,00|0,00|4569,96|0,00|0,00|0,00|0,00|0,00|0,00|4569,96|0,00|0,00|
//
// A causa: `somarIcmsPorDirecao` somava `item.vICMS` CRU (o destaque do
// FORNECEDOR), enquanto o C170/C190 — desde a manhã do mesmo dia (ELS) — passam
// por `icmsDoItemNoArquivo`, que zera o crédito que o REGIME ou o CST INFORMADO
// tiram. Duas leituras do mesmo item em passos diferentes do gerador: o C190
// dizia zero, o E110 dizia 4.569,96, e os 4.569,96 viravam saldo credor a
// TRANSPORTAR — imposto a MENOS nos meses seguintes.
//
// E o segundo achado do MESMO print: o c.10 (saldo credor anterior) saiu 0,00
// com o saldo *"já informado na ficha financeira"* — informado em AGOSTO, no
// campo "Mês Anterior"; o código lia o de JULHO (a defasagem de 17/08).
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoC, somarIcmsNoArquivo } from '../sefaz-backend/sped-fiscal-blocoC.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoE, somarIcmsPorDirecao } from '../sefaz-backend/sped-fiscal-blocoE.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';

const RAIZ = join(__dirname, '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');
const EMPRESA = '14583444000101';
const FORNECEDOR = '44555666000177';
const CH_ENT = '53260844555666000177550010000012341000012345';
const CH_SAI = '53260814583444000101550010000000991000000999';
const linhas = (ls: string[], reg: string) => ls.map((l) => l.trim()).filter((l) => l.startsWith(`|${reg}|`));
const campos = (l: string) => l.trim().split('|');
const brl = (s: string) => parseFloat(s.replace(',', '.')) || 0;

/** Entrada de TERCEIRO como o importer principal grava (achatada), com ICMS destacado. */
const entrada = (over: Record<string, unknown> = {}) => ({
    id: CH_ENT, chave: CH_ENT, numero: '1234', serie: '1', direcao: 'entrada', status: 'autorizado',
    tpNF: '1', dhEmi: '2026-08-05T10:00:00-03:00',
    cnpjEmit: FORNECEDOR, xNomeEmit: 'EDITORA TESTE LTDA', ufEmit: 'SP',
    cnpjDest: EMPRESA, xNomeDest: 'LEGACY TESTE LTDA',
    valorTotal: 25388.67, totais: { vProd: 25388.67, vNF: 25388.67, vBC: 25388.67, vICMS: 4569.96 },
    itens: [{ nItem: '1', cProd: 'L1', xProd: 'LIVRO', NCM: '49019900', CFOP: '6102', uCom: 'UN', qCom: 10, vProd: 25388.67, CST: '000', vBC: 25388.67, pICMS: 18, vICMS: 4569.96 }],
    ...over,
});
const saida = (over: Record<string, unknown> = {}) => ({
    id: CH_SAI, chave: CH_SAI, numero: '99', serie: '1', direcao: 'saida', status: 'autorizado', tpNF: '1',
    dhEmi: '2026-08-10T10:00:00-03:00', cnpjEmit: EMPRESA, xNomeEmit: 'LEGACY TESTE LTDA',
    cnpjDest: '12345678000199', xNomeDest: 'CLIENTE', totais: { vProd: 500, vNF: 500, vBC: 500, vICMS: 90 },
    itens: [{ nItem: '1', cProd: 'V1', xProd: 'LIVRO', NCM: '49019900', CFOP: '5102', uCom: 'UN', qCom: 1, vProd: 500, CST: '000', vBC: 500, pICMS: 18, vICMS: 90 }],
    ...over,
});

const dadosDe = (notas: any[], empresa: Record<string, unknown> = {}) => ({
    empresa: { cnpj: EMPRESA, _regime: 'lucro', regimePadrao: 'LUCRO_PRESUMIDO', dadosFiscais: { uf: 'DF' }, ...empresa },
    competencia: '2026-08', competenciaInicio: '2026-08', competenciaFim: '2026-08',
    notas, warnings: [] as string[],
});

/** Gera C e E sobre o MESMO `dados`, na ordem do orquestrador (C antes). */
const gerar = (notas: any[], empresa: Record<string, unknown> = {}) => {
    const dados: any = dadosDe(notas, empresa);
    const c = (buildBlocoC(dados) as string[]).map((l) => l.trim());
    const e = (buildBlocoE(dados) as string[]).map((l) => l.trim());
    const e110 = campos(linhas(e, 'E110')[0]);
    const somaC190 = (dir: 'entrada' | 'saida') => linhas(c, 'C190')
        .filter((l) => (dir === 'entrada' ? /^[123]/ : /^[567]/).test(campos(l)[3]))
        .reduce((s, l) => s + brl(campos(l)[7]), 0);
    return { dados, c, e, e110, somaC190 };
};

describe('🚨 E110 c.06 = Σ VL_ICMS dos C190 de entrada — pela MESMA régua, não pelo destaque cru', () => {
    it('caso LEGACY: CST informado na nota (90 — Outras) zera o C190 E o E110 juntos', () => {
        const { e110, somaC190, c } = gerar([entrada({ cstEscriturado: '90' }), saida()]);
        expect(linhas(c, 'C190')).toHaveLength(2);
        expect(somaC190('entrada')).toBe(0);
        expect(e110[6]).toBe('0,00');             // VL_TOT_CREDITOS — antes: 4569,96
        expect(e110[14]).toBe('0,00');            // e o saldo a transportar não nasce do destaque do fornecedor
        expect(e110[2]).toBe('90,00');            // o débito da saída continua
    });

    it('optante do Simples (o caso ELS de manhã): o regime zera o crédito no C190 e no E110', () => {
        const { e110, somaC190 } = gerar([entrada(), saida()], { _regime: 'simples', regimePadrao: undefined });
        expect(somaC190('entrada')).toBe(0);
        // Simples não monta E110 com valores no bloco E (regime !== lucro) —
        // o que importa é a RÉGUA responder zero pela entrada:
        expect(somarIcmsPorDirecao([entrada()], 'entrada', dadosDe([], { _regime: 'simples', regimePadrao: undefined }))).toBe(0);
        expect(e110[6]).toBe('0,00');
    });

    it('Lucro sem CST informado: nada regride — o crédito continua no C190 E no E110, iguais', () => {
        const { e110, somaC190 } = gerar([entrada(), saida()]);
        expect(somaC190('entrada')).toBe(4569.96);
        expect(e110[6]).toBe('4569,96');
        expect(e110[2]).toBe('90,00');
        expect(e110[14]).toBe('4479,96');
    });

    it('CST informado que AFIRMA crédito (00) mantém o crédito nos dois lados', () => {
        const { e110, somaC190 } = gerar([entrada({ cstEscriturado: '00' }), saida()], { _regime: 'simples', regimePadrao: undefined });
        expect(somaC190('entrada')).toBe(4569.96);
        expect(somarIcmsPorDirecao([entrada({ cstEscriturado: '00' })], 'entrada', dadosDe([], { _regime: 'simples', regimePadrao: undefined }))).toBe(4569.96);
        void e110;
    });

    it('nota SÓ RESUMO (sem item) fica fora do E110 como fica fora do C190 — e não cai no total do documento', () => {
        const resumo = entrada({ itens: [], schema: 'resNFe_v1.01', tipoDoc: 'resNFe' });
        const { e110, c } = gerar([resumo, saida()]);
        expect(linhas(c, 'C190').filter((l) => /^[123]/.test(campos(l)[3]))).toHaveLength(0);
        expect(e110[6]).toBe('0,00');
    });

    it('cancelada sai sem C190 (Exceção 1) e não soma no E110', () => {
        const { e110 } = gerar([entrada({ status: 'cancelado' }), saida()]);
        expect(e110[6]).toBe('0,00');
    });

    it('a prevalidação R7 (a recusa literal do PVA) fica MUDA sobre o arquivo composto', () => {
        const { c, e } = gerar([entrada({ cstEscriturado: '90' }), entrada({ id: 'b', chave: CH_ENT.replace(/.$/, '7'), numero: '1235' }), saida()]);
        const arquivo = [...c, ...e].map((l) => `${l}\r\n`);
        const r = prevalidarSpedFiscal(arquivo, {});
        expect(r.erros.filter((x: any) => x.regra === 'e110-creditos')).toEqual([]);
    });
});

describe('🚦 trava na FONTE — um dono para o ICMS do E110', () => {
    it('o bloco E delega ao dono do bloco C e não soma vICMS cru para o ICMS', () => {
        const src = ler('sefaz-backend/sped-fiscal-blocoE.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        expect(src).toMatch(/return somarIcmsNoArquivo\(notas, direcao, dados\);/);
        expect(src).not.toMatch(/somarImpostoPorDirecao\(notas, direcao, 'vICMS', 'vICMS'\)/);
        expect(src).toMatch(/somarIcmsPorDirecao\(dados\.notas, 'entrada', dados\)/);
    });

    it('o dono passa pela MESMA seleção do bloco C e pelo MESMO somador do item', () => {
        const src = ler('sefaz-backend/sped-fiscal-blocoC.js');
        const fn = src.slice(src.indexOf('export function somarIcmsNoArquivo'));
        expect(fn).toMatch(/selecionarNotasBlocoC\(notas, dados\?\.empresa\?\.cnpj\)/);
        expect(fn).toMatch(/somarTotaisDosItens\(n\)\.vICMS/);
        expect(fn.slice(0, fn.indexOf('\n}'))).not.toMatch(/totais/);
    });

    it('o painel de crédito acumulado passa o contexto — número diferente do E110 é o painel divergindo do arquivo', () => {
        const src = ler('sefaz-backend/credito-acumulado.js');
        expect(src).toMatch(/somarIcmsPorDirecao\(notas, 'entrada', ctx\)/);
        expect(src).toMatch(/apurarCompetencia\(porComp\[c\], \{ empresa: /);
    });
});
