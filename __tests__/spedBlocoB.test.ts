// ============================================================================
// 🏛️ BLOCO B DO DF — o B470 que o PVA cobra e o gerador nunca emitiu
//
// (11/09, Paulo, LEGACY · DF · 08/2026: *"deu apenas esses 2 erros, esse bloco
// B470 tem que preencher, segue um arquivo anterior e o atual, são para todas
// as empresas de BRASILIA que entrega SPED ICMS IPI"*.)
//
// O PVA: *"Registro filho obrigatório não foi informado — B470"*, sobre um
// arquivo com `|B001|1|`. O arquivo ACEITO do e-Fiscal (10/2025, mesma empresa):
// `|B001|0|` + `|B470|0|0|0|0|0|0|0|0|0|0|0|0|0|0|` — catorze zeros, porque a
// LEGACY não prestou serviço naquele mês. Zero ali É a resposta.
//
// E o SEGUNDO erro do mesmo PVA: `|0200|ITEM-1|Serviço|||SV|09|` sem C170 — o
// coletor do 0200 cadastrava o item da NFS-e, que este arquivo NÃO escritura.
//
// À TARDE, o arquivo regerado saiu com `Valor do ISS substituto a recolher
// R$ 6,17` e os outros treze zerados (print do PVA). Paulo: *"ele puxou esse
// ISS, ele pegou da nota de serviços tomados, tem que estar tudo zerado (SPED
// LEGACY)"*. O campo M (VL_ISS_ST) vinha da NFS-e TOMADA com ISS retido — e a
// nota tomada não prova ISS substituto devido ao DF. O campo sai ZERO; a
// tomada é contada e o valor vai DITO no aviso.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';
import {
    buildBlocoB, apurarIssBlocoB, avisosDoBlocoB, blocoBAplicaNaUf, baseIssDoDocumento, CAMPOS_B470,
} from '../sefaz-backend/sped-fiscal-blocoB.js';
import { documentosEscrituradosNoFiscal } from '../sefaz-backend/sped-selecao-documentos.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';
import { conferirContadoresDeBloco } from '../sefaz-backend/sped-auditoria-saida.js';

const sq = (l: string) => l.replace(/\r?\n$/, '');
const EMPRESA = '11222333000181'; // fictício — dado de cliente não entra no repo
const empresa = (uf: string) => ({ cnpj: EMPRESA, nome: 'EMPRESA TESTE', dadosFiscais: { uf, codMunIBGE: '5300108' } });

/** NFS-e como o ✍️ e o portal gravam: rótulo NFSe + prestador/tomador + valores achatados. */
const nfse = (over: Record<string, unknown> = {}) => ({
    id: `nfse-${Math.random()}`, tipo: 'NFSe', tipoDoc: 'NFSe', modelo: '99', numero: '10',
    direcao: 'saida', status: 'autorizado', empresaCnpj: EMPRESA,
    prestadorCnpj: EMPRESA, tomadorCnpj: '44555666000177',
    cnpjEmit: EMPRESA, cnpjDest: '44555666000177',
    valorTotal: 1000, valorServicos: 1000, valorIss: 50,
    ...over,
});

describe('a UF decide o bloco B', () => {
    it('DF aplica; qualquer outra UF (ou nenhuma) não', () => {
        expect(blocoBAplicaNaUf('DF')).toBe(true);
        expect(blocoBAplicaNaUf(' df ')).toBe(true);
        expect(blocoBAplicaNaUf('SP')).toBe(false);
        expect(blocoBAplicaNaUf('')).toBe(false);
        expect(blocoBAplicaNaUf(undefined)).toBe(false);
    });

    it('fora do DF o bloco sai VAZIO — só B001|1 e B990|2 (Guia 3.2.3, B001)', () => {
        const linhas = buildBlocoB({ empresa: empresa('SP'), notas: [nfse()] }).map(sq);
        expect(linhas).toEqual(['|B001|1|', '|B990|2|']);
    });
});

describe('no DF: B001|0 + B470, o filho que o PVA cobra', () => {
    it('sem nota de serviço no mês sai o B470 com os catorze zeros — o arquivo ACEITO da LEGACY (10/2025)', () => {
        const linhas = buildBlocoB({ empresa: empresa('DF'), notas: [] }).map(sq);
        expect(linhas[0]).toBe('|B001|0|');
        expect(linhas[1]).toBe(`|B470|${new Array(14).fill('0,00').join('|')}|`);
        expect(linhas[2]).toBe('|B990|3|');
        expect(CAMPOS_B470).toHaveLength(14);
        // Contagem do leiaute: REG + 14 = 15 campos (Guia 3.2.3, B470).
        expect(linhas[1].split('|').length - 2).toBe(15);
    });

    it('o contador do bloco fecha — a aritmética que o PVA confere primeiro', () => {
        const linhas = buildBlocoB({ empresa: empresa('DF'), notas: [] });
        expect(conferirContadoresDeBloco(linhas as never)).toEqual([]);
        const fora = buildBlocoB({ empresa: empresa('MG'), notas: [] });
        expect(conferirContadoresDeBloco(fora as never)).toEqual([]);
    });

    it('toda linha passa pelo buildLine — |REG|…|\\r\\n (a lição do bloco G, 29/08)', () => {
        for (const l of buildBlocoB({ empresa: empresa('DF'), notas: [nfse()] })) {
            expect(l).toMatch(/^\|[0-9A-Z]{4}\|.*\|\r\n$/);
        }
    });

    it('sem nota de serviço NÃO há aviso — alarme sobre arquivo correto desliga a trava', () => {
        expect(avisosDoBlocoB({ uf: 'DF', apuracao: apurarIssBlocoB({ notas: [] }) })).toEqual([]);
        expect(avisosDoBlocoB({ uf: 'SP', apuracao: apurarIssBlocoB({ notas: [nfse()] }) })).toEqual([]);
    });
});

describe('o B470 soma as prestações do declarante — e NUNCA a nota tomada', () => {
    it('prestação (saída): VL_CONT, VL_BC_ISS e VL_ISS; ISS retido pelo tomador vai em J e H', () => {
        const notas = [
            nfse({ valorTotal: 1000, valorIss: 50 }),
            nfse({ numero: '11', valorTotal: 2000, valorIss: 100, issRetido: true }),
        ];
        const a = apurarIssBlocoB({ notas });
        expect(a.prestadas).toBe(2);
        expect(a.valores.vlCont).toBe(3000);
        expect(a.valores.vlBcIss).toBe(3000);
        expect(a.valores.vlIss).toBe(150);
        // J = ISS retido pelo tomador (a paulistana retém integral: o ISS da nota)
        expect(a.valores.vlIssRt).toBe(100);
        expect(a.valores.vlBcIssRt).toBe(2000);
        // L = I − J − K
        expect(a.valores.vlIssRec).toBe(50);
        expect(a.valores.vlIssSt).toBe(0);
    });

    // FIXTURE TROCADA (11/09, à tarde): a versão de manhã exigia
    // `vlIssSt === 30` — ela DESCREVIA o defeito que o Paulo viu no PVA
    // (R$ 6,17 vindo de uma tomada). A intenção que fica: a tomada é CONTADA e
    // dita, e o campo M sai zero.
    it('tomada (entrada) com ISS retido NÃO entra no campo M — é contada e o valor vai dito (caso LEGACY, R$ 6,17)', () => {
        const tomada = (over: Record<string, unknown> = {}) => nfse({
            direcao: 'entrada', prestadorCnpj: '44555666000177', tomadorCnpj: EMPRESA,
            cnpjEmit: '44555666000177', cnpjDest: EMPRESA, ...over,
        });
        const notas = [
            tomada({ numero: '20', valorTotal: 123.4, valorServicos: 123.4, valorIss: 6.17, issRetido: true }),
            tomada({ numero: '21', valorIss: 30 }),                         // sem retenção: nem conta
            tomada({ numero: '22', valorIss: 12, valores: { issRetido: true } }),  // a forma aninhada
        ];
        const a = apurarIssBlocoB({ notas });
        expect(a.prestadas).toBe(0);
        expect(a.tomadasComRetencao).toBe(2);
        expect(a.issRetidoTomadasFora).toBe(18.17);
        expect(a.valores.vlIssSt).toBe(0);
        expect(a.valores.vlCont).toBe(0);
        // O arquivo da LEGACY: catorze zeros, mesmo com a tomada retida no mês.
        const linhas = buildBlocoB({ empresa: empresa('DF'), notas }).map(sq);
        expect(linhas[1]).toBe(`|B470|${new Array(14).fill('0,00').join('|')}|`);
    });

    it('o que ficou de fora sai DITO — e não vira o aviso das prestações', () => {
        const notas = [nfse({ direcao: 'entrada', prestadorCnpj: '44555666000177', tomadorCnpj: EMPRESA,
            cnpjEmit: '44555666000177', cnpjDest: EMPRESA, valorIss: 6.17, issRetido: true })];
        const avisos = avisosDoBlocoB({ uf: 'DF', apuracao: apurarIssBlocoB({ notas }) });
        expect(avisos).toHaveLength(1);
        expect(avisos[0]).toMatch(/1 NFS-e TOMADA/);
        expect(avisos[0]).toMatch(/R\$ 6,17/);
        expect(avisos[0]).toMatch(/sai ZERO/);
        expect(avisos[0]).not.toMatch(/prestada/);
        // Fora do DF o bloco é vazio e ninguém precisa ler aviso de tomada.
        expect(avisosDoBlocoB({ uf: 'SP', apuracao: apurarIssBlocoB({ notas }) })).toEqual([]);
    });

    it('trava na FONTE: nenhum ramo de entrada alimenta o campo M', () => {
        const fonte = fs.readFileSync(path.join(__dirname, '..', 'sefaz-backend', 'sped-fiscal-blocoB.js'), 'utf8');
        const codigo = fonte.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
        expect(codigo).not.toMatch(/vlIssSt\s*\+=/);
        expect(codigo).toMatch(/const vlIssSt = 0;/);
    });

    it('cancelada fica de fora; nota de MERCADORIA fica de fora', () => {
        const notas = [
            nfse({ status: 'cancelado' }),
            { id: 'nfe', tipo: 'NFe', modelo: '55', direcao: 'saida', valorTotal: 9999, cnpjEmit: EMPRESA,
                chave: '35260811222333000181550010000001001000000012', itens: [{ nItem: '1', cProd: 'A' }] },
        ];
        const a = apurarIssBlocoB({ notas });
        expect(a.prestadas).toBe(0);
        expect(a.valores.vlCont).toBe(0);
    });

    it('a base do ISS vem do documento quando ele a traz; senão é o valor do serviço', () => {
        expect(baseIssDoDocumento({ valores: { baseCalculo: 800 } })).toBe(800);
        expect(baseIssDoDocumento({ baseCalculo: 700 })).toBe(700);
        expect(Number.isNaN(baseIssDoDocumento({ valorTotal: 1000 }))).toBe(true);
        const a = apurarIssBlocoB({ notas: [nfse({ valorTotal: 1000, valores: { baseCalculo: 800 } })] });
        expect(a.valores.vlCont).toBe(1000);
        expect(a.valores.vlBcIss).toBe(800);
    });

    it('prestação sem valor legível fica FORA e sai NOMEADA — nunca entra como zero', () => {
        const a = apurarIssBlocoB({ notas: [nfse({ valorTotal: undefined, valorServicos: undefined, totais: undefined })] });
        expect(a.semValor).toBe(1);
        const avisos = avisosDoBlocoB({ uf: 'DF', apuracao: a });
        expect(avisos.some((x) => /sem valor legível/.test(x))).toBe(true);
    });

    it('com prestação no mês o aviso DIZ o que saiu zero e que o B020/B025 não é gerado', () => {
        const avisos = avisosDoBlocoB({ uf: 'DF', apuracao: apurarIssBlocoB({ notas: [nfse()] }) });
        expect(avisos).toHaveLength(1);
        expect(avisos[0]).toMatch(/1 NFS-e prestada/);
        expect(avisos[0]).toMatch(/B020\/B025/);
        expect(avisos[0]).toMatch(/subempreitada/);
    });

    it('o gerador formata o que foi apurado — e aceita o `dados.blocoB` do orquestrador', () => {
        const apuracao = apurarIssBlocoB({ notas: [nfse({ valorTotal: 1234.56, valorIss: 61.73 })] });
        const linhas = buildBlocoB({ empresa: empresa('DF'), blocoB: apuracao }).map(sq);
        expect(linhas[1]).toBe('|B470|1234,56|0,00|0,00|0,00|0,00|0,00|1234,56|0,00|61,73|0,00|0,00|61,73|0,00|0,00|');
    });
});

describe('0200: só item de documento que este arquivo ESCRITURA (o segundo erro do PVA)', () => {
    const nfeEntrada = {
        id: 'nfe-1', tipo: 'NFe', modelo: '55', direcao: 'entrada', tpNF: '1', status: 'autorizado',
        chave: '35260844555666000177550010000000011000000015',
        cnpjEmit: '44555666000177', cnpjDest: EMPRESA, itens: [{ nItem: '1', cProd: 'P1', xProd: 'PRODUTO' }],
    };
    const nfce = {
        id: 'nfce-1', tipo: 'NFCe', modelo: '65', direcao: 'saida', tpNF: '1', status: 'autorizado',
        chave: '35260811222333000181650010000000011000000019',
        cnpjEmit: EMPRESA, itens: [{ nItem: '1', cProd: 'C1' }],
    };
    const cte = { id: 'cte-1', tipo: 'CTe', modelo: '57', direcao: 'entrada', cnpjDest: EMPRESA, valorTotal: 100 };
    const resumo = { id: 'res-1', tipo: 'NFe', tipoDoc: 'resNFe', modelo: '55', direcao: 'entrada', cnpjEmit: '44555666000177', cnpjDest: EMPRESA };
    const servico = nfse({ id: 'nfse-1', itens: [{ nItem: '1', xProd: 'Serviço' }] });

    it('NF-e de entrada com itens e CT-e estão escriturados; NFS-e, NFC-e e resumo não', () => {
        const { escriturado } = documentosEscrituradosNoFiscal([nfeEntrada, nfce, cte, resumo, servico], EMPRESA);
        expect(escriturado(nfeEntrada)).toBe(true);
        expect(escriturado(cte)).toBe(true);
        expect(escriturado(servico)).toBe(false);
        expect(escriturado(nfce)).toBe(false);
        expect(escriturado(resumo)).toBe(false);
    });

    it('o orquestrador aplica a MESMA régua ao 0150 e ao 0200 — a trava do item era só do participante', () => {
        const fonte = fs.readFileSync(path.join(__dirname, '..', 'sefaz-backend', 'sped-fiscal-orchestrator.js'), 'utf8');
        expect(fonte).toMatch(/documentosEscrituradosNoFiscal\(notas, empresa\.cnpj\)/);
        // O laço dos ITENS pula a nota não escriturada ANTES de ler `nota.itens`.
        const laco = fonte.slice(fonte.indexOf('const itensMap = new Map()'), fonte.indexOf('const itens = Array.from(itensMap.values())'));
        expect(laco).toMatch(/if \(nfceOuNaoEscriturada\(nota\)\) continue;/);
        expect(laco.indexOf('nfceOuNaoEscriturada(nota)')).toBeLessThan(laco.indexOf('for (const item of (nota.itens'));
    });
});

describe('ligação: o orquestrador monta o bloco B pelo dono, com os dados', () => {
    it('importa de sped-fiscal-blocoB.js, passa `dados` e apura ANTES dos warnings', () => {
        const fonte = fs.readFileSync(path.join(__dirname, '..', 'sefaz-backend', 'sped-fiscal-orchestrator.js'), 'utf8');
        expect(fonte).toMatch(/import \{ buildBlocoB, apurarIssBlocoB, avisosDoBlocoB \} from '\.\/sped-fiscal-blocoB\.js'/);
        expect(fonte).toMatch(/buildBlocoB\(dados\)/);
        expect(fonte).not.toMatch(/buildBlocoB\(\)/);
        expect(fonte).toMatch(/warnings\.push\(\.\.\.avisosDoBlocoB\(/);
        expect(fonte).toMatch(/blocoB,/);
    });

    it('a versão VAZIA do bloco B foi deletada — código morto é a isca para reativar a régua velha', () => {
        const vazios = fs.readFileSync(path.join(__dirname, '..', 'sefaz-backend', 'sped-fiscal-blocos-vazios.js'), 'utf8');
        expect(vazios).not.toMatch(/export const buildBlocoB/);
    });
});

describe('prevalidação R41 — o DF exige o B470; fora do DF o bloco é vazio', () => {
    const L = (...c: (string | number)[]) => `|${c.join('|')}|`;
    const r0000 = (uf: string) => L('0000', '020', '0', '01082026', '31082026', 'EMPRESA TESTE', EMPRESA, '', uf, '0759137400149', '5300108', '', '', 'A', '1');
    const b470 = L('B470', ...new Array(14).fill('0,00'));

    it('acusa o arquivo que o PVA recusou: DF com B001|1', () => {
        const r = prevalidarSpedFiscal([r0000('DF'), L('B001', '1'), L('B990', '2')]);
        const e = r.erros.filter((x: any) => x.regra === 'bloco-b-df-sem-b470');
        expect(e).toHaveLength(1);
        expect(e[0].fonte).toMatch(/B470/);
    });

    it('acusa B001|0 sem o B470 no DF', () => {
        const r = prevalidarSpedFiscal([r0000('DF'), L('B001', '0'), L('B990', '2')]);
        expect(r.erros.filter((x: any) => x.regra === 'bloco-b-df-sem-b470')).toHaveLength(1);
    });

    it('nasce VERDE sobre o que o gerador produz hoje no DF', () => {
        const r = prevalidarSpedFiscal([r0000('DF'), L('B001', '0'), b470, L('B990', '3')]);
        expect(r.erros.filter((x: any) => /^bloco-b/.test(x.regra))).toEqual([]);
    });

    it('fora do DF, bloco com dados é recusa (Guia 3.2.3, B001)', () => {
        const r = prevalidarSpedFiscal([r0000('SP'), L('B001', '0'), b470, L('B990', '3')]);
        expect(r.erros.filter((x: any) => x.regra === 'bloco-b-fora-do-df')).toHaveLength(1);
        const ok = prevalidarSpedFiscal([r0000('SP'), L('B001', '1'), L('B990', '2')]);
        expect(ok.erros.filter((x: any) => /^bloco-b/.test(x.regra))).toEqual([]);
    });
});
