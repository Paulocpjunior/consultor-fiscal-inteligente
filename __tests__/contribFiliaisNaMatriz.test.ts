/**
 * 🏢 EFD-CONTRIBUIÇÕES DA MATRIZ COM AS FILIAIS (15/10).
 *
 * Paulo, 0181 · SBE EDIÇÕES: a EFD-Contribuições é entregue pela matriz e
 * precisa das filiais. Arquivo real dele (07/2026): três 0140 — matriz
 * 04496421000106 (DF), filiais 04496421000378 (DF) e 04496421000459 (SP) —, cada
 * um com os 0150/0200 dele e COD_EST = o próprio CNPJ; dois C010, cada um com
 * as notas do seu CNPJ (9524… sob a matriz, 13287… sob a 0003-78).
 *
 * Fatos cobrados: o vínculo só aceita filial da mesma raiz, cadastrada, com
 * UF e município; o documento vai para o estabelecimento do CNPJ que carrega;
 * o bloco 0 sai com um 0140 por estabelecimento e os participantes DELE; o
 * bloco C sai com um C010 por estabelecimento sob um C001/C990 só; e sem
 * filial o arquivo sai como sempre (0140 com COD_EST '1').
 */
import {
    conferirFiliaisContrib, repartirPorEstabelecimento, identidadeDoEstabelecimento,
    blocoPorEstabelecimento, visoesPorEstabelecimento,
} from '../sefaz-backend/sped-contrib-estabelecimentos.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBloco0Contrib } from '../sefaz-backend/sped-contrib-bloco0.js';
import { buildBlocoC_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildLine } from '../sefaz-backend/sped-fiscal-format.js';

const MATRIZ = '04496421000106';
const F0003 = '04496421000378';
const F0004 = '04496421000459';

const matriz = {
    id: 'm', cnpj: '04.496.421/0001-06', nome: 'SBE EDICOES E PRODUCOES LTDA ME',
    dadosFiscais: { uf: 'DF', codMunIBGE: '5300108', inscricaoEstadual: '0742343400146' },
};
const filial3 = {
    id: 'f3', cnpj: F0003, nome: 'SBE EDICOES E PRODUCOES LTDA - ME',
    dadosFiscais: { uf: 'DF', codMunIBGE: '5300108', inscricaoEstadual: '0742343400227' },
};
const filial4 = {
    id: 'f4', cnpj: F0004, nome: 'SBE EDICOES E PRODUCOES LTDA - ME',
    dadosFiscais: { uf: 'SP', codMunIBGE: '3550308', inscricaoEstadual: '144382424112', ccmSp: '52025039' },
};

const venda = (numero: string, emit: string, destDoc: string, destNome: string, v: number) => ({
    tipo: 'NFe', direcao: 'saida', tpNF: '1', modelo: '55', numero, serie: '1', modFrete: '9',
    chave: `5326070449642${emit.slice(-1)}000000550010000${numero.padStart(5, '0')}1000000000`.slice(0, 44),
    dataEmissao: '2026-07-20', empresaCnpj: emit, cnpjEmit: emit,
    emitente: { cnpjCpf: emit, nome: 'SBE' },
    destinatario: { cnpjCpf: destDoc, nome: destNome, uf: 'DF' },
    totais: { vNF: v, vProd: v },
    itens: [{ nItem: 1, codigo: `L${numero}`, descricao: 'EBOOK', cfop: '5102', ncm: '49019900', unidade: 'UN',
        quantidade: 1, vUnCom: v, vProd: v, vDesc: 0, cstPis: '06', cstCofins: '06', vPIS: 0, vCOFINS: 0, vICMS: 0 }],
});

describe('o vínculo confere antes de gravar', () => {
    const cadastradas = [matriz, filial3, filial4, { cnpj: '04496421000530', nome: 'SEM CADASTRO FISCAL', dadosFiscais: {} }];

    it('as duas filiais do arquivo real passam', () => {
        expect(conferirFiliaisContrib({ matrizCnpj: MATRIZ, filiais: [F0003, '04.496.421/0004-59'], cadastradas }))
            .toEqual({ ok: true, filiais: [F0003, F0004] });
    });

    it.each([
        ['outra raiz', ['12345678000190'], /outra raiz/],
        ['a própria matriz', [MATRIZ], /própria matriz/],
        ['não cadastrada', ['04496421000610'], /não está cadastrada/],
        ['sem UF/município', ['04496421000530'], /sem UF ou município/],
        ['repetida', [F0003, F0003], /duas vezes/],
    ])('%s: recusa e diz', (_n, filiais, erro) => {
        const r = conferirFiliaisContrib({ matrizCnpj: MATRIZ, filiais, cadastradas });
        expect(r.ok).toBe(false);
        expect(!r.ok && r.erros.join(' ')).toMatch(erro as RegExp);
    });
});

describe('cada documento vai para o estabelecimento do CNPJ que carrega', () => {
    it('nota da filial guardada sob a matriz vai para a filial; a da matriz fica', () => {
        const nMatriz = venda('9524', MATRIZ, '50248075000164', 'EDUARDO', 90000);
        const nFilialSobMatriz: any = venda('13287', F0003, '32619687888', 'ELIETE', 72.72);
        const m = repartirPorEstabelecimento([
            { doc: nMatriz, cnpjDaCarga: MATRIZ },
            { doc: nFilialSobMatriz, cnpjDaCarga: MATRIZ },
        ], [MATRIZ, F0003, F0004]);
        expect(m.get(MATRIZ)!.map((n) => n.numero)).toEqual(['9524']);
        expect(m.get(F0003)!.map((n) => n.numero)).toEqual(['13287']);
        expect(m.get(F0004)).toEqual([]);
        expect(nFilialSobMatriz._cnpjEstab).toBe(F0003);
    });
});

describe('o arquivo da matriz com as filiais (SBE 07/2026)', () => {
    const nMatriz = venda('9524', MATRIZ, '50248075000164', 'EDUARDO DOS SANTOS XAVIER', 90000);
    const nFilial = venda('13287', F0003, '32619687888', 'ELIETE NOVAIS MEIRA', 72.72);
    const part = (doc: string, nome: string) => ({ codPart: doc, nome, cnpj: doc.length === 14 ? doc : '', cpf: doc.length === 11 ? doc : '', codMunIBGE: '5300108' });
    const item = (cod: string) => ({ codItem: cod, descricao: 'EBOOK', unidade: 'UN', tipo: '00', ncm: '49019900' });
    const dados: any = {
        empresa: matriz, competencia: '2026-07', competenciaInicio: '2026-07', competenciaFim: '2026-07',
        regimeApuracao: '2', notas: [nMatriz, nFilial], warnings: [],
        participantes: [part('50248075000164', 'EDUARDO DOS SANTOS XAVIER')], unidades: [{ codigo: 'UN', descricao: 'UNIDADE' }],
        itens: [item('L9524')],
        estabelecimentos: [
            { empresa: matriz, notas: [nMatriz], participantes: [part('50248075000164', 'EDUARDO DOS SANTOS XAVIER')], unidades: [{ codigo: 'UN', descricao: 'UNIDADE' }], itens: [item('L9524')] },
            { empresa: identidadeDoEstabelecimento(matriz, filial3), notas: [nFilial], participantes: [part('32619687888', 'ELIETE NOVAIS MEIRA')], unidades: [{ codigo: 'UN', descricao: 'UNIDADE' }], itens: [item('L13287')] },
            { empresa: identidadeDoEstabelecimento(matriz, filial4), notas: [], participantes: [], unidades: [], itens: [] },
        ],
    };

    it('bloco 0: um 0140 por estabelecimento, COD_EST = CNPJ, cada um com os 0150/0200 DELE', () => {
        const l0: string[] = buildBloco0Contrib(dados);
        const regs = l0.map((l) => l.split('|')[1]);
        const ini = regs.indexOf('0140');
        const arvore = l0.slice(ini, regs.indexOf('0990')).map((l) => l.split('|').slice(1, 4).join('|'));
        expect(arvore.filter((r) => r.startsWith('0140'))).toEqual([
            `0140|${MATRIZ}|SBE EDICOES E PRODUCOES LTDA ME`,
            `0140|${F0003}|SBE EDICOES E PRODUCOES LTDA - ME`,
            `0140|${F0004}|SBE EDICOES E PRODUCOES LTDA - ME`,
        ]);
        // A ELIETE (cliente da filial) mora DEBAIXO do 0140 da 0003-78, não da matriz.
        const iFilial = arvore.findIndex((r) => r.includes(F0003));
        const iEliete = arvore.findIndex((r) => r.startsWith('0150|32619687888'));
        const iMatrizPart = arvore.findIndex((r) => r.startsWith('0150|50248075000164'));
        expect(iMatrizPart).toBeLessThan(iFilial);
        expect(iEliete).toBeGreaterThan(iFilial);
        // O 0140 da filial de SP sai com a UF, IE e IM DELA.
        const l0140SP = l0.find((l) => l.startsWith(`|0140|${F0004}|`))!.split('|');
        expect([l0140SP[5], l0140SP[6], l0140SP[7], l0140SP[8]]).toEqual(['SP', '144382424112', '3550308', '52025039']);
    });

    it('bloco C: um C010 por estabelecimento com as notas dele, sob um C001/C990 só', () => {
        const lc = blocoPorEstabelecimento('C', visoesPorEstabelecimento(dados), buildBlocoC_Contrib, buildLine);
        const regs = lc.map((l) => l.split('|').slice(1, 3).join('|'));
        expect(regs[0]).toBe('C001|0');
        expect(regs.filter((r) => r.startsWith('C001') || r.startsWith('C990'))).toHaveLength(2);
        const c010 = regs.filter((r) => r.startsWith('C010'));
        expect(c010).toEqual([`C010|${MATRIZ}`, `C010|${F0003}`]);
        // Cada C100 debaixo do C010 do CNPJ dele.
        const iC010Filial = regs.indexOf(`C010|${F0003}`);
        const numeros = lc.map((l, i) => ({ i, c: l.split('|') })).filter((x) => x.c[1] === 'C100').map((x) => ({ i: x.i, num: x.c[8] }));
        expect(numeros.find((n) => n.num === '9524')!.i).toBeLessThan(iC010Filial);
        expect(numeros.find((n) => n.num === '13287')!.i).toBeGreaterThan(iC010Filial);
        // O C990 conta o bloco inteiro.
        expect(lc[lc.length - 1]).toBe(`|C990|${lc.length}|\r\n`);
    });

    it('sem filial vinculada, o arquivo sai como sempre: um 0140 com COD_EST 1', () => {
        const { estabelecimentos: _e, ...semFilial } = dados;
        const l0: string[] = buildBloco0Contrib(semFilial);
        const l0140 = l0.filter((l) => l.startsWith('|0140|'));
        expect(l0140).toHaveLength(1);
        expect(l0140[0].split('|')[2]).toBe('1');
        expect(visoesPorEstabelecimento(semFilial)).toEqual([semFilial]);
    });
});
