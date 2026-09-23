// ============================================================================
// 🚨 O SPED DA ELS (Simples · distribuidora) — TRÊS recusas do PVA, três causas
//
// 11/09, Paulo, DISTRIBUIDORA ELS · 08/2026, com o print do PVA e o Livro de
// Entradas do CFI lado a lado: *"ajustou cod de participante, porém ele está
// pedindo cod de participante das notas canceladas e unidade de registro. e no
// livro de entrada está puxando algumas notas com ICMS, mas no livro do
// consultor está certinho"*.
//
//   19× "Para documento fiscal cancelado (02 ou 03) ou NF-e denegada (04),
//       somente informar os campos código da situação, indicador de operação,
//       código do modelo e a chave"            → o C100 da cancelada levava
//       COD_PART (e a denegada nem entrava na exceção).
//   13× "Se o campo de Unidade deste registro for diferente do campo Unidade
//       do registro 0200, é obrigatório que o registro 0200 possua um filho
//       0220"                                   → o cProd é do FORNECEDOR; dois
//       fornecedores com o mesmo código e unidades diferentes.
//    1× "Inscrição Estadual inválida"          → o 0000 escrevia a IE com os
//       pontos do cadastro.
//    8× advertências de crédito de ICMS na entrada de optante do Simples
//                                               → o C170/C190 copiava o
//       destaque do fornecedor; o Livro do CFI já lia a régua de 09/09.
//
// CNPJs e IE FICTÍCIOS — dado de cliente não entra no repo.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-ignore — módulo JS do backend, sem `.d.ts`
import { buildBlocoC } from '../sefaz-backend/sped-fiscal-blocoC.js';
// @ts-ignore — módulo JS do backend, sem `.d.ts`
import { buildBlocoD } from '../sefaz-backend/sped-fiscal-blocoD.js';
// @ts-ignore — módulo JS do backend, sem `.d.ts`
import { buildBloco0 } from '../sefaz-backend/sped-fiscal-bloco0.js';
// @ts-ignore — módulo JS do backend, sem `.d.ts`
import { conferirCodPartDoC100, conferirCanceladaSoCampos } from '../sefaz-backend/sped-c100-regras-comuns.js';
// @ts-ignore — módulo JS do backend, sem `.d.ts`
import { sanitizeIe, motivoIeInvalida } from '../sefaz-backend/sped-fiscal-format.js';
import {
    documentosEscrituradosNoFiscal, unidadesPorCodItem, codItemNoArquivo, codigosComDuasUnidades,
    avisoDeItemComDuasUnidades,
} from '../sefaz-backend/sped-selecao-documentos.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';

const RAIZ = join(__dirname, '..');
const EMPRESA = '11222333000181';
const FORNECEDOR_A = '44555666000177';
const FORNECEDOR_B = '77888999000155';
const CH55 = '35260844555666000177550010000012341000012345';
const CH55B = '35260877888999000155550010000056781000056789';
const L = (s: string) => `${s}\r\n`;
const linhas = (ls: string[], reg: string) => ls.map((l) => l.trim()).filter((l) => l.startsWith(`|${reg}|`));
const campos = (l: string) => l.trim().split('|');
const acha = (r: any, regra: string) => r.erros.filter((e: any) => e.regra === regra);

/** Entrada de TERCEIRO como o importer principal grava (achatada). */
const entrada = (over: Record<string, unknown> = {}) => ({
    id: CH55, chave: CH55, modelo: '55', numero: '1234', serie: '1', direcao: 'entrada', status: 'autorizado',
    tpNF: '1', dhEmi: '2026-08-05T10:00:00-03:00',
    cnpjEmit: FORNECEDOR_A, xNomeEmit: 'FORNECEDOR A LTDA', ufEmit: 'SP',
    cnpjDest: EMPRESA, xNomeDest: 'DISTRIBUIDORA TESTE LTDA',
    valorTotal: 118, totais: { vProd: 100, vNF: 118, vBC: 100, vICMS: 18 },
    itens: [{ nItem: '1', cProd: '1', xProd: 'BANANA PRATA', NCM: '08039000', CFOP: '5102', uCom: 'KG', qCom: 10, vProd: 100, CST: '000', vBC: 100, pICMS: 18, vICMS: 18 }],
    ...over,
});

const gerar = (notas: any[], empresa: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
    const dados: any = {
        empresa: { cnpj: EMPRESA, _regime: 'lucro', regimePadrao: 'LUCRO_PRESUMIDO', dadosFiscais: { uf: 'SP' }, ...empresa },
        competencia: '2026-08', competenciaInicio: '2026-08', competenciaFim: '2026-08',
        notas, warnings: [] as string[], ...extra,
    };
    return { linhas: (buildBlocoC(dados) as string[]).map((l) => l.trim()), dados };
};

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 (1) cancelada/denegada sai SÓ com os campos da Exceção 1', () => {
    it('C100 cancelada: sem COD_PART, sem valores, sem filhos — só IND_OPER, IND_EMIT, COD_MOD, COD_SIT, SER, NUM_DOC e chave', () => {
        const { linhas: ls } = gerar([entrada({ status: 'cancelado' })]);
        const c100 = campos(linhas(ls, 'C100')[0]);
        expect(c100[6]).toBe('02');
        expect(c100[4]).toBe('');            // COD_PART — o que o PVA cobrou 19×
        expect(c100[9]).toBe(CH55);          // a chave FICA
        for (const pos of [10, 11, 12, 13, 14, 16, 21, 22]) expect(c100[pos]).toBe('');
        expect(linhas(ls, 'C170')).toHaveLength(0);
        expect(linhas(ls, 'C190')).toHaveLength(0);
    });

    it('DENEGADA (04) entra na mesma exceção — ela ficava de fora', () => {
        const { linhas: ls } = gerar([entrada({ status: 'denegado' })]);
        const c100 = campos(linhas(ls, 'C100')[0]);
        expect(c100[6]).toBe('04');
        expect(c100[4]).toBe('');
        expect(c100[12]).toBe('');
        expect(linhas(ls, 'C190')).toHaveLength(0);
    });

    it('cancelada por EVENTO (status ainda "autorizado") também', () => {
        const { linhas: ls } = gerar([entrada({ eventos: [{ tpEvento: '110111', cStat: '135' }] })]);
        const c100 = campos(linhas(ls, 'C100')[0]);
        expect(c100[6]).toBe('02');
        expect(c100[4]).toBe('');
    });

    it('a nota REGULAR continua com COD_PART e valores — nada regrediu', () => {
        const { linhas: ls } = gerar([entrada()]);
        const c100 = campos(linhas(ls, 'C100')[0]);
        expect(c100[4]).toBe(FORNECEDOR_A);
        expect(c100[12]).toBe('118,00');
    });

    it('a cancelada NÃO sustenta participante nem item — 0150/0200 dela seriam órfãos', () => {
        const cancelada = entrada({ status: 'cancelado' });
        const regular = entrada({ id: CH55B, chave: CH55B, numero: '5678', cnpjEmit: FORNECEDOR_B });
        const cte = { id: 'cte1', chave: '35260831947349000169570010000000031705547508', tipoDoc: 'CTe', direcao: 'entrada', status: 'cancelado', cfop: '5352', valorTotal: 10, cnpjEmit: FORNECEDOR_B };
        const e = documentosEscrituradosNoFiscal([cancelada, regular, cte], EMPRESA);
        expect(e.escriturado(regular)).toBe(true);
        expect(e.escriturado(cancelada)).toBe(false);
        expect(e.escriturado(cte)).toBe(false);
    });

    it('D100 do CT-e cancelado: sem COD_PART, sem datas/valores e sem D190', () => {
        const cte = {
            chave: '35260731947349000169570010000000031705547508', tipoDoc: 'CTe', direcao: 'entrada',
            status: 'cancelado', numero: '4321', dhEmi: '2026-08-10T10:00:00-03:00', valorTotal: 1500,
            cfop: '5352', cstIcms: '00', cnpjEmit: FORNECEDOR_B, xNomeEmit: 'TRANSPORTADORA LTDA',
        };
        const ls = (buildBlocoD({
            empresa: { _regime: 'lucro', cnpj: EMPRESA, dadosFiscais: { uf: 'SP' } },
            competenciaInicio: '2026-08', competenciaFim: '2026-08', notas: [cte], warnings: [],
        }) as string[]).map((l) => l.trim());
        const d100 = campos(linhas(ls, 'D100')[0]);
        expect(d100[6]).toBe('02');
        expect(d100[4]).toBe('');
        expect(d100[11]).toBe('');
        expect(d100[16]).toBe('');
        expect(linhas(ls, 'D190')).toHaveLength(0);
    });

    describe('a prevalidação (R42) e a regra do COD_PART', () => {
        const CANCELADA_COM_CAMPOS = L(`|C100|0|1|${FORNECEDOR_A}|55|02|001|1234|${CH55}|05082026|05082026|118,00|0||100,00|9|||||100,00|18,00|||||||`);
        const CANCELADA_LIMPA = L(`|C100|0|1||55|02|001|1234|${CH55}||||||||||||||||||||`);
        const DENEGADA_LIMPA = L(`|C100|0|1||55|04|001|1234|${CH55}||||||||||||||||||||`);

        it('cancelada com COD_PART e valores é acusada, nomeando o COD_PART', () => {
            const e = conferirCanceladaSoCampos([CANCELADA_COM_CAMPOS]);
            expect(e).toHaveLength(1);
            expect(e[0].regra).toBe('c100-cancelada-com-campos');
            expect(e[0].campo).toMatch(/4 - COD_PART/);
            expect(e[0].fonte).toMatch(/somente informar os campos/);
        });

        it('cancelada e denegada LIMPAS passam — e ninguém cobra COD_PART delas', () => {
            expect(conferirCanceladaSoCampos([CANCELADA_LIMPA, DENEGADA_LIMPA])).toEqual([]);
            expect(conferirCodPartDoC100([CANCELADA_LIMPA, DENEGADA_LIMPA])).toEqual([]);
        });

        it('a regra do COD_PART continua acusando a nota REGULAR de terceiro sem participante', () => {
            const regular = L(`|C100|0|1||55|00|001|1234|${CH55}|05082026|05082026|118,00|0||100,00|9|||||100,00|18,00|||||||`);
            expect(conferirCodPartDoC100([regular]).map((e: any) => e.regra)).toEqual(['c100-sem-cod-part']);
        });

        it('a R6 (C100 sem C190) não acusa a DENEGADA', () => {
            const r = prevalidarSpedFiscal([DENEGADA_LIMPA, L('|C990|2|')]);
            expect(acha(r, 'c100-sem-c190')).toHaveLength(0);
            expect(acha(r, 'c100-cancelada-com-campos')).toHaveLength(0);
        });

        it('o gerador real nasce VERDE na R42 e a linha do 11/09 (o defeito) é acusada', () => {
            const { linhas: ls } = gerar([entrada({ status: 'cancelado' })]);
            expect(acha(prevalidarSpedFiscal(ls.map(L)), 'c100-cancelada-com-campos')).toHaveLength(0);
            expect(acha(prevalidarSpedFiscal([CANCELADA_COM_CAMPOS]), 'c100-cancelada-com-campos')).toHaveLength(1);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 (2) o mesmo código com DUAS unidades — 0200 e C170 concordam pelo sufixo', () => {
    const notaA = entrada();                                                             // cProd 1 em KG
    const notaB = entrada({                                                              // cProd 1 em CX, outro fornecedor
        id: CH55B, chave: CH55B, numero: '5678', cnpjEmit: FORNECEDOR_B, xNomeEmit: 'FORNECEDOR B LTDA',
        itens: [{ nItem: '1', cProd: '1', xProd: 'CAIXA DE BANANA', NCM: '08039000', CFOP: '5102', uCom: 'CX', qCom: 2, vProd: 100, CST: '000', vBC: 100, pICMS: 18, vICMS: 18 }],
    });

    it('o mapa vê as duas unidades e o sufixo é DETERMINÍSTICO (nas duas ocorrências, em qualquer ordem)', () => {
        const mapa = unidadesPorCodItem([notaA, notaB], () => true);
        expect(Array.from(mapa.get('1')!)).toEqual(['KG', 'CX']);
        expect(codItemNoArquivo(notaA.itens[0], mapa)).toBe('1-KG');
        expect(codItemNoArquivo(notaB.itens[0], mapa)).toBe('1-CX');
        const invertido = unidadesPorCodItem([notaB, notaA], () => true);
        expect(codItemNoArquivo(notaA.itens[0], invertido)).toBe('1-KG');
        expect(codigosComDuasUnidades(mapa)).toEqual([{ codItem: '1', unidades: ['CX', 'KG'] }]);
        expect(avisoDeItemComDuasUnidades(codigosComDuasUnidades(mapa))).toMatch(/1 \(CX × KG\)/);
    });

    it('código com UMA unidade fica LIMPO — nada muda no caso comum', () => {
        const mapa = unidadesPorCodItem([notaA], () => true);
        expect(codItemNoArquivo(notaA.itens[0], mapa)).toBe('1');
        expect(codItemNoArquivo(notaA.itens[0], undefined)).toBe('1');
        expect(codigosComDuasUnidades(mapa)).toEqual([]);
        expect(avisoDeItemComDuasUnidades([])).toBe('');
    });

    it('o filtro `entra` decide quem alimenta o mapa (a nota fora do arquivo não conta)', () => {
        const mapa = unidadesPorCodItem([notaA, notaB], (n: any) => n.chave === CH55);
        expect(codItemNoArquivo(notaB.itens[0], mapa)).toBe('1');
    });

    it('o C170 do gerador REAL lê o mesmo mapa que o 0200 recebe', () => {
        const mapa = unidadesPorCodItem([notaA, notaB], () => true);
        const { linhas: ls } = gerar([notaA, notaB], {}, { unidadesPorCodItem: mapa });
        const cods = linhas(ls, 'C170').map((l) => campos(l)[3]).sort();
        expect(cods).toEqual(['1-CX', '1-KG']);
    });

    it('e os DOIS orquestradores passam o mapa pelo mesmo nome — chave calculada em dois lugares foi o defeito de 22/08', () => {
        const fiscal = readFileSync(join(RAIZ, 'sefaz-backend/sped-fiscal-orchestrator.js'), 'utf8');
        const contrib = readFileSync(join(RAIZ, 'sefaz-backend/sped-contrib-orchestrator.js'), 'utf8');
        const blocoC = readFileSync(join(RAIZ, 'sefaz-backend/sped-fiscal-blocoC.js'), 'utf8');
        const contribBlocos = readFileSync(join(RAIZ, 'sefaz-backend/sped-contrib-blocos.js'), 'utf8');
        for (const src of [fiscal, contrib]) {
            expect(src).toMatch(/const unidadesPorCodigo = unidadesPorCodItem\(notas,/);
            expect(src).toMatch(/codItemNoArquivo\(item, unidadesPorCodigo\)/);
            expect(src).toMatch(/unidadesPorCodItem: unidadesPorCodigo/);
        }
        expect(blocoC).toMatch(/codItemNoArquivo\(item, nota\._dados\?\.unidadesPorCodItem\)/);
        expect((contribBlocos.match(/codItemNoArquivo\(item, dados\.unidadesPorCodItem\)/g) || []).length).toBe(2);
    });

    describe('R43 — C170 UNID ≠ 0200 UNID_INV sem 0220', () => {
        const r0200 = (cod: string, unid: string, tipo = '00') => L(`|0200|${cod}|BANANA|||${unid}|${tipo}|08039000|||||`);
        const c170 = (cod: string, unid: string) => L(`|C170|001|${cod}||10,00000|${unid}|100,00|0,00|0|000|1102||0,00|0,00|0,00|0,00|0,00|0,00|0||||||||||||||||||`);
        it('acusa o item cadastrado em KG saindo em CX, com a ação', () => {
            const r = prevalidarSpedFiscal([r0200('1', 'KG'), c170('1', 'CX')]);
            const e = acha(r, 'c170-unid-x-0200');
            expect(e).toHaveLength(1);
            expect(e[0].acao).toMatch(/código\+unidade/);
        });
        it('com 0220 para a unidade, ou TIPO_ITEM 07, ou unidade igual — não acusa', () => {
            expect(acha(prevalidarSpedFiscal([r0200('1', 'KG'), L('|0220|CX|20,000000|'), c170('1', 'CX')]), 'c170-unid-x-0200')).toHaveLength(0);
            expect(acha(prevalidarSpedFiscal([r0200('1', 'KG', '07'), c170('1', 'CX')]), 'c170-unid-x-0200')).toHaveLength(0);
            expect(acha(prevalidarSpedFiscal([r0200('1', 'KG'), c170('1', 'KG')]), 'c170-unid-x-0200')).toHaveLength(0);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 (3) optante do Simples não credita ICMS na ENTRADA — o SPED lê a régua do Livro', () => {
    const SIMPLES = { _regime: 'simples', regimePadrao: undefined };

    it('C170: CST x90, base/alíquota/ICMS zero; C190 e C100 concordam', () => {
        const { linhas: ls, dados } = gerar([entrada()], SIMPLES);
        const c170 = campos(linhas(ls, 'C170')[0]);
        expect(c170[10]).toBe('090');
        expect([c170[13], c170[14], c170[15]]).toEqual(['0,00', '0,00', '0,00']);
        const c190 = campos(linhas(ls, 'C190')[0]);
        expect(c190[2]).toBe('090');
        expect([c190[4], c190[6], c190[7], c190[10]]).toEqual(['0,00', '0,00', '0,00', '0,00']);   // aliq, BC, ICMS, RED_BC
        expect(c190[5]).toBe('100,00');                                                           // VL_OPR fica
        const c100 = campos(linhas(ls, 'C100')[0]);
        expect([c100[21], c100[22]]).toEqual(['0,00', '0,00']);
        expect(dados.warnings.join('\n')).toMatch(/SEM crédito de ICMS/);
        expect(dados.warnings.join('\n')).toMatch(/optante do Simples/);
    });

    it('a ORIGEM do CST é preservada (importado 1xx → 190)', () => {
        const n = entrada({ itens: [{ ...entrada().itens[0], CST: '100' }] });
        const { linhas: ls } = gerar([n], SIMPLES);
        expect(campos(linhas(ls, 'C170')[0])[10]).toBe('190');
    });

    it('isento/ST (40, 60) NÃO vira 90 — cada um declara um fato', () => {
        const n = entrada({ itens: [{ ...entrada().itens[0], CST: '060', vBC: 0, vICMS: 0, vBCST: 50, vICMSST: 9 }] });
        const { linhas: ls } = gerar([n], SIMPLES);
        const c170 = campos(linhas(ls, 'C170')[0]);
        expect(c170[10]).toBe('060');
        expect(c170[18]).toBe('9,00');   // o ST retido continua no registro
    });

    it('CST INFORMADO na nota (00) mantém o crédito — quem olhou a nota decide', () => {
        const n = entrada({ escrituracaoItens: { 1: { cfop: '1102', cst: '00', por: 'x', em: 'y' } } });
        const { linhas: ls, dados } = gerar([n], SIMPLES);
        const c170 = campos(linhas(ls, 'C170')[0]);
        expect(c170[10]).toBe('000');
        expect(c170[15]).toBe('18,00');
        expect(dados.warnings.join('\n')).not.toMatch(/SEM crédito de ICMS/);
    });

    it('CST informado SEM crédito (90) zera os valores mesmo com o destaque do fornecedor', () => {
        const n = entrada({ escrituracaoItens: { 1: { cfop: '1102', cst: '90', por: 'x', em: 'y' } } });
        const { linhas: ls } = gerar([n], SIMPLES);
        const c170 = campos(linhas(ls, 'C170')[0]);
        expect(c170[10]).toBe('090');
        expect(c170[15]).toBe('0,00');
    });

    it('no LUCRO nada muda (regime com crédito) e na SAÍDA do optante o destaque é débito, não crédito', () => {
        const { linhas: lucro, dados: dl } = gerar([entrada()]);
        expect(campos(linhas(lucro, 'C170')[0])[15]).toBe('18,00');
        expect(dl.warnings.join('\n')).not.toMatch(/SEM crédito/);
        const saida = entrada({ direcao: 'saida', cnpjEmit: EMPRESA, cnpjDest: FORNECEDOR_A, xNomeEmit: 'DISTRIBUIDORA TESTE LTDA', xNomeDest: 'CLIENTE' });
        const { linhas: ls } = gerar([saida], SIMPLES);
        // Emissão própria: só C190 (Exceção 2), e o C190 mantém o débito.
        expect(campos(linhas(ls, 'C190')[0])[7]).toBe('18,00');
    });

    it('regime DESCONHECIDO mantém o comportamento antigo — ausência não é prova', () => {
        const { linhas: ls } = gerar([entrada()], { _regime: undefined, regimePadrao: undefined, colecao: undefined });
        expect(campos(linhas(ls, 'C170')[0])[15]).toBe('18,00');
    });

    it('R44 acusa o C170 de entrada com crédito só quando o contexto diz SIMPLES', () => {
        const arq = [
            L(`|C100|0|1|${FORNECEDOR_A}|55|00|001|1234|${CH55}|05082026|05082026|118,00|0||100,00|9|||||100,00|18,00|||||||`),
            L('|C170|001|1||10,00000|KG|100,00|0,00|0|000|1102||100,00|18,00|18,00|0,00|0,00|0,00|0||||||||||||||||||'),
        ];
        expect(acha(prevalidarSpedFiscal(arq, { regime: 'SIMPLES' }), 'optante-credito-icms-entrada')).toHaveLength(1);
        expect(acha(prevalidarSpedFiscal(arq, { regime: 'LUCRO_PRESUMIDO' }), 'optante-credito-icms-entrada')).toHaveLength(0);
        expect(acha(prevalidarSpedFiscal(arq), 'optante-credito-icms-entrada')).toHaveLength(0);
        // E o gerador real do optante nasce VERDE nela.
        const { linhas: ls } = gerar([entrada()], SIMPLES);
        expect(acha(prevalidarSpedFiscal(ls.map(L), { regime: 'SIMPLES' }), 'optante-credito-icms-entrada')).toHaveLength(0);
    });

    it('a rota passa o regime à prevalidação e o orquestrador o calcula pelo dono', () => {
        const rota = readFileSync(join(RAIZ, 'sefaz-backend/sped-fiscal-routes.js'), 'utf8');
        expect(rota).toMatch(/regime: dados\.regimeEscrituracao/);
        const orq = readFileSync(join(RAIZ, 'sefaz-backend/sped-fiscal-orchestrator.js'), 'utf8');
        expect(orq).toMatch(/regimeDaEmpresa\(\{ \.\.\.empresa, colecao:/);
        expect(orq).toMatch(/^\s+regimeEscrituracao,$/m);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 (4) a IE do 0000 sai só com dígitos, e a IE torta vai DITA', () => {
    const dados0 = (ie: string, uf = 'SP') => ({
        empresa: {
            nome: 'DISTRIBUIDORA TESTE LTDA', cnpj: EMPRESA,
            dadosFiscais: { uf, inscricaoEstadual: ie, codMunIBGE: '3550308', cep: '01001000', contribuinteIpi: 'nao' },
        },
        contador: { nome: 'C', cpf: '11111111111', crc: '1SP000000' },
        competenciaInicio: '2026-08', competenciaFim: '2026-08',
        notas: [], participantes: [], unidades: [], itens: [], warnings: [] as string[],
    });

    it('sanitizeIe: pontuação sai, ISENTO vira vazio', () => {
        expect(sanitizeIe('110.042.490.114')).toBe('110042490114');
        expect(sanitizeIe('ISENTO')).toBe('');
        expect(motivoIeInvalida('SP', '110042490114')).toBeNull();
        expect(motivoIeInvalida('SP', '158.638.009.11')).toMatch(/11 dígito/);
        expect(motivoIeInvalida('MG', '1234567')).toBeNull();     // UF sem comprimento provado: não afirma
    });

    it('o 0000 real escreve a IE sem pontos, e avisa quando ela tem 11 dígitos numa empresa de SP', () => {
        const d: any = dados0('158.638.009.11');
        const ls = (buildBloco0(d) as string[]).map((l) => l.trim());
        expect(campos(linhas(ls, '0000')[0])[10]).toBe('15863800911');
        expect(d.warnings.join('\n')).toMatch(/Inscrição Estadual inválida/);
        expect(d.warnings.join('\n')).toMatch(/Dados Fiscais/);
        const ok: any = dados0('110.042.490.114');
        (buildBloco0(ok) as string[]);
        expect(ok.warnings.join('\n')).not.toMatch(/Inscrição Estadual/);
    });

    it('R45 acusa 11 dígitos em SP e caractere não numérico; 12 dígitos passam', () => {
        const r0000 = (ie: string) => L(`|0000|020|0|01082026|31082026|X|${EMPRESA}||SP|${ie}|3550308|||A|0|`);
        expect(acha(prevalidarSpedFiscal([r0000('15863800911')]), '0000-ie-invalida')).toHaveLength(1);
        expect(acha(prevalidarSpedFiscal([r0000('158.638.009.11')]), '0000-ie-invalida')).toHaveLength(1);
        expect(acha(prevalidarSpedFiscal([r0000('110042490114')]), '0000-ie-invalida')).toHaveLength(0);
        expect(acha(prevalidarSpedFiscal([r0000('')]), '0000-ie-invalida')).toHaveLength(0);
    });
});
