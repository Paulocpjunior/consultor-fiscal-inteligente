// ============================================================================
// 🚚 O CT-e COMO ITEM — "onde altero o CST do frete?" (Paulo, 21/09, EDUARDO
// GUERRA · tomadora de frete, *"nessa empresa não aproveitamos o crédito de
// ICMS sobre os fretes"*).
//
// MEDIDO ANTES DE ESCREVER: o Resumo por CFOP pulava documento sem `itens[]`
// (o CT-e não tem), o Livro e a ✏️ CFOP por nota filtravam `['NFe','NFCe']`,
// e o D190 lia o CST CRU do cabeçalho e a base/ICMS dos `totais` — sem olhar
// o CST informado nem a régua de crédito que o C170/C190 honram desde 09/09.
// Informar CST 90 num frete não tirava o crédito do arquivo; optante saía
// creditando frete.
//
// A correção NÃO é uma segunda régua: o cabeçalho vira o ITEM SINTÉTICO e
// passa pelos MESMOS donos do item de mercadoria (bloco C e a alocação do
// Livro/Resumo). Este teste prova a composição e amarra os leitores.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo .js do backend sem tipos próprios para o gerador
import { buildBlocoD } from '../sefaz-backend/sped-fiscal-blocoD.js';
import {
    itemSinteticoDoCte, itensParaEscriturar, cfopDoCte, cstDoCte, avisosDeCteSemCredito, CST_CTE_SEM_CABECALHO,
} from '../sefaz-backend/cte-escrituracao.js';
import { resumoPorCfop } from '../services/relatoriosAgregacoes';
import { ctesSemCstInformado, fraseDaConsequenciaDoLote } from '../services/cteCstEmLote';

const RAIZ = join(__dirname, '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

/** Chave real de CT-e (modelo 57 nas posições 21-22). */
const CHAVE_CTE = '35260731947349000169570010000000031705547508';
const CNPJ_EMPRESA = '31947349000169';

const dados = (notas: any[], over: any = {}) => ({
    empresa: { _regime: 'lucro', cnpj: CNPJ_EMPRESA, dadosFiscais: { uf: 'SP' } },
    competenciaInicio: '2026-08', competenciaFim: '2026-08', notas, warnings: [] as string[],
    ...over,
});

/** CT-e tomado, interestadual, COM ICMS destacado pelo transportador (12%). */
const cteComIcms = (over: any = {}) => ({
    id: 'cte1', chave: CHAVE_CTE, tipoDoc: 'CTe', tipo: 'CTe', direcao: 'entrada', status: 'autorizado',
    numero: '4321', dhEmi: '2026-08-10T10:00:00-03:00', competencia: '2026-08',
    valorTotal: 1500, cfop: '6353', cstIcms: '00', aliqIcms: 12,
    totais: { vBC: 1500, vICMS: 180 },
    cnpjEmit: '47252373000113', xNomeEmit: 'TRANSPORTADORA LTDA', ufEmit: 'MG',
    codMunIniCte: '3106200', codMunFimCte: '3550308',
    ...over,
});

const d190De = (linhas: string[]) => linhas.find((l) => l.startsWith('|D190|'))!.split('|');

describe('o item sintético do CT-e — o cabeçalho na FORMA do item', () => {
    it('leva CFOP, CST, valor, base, ICMS e alíquota do cabeçalho', () => {
        const it = itemSinteticoDoCte(cteComIcms());
        expect(it).toMatchObject({ sintetico: 'cte', cfop: '6353', cst: '00', vProd: 1500, vBC: 1500, vICMS: 180, aliqIcms: 12 });
        expect(cfopDoCte(cteComIcms())).toBe('6353');
        expect(cstDoCte(cteComIcms())).toBe('00');
    });

    it('sem `nItem` de propósito — a decisão do CT-e é por NOTA, nunca por item', () => {
        expect((itemSinteticoDoCte(cteComIcms()) as any).nItem).toBeUndefined();
    });

    it('AUSENTE ≠ ZERO: base/ICMS que o cabeçalho não traz ficam ausentes; zero DECLARADO entra', () => {
        const semIcms = itemSinteticoDoCte(cteComIcms({ totais: {}, aliqIcms: undefined }));
        expect('vBC' in semIcms).toBe(false);
        expect('vICMS' in semIcms).toBe(false);
        expect('aliqIcms' in semIcms).toBe(false);
        const zero = itemSinteticoDoCte(cteComIcms({ totais: { vBC: 0, vICMS: 0 }, aliqIcms: 0 }));
        expect(zero).toMatchObject({ vBC: 0, vICMS: 0, aliqIcms: 0 });
    });

    it('cabeçalho sem CST mantém o 90 que o D190 sempre usou — trocar isso é mudar valor de arquivo', () => {
        expect(itemSinteticoDoCte(cteComIcms({ cstIcms: undefined })).cst).toBe(CST_CTE_SEM_CABECALHO);
        expect(CST_CTE_SEM_CABECALHO).toBe('90');
    });

    it('itensParaEscriturar: CT-e vira [sintético]; NF-e devolve os itens dela; sem nada devolve []', () => {
        expect(itensParaEscriturar(cteComIcms())).toHaveLength(1);
        const nfe = { tipoDoc: 'NFe', chave: '3526073194734900016955001000000031705547508', itens: [{ cfop: '5102' }] };
        expect(itensParaEscriturar(nfe)).toBe(nfe.itens);
        expect(itensParaEscriturar({ tipoDoc: 'NFe' })).toEqual([]);
    });
});

describe('🚨 D190 — CST, base, alíquota e ICMS pela MESMA régua do C170/C190', () => {
    it('Lucro, sem nada informado: o destaque do transportador vale (CST 000 · 12% · 1500 · 180)', () => {
        const linhas = buildBlocoD(dados([cteComIcms()]));
        const c = d190De(linhas as never);
        const d100 = linhas.find((l: string) => l.startsWith('|D100|'))!.split('|');
        expect(d100[19]).toBe("1500,00");   // campo 19 = VL_BC_ICMS (o split deixa "" no 0 e REG no 1)
        expect(d100[20]).toBe("180,00");    // campo 20 = VL_ICMS
        expect(c[2]).toBe('000');
        expect(c[3]).toBe('2353');          // 6353 do transportador → 2353 na entrada
        expect(c[4]).toBe('12,00');
        expect(c[6]).toBe('1500,00');
        expect(c[7]).toBe('180,00');
    });

    it('🚨 CST INFORMADO 90 na nota: D190 sai 090 com base, alíquota e ICMS ZERO — e o arquivo DIZ o número', () => {
        const d = dados([cteComIcms({ cstEscriturado: '90', cstEscrituradoPor: 'sandra@sp.com.br' })]);
        const c = d190De(buildBlocoD(d) as never);
        expect(c[2]).toBe('090');
        expect(c[4]).toBe('0,00');
        expect(c[6]).toBe('0,00');
        expect(c[7]).toBe('0,00');
        expect(c[5]).toBe('1500,00');       // VL_OPR continua: o frete foi escriturado, só o crédito saiu
        // 🚨 E O D100 PAI LÊ O MESMO DONO: o PVA cruza VL_BC_ICMS/VL_ICMS do D100
        // com a Σ dos D190 (R33). Pai nos `totais` + filho zerado = arquivo que
        // se desmente por dentro — foi este teste que pegou, antes do PVA.
        const d100 = buildBlocoD(dados([cteComIcms({ cstEscriturado: '90' })])).find((l: string) => l.startsWith('|D100|'))!.split('|');
        expect(d100[19]).toBe("0,00");
        expect(d100[20]).toBe("0,00");
        const aviso = d.warnings.join(' ');
        expect(aviso).toMatch(/1 CT-e saíram SEM crédito de ICMS por CST INFORMADO/);
        expect(aviso).toMatch(/180,00/);
        expect(aviso).toMatch(/4321/);
        expect(aviso).toMatch(/✏️ CFOP por nota/);
    });

    it('CST informado 40 (isenta) também zera o crédito — e preserva a tributação digitada', () => {
        const c = d190De(buildBlocoD(dados([cteComIcms({ cstEscriturado: '40' })])) as never);
        expect(c[2]).toBe('040');
        expect(c[7]).toBe('0,00');
    });

    it('optante do SIMPLES: o frete não credita pelo REGIME (CST 090, ICMS zero) — aviso por causa própria', () => {
        const d = dados([cteComIcms()], { regimeEscrituracao: 'SIMPLES' });
        const c = d190De(buildBlocoD(d) as never);
        expect(c[2]).toBe('090');
        expect(c[7]).toBe('0,00');
        expect(d.warnings.join(' ')).toMatch(/optante do Simples Nacional/);
        expect(d.warnings.join(' ')).not.toMatch(/CST INFORMADO/);
    });

    it('📖 o gabarito da EDUARDO GUERRA (e-Fiscal, ACEITO): CST 090 · alíquota 0 · ICMS 0 — e NENHUM aviso', () => {
        // Zerar o que já era zero não é notícia: alarme sobre arquivo correto
        // é o jeito conhecido de a equipe ignorar o aviso que importa.
        const d = dados([cteComIcms({ cstIcms: '90', aliqIcms: 0, totais: { vBC: 0, vICMS: 0 } })]);
        const c = d190De(buildBlocoD(d) as never);
        expect(c[2]).toBe('090');
        expect(c[4]).toBe('0,00');
        expect(c[7]).toBe('0,00');
        expect(d.warnings.join(' ')).not.toMatch(/SEM crédito/);
    });

    it('e o mesmo CT-e com CST informado 90 e ICMS zero também não ganha aviso', () => {
        const d = dados([cteComIcms({ cstEscriturado: '90', totais: { vBC: 0, vICMS: 0 }, aliqIcms: 0 })]);
        buildBlocoD(d);
        expect(d.warnings.join(' ')).not.toMatch(/SEM crédito/);
    });
});

describe('os avisos por causa', () => {
    it('separa CST informado de regime, e ignora quem não tinha destaque', () => {
        const avisos = avisosDeCteSemCredito([
            { numero: '1', destacado: 10, por: 'informado' },
            { numero: '2', destacado: 0, por: 'informado' },
            { numero: '3', destacado: 5, por: 'regime' },
        ], 'SIMPLES');
        expect(avisos).toHaveLength(2);
        expect(avisos[0]).toMatch(/1 CT-e saíram SEM crédito de ICMS por CST INFORMADO/);
        expect(avisos[0]).toMatch(/10,00/);
        expect(avisos[1]).toMatch(/1 CT-e saíram SEM crédito de ICMS \(CST x90/);
        expect(avisos[1]).toMatch(/optante do Simples/);
    });
    it('sem destaque nenhum, nasce mudo', () => {
        expect(avisosDeCteSemCredito([{ numero: '1', destacado: 0, por: 'regime' }])).toEqual([]);
    });
});

describe('🚚 o Resumo por CFOP passou a ver o frete', () => {
    const CTX = { naturezaAtividade: 'comercio' };
    it('o CT-e vira linha própria, no CFOP de ENTRADA correlacionado, com o destaque do transportador', () => {
        const r = resumoPorCfop([cteComIcms()] as any, CTX);
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ cfop: '2353', direcao: 'entrada', notas: 1, ctes: 1, contabil: 1500, base: 1500, icms: 180 });
    });
    it('CST informado 90 no frete: base e ICMS zero, o contábil vai para Outras', () => {
        const r = resumoPorCfop([cteComIcms({ cstEscriturado: '90' })] as any, CTX);
        expect(r[0]).toMatchObject({ cfop: '2353', base: 0, icms: 0, outras: 1500, ctes: 1 });
    });
    it('optante do Simples: mesmo resultado, pelo regime', () => {
        const r = resumoPorCfop([cteComIcms()] as any, { ...CTX, regimeTributario: 'SIMPLES' });
        expect(r[0]).toMatchObject({ base: 0, icms: 0, outras: 1500 });
    });
    it('a NF-e não ganha `ctes`', () => {
        const nfe = {
            id: 'n', chave: 'k', tipoDoc: 'NFe', status: 'autorizado', direcao: 'entrada',
            dhEmi: '2026-08-10T10:00:00-03:00', valorTotal: 100, totais: { vNF: 100 },
            itens: [{ cfop: '5102', vProd: 100, cst: '00', vBC: 100, vICMS: 18 }],
        };
        expect(resumoPorCfop([nfe] as any, CTX)[0].ctes).toBe(0);
    });
});

describe('🚚 o lote de CST nos CT-e', () => {
    const linha = (over: any = {}) => ({ id: 'a', numero: '1', direcao: 'entrada' as const, ehCte: true, cstInformado: '', icmsDestacado: 180, ...over });
    it('só CT-e de ENTRADA sem CST informado são alvo — o informado à mão não é tocado', () => {
        const alvos = ctesSemCstInformado([
            linha(),
            linha({ id: 'b', cstInformado: '00' }),
            linha({ id: 'c', direcao: 'saida' }),
            linha({ id: 'd', ehCte: false }),
        ]);
        expect(alvos.map(a => a.id)).toEqual(['a']);
    });
    it('a consequência diz quantos, quanto de ICMS sai do crédito e que é reversível', () => {
        const f = fraseDaConsequenciaDoLote([linha(), linha({ id: 'b', icmsDestacado: 20 })], '90');
        expect(f).toMatch(/2 CT-e de entrada/);
        expect(f).toMatch(/200,00/);
        expect(f).toMatch(/base e ICMS ZERO/);
        expect(f).toMatch(/limpar o campo devolve/);
    });
});

describe('🚦 a trava dos LEITORES — campo que só uma tela honra é pior que não ter', () => {
    it('o D190 lê CST e ICMS pelos donos do bloco C através do item sintético — nunca o CST cru com default próprio', () => {
        const d = ler('sefaz-backend/sped-fiscal-blocoD.js');
        expect(d).toMatch(/import \{ icmsDoItemNoArquivo, cstDoItemNoArquivo, creditoIcmsDoItem \} from '\.\/sped-fiscal-blocoC\.js'/);
        expect(d).toMatch(/const item = itemSinteticoDoCte\(nota\)/);
        expect(d).toMatch(/cstDoItemNoArquivo\(item, cfop, notaComDados\)/);
        expect(d).toMatch(/icmsDoItemNoArquivo\(item, notaComDados\)/);
        // A forma antiga — CST cru com '090' cravado e base/ICMS dos totais — não volta.
        expect(d).not.toMatch(/cstDoCte\(nota\) \|\| '090'/);
        expect(d).not.toMatch(/fmt\.formatValue\(t\.vBC \|\| 0, 2\)/);
    });

    it('Livro, Resumo por CFOP e ✏️ CFOP por nota deixaram de filtrar só NFe/NFCe', () => {
        const f = ler('components/Relatorios/index.tsx');
        // As três abas: cada filtro `['NFe', 'NFCe']` que sobrou vem acompanhado do CT-e.
        const filtros = f.match(/\['NFe', 'NFCe'\]\.includes\(\(d as any\)\.tipoDoc \|\| d\.tipo\)/g) || [];
        expect(filtros.length).toBeGreaterThanOrEqual(3);
        expect((f.match(/\['NFe', 'NFCe'\]\.includes\(\(d as any\)\.tipoDoc \|\| d\.tipo\) \|\| ehConhecimentoDeTransporte\(d\)/g) || []).length)
            .toBe(filtros.length);
        // O Livro aloca pelo item sintético (a MESMA alocação da NF-e).
        expect(f).toMatch(/const itensDoDoc: any\[\] = itensParaEscriturar\(d\)/);
        expect(f).toMatch(/alocarTributacaoIcms\(itensDoDoc, contabil,/);
        // O lote de CST usa a gravação ÚNICA, nunca um updateDoc próprio.
        expect(f).toMatch(/gravarCstEscriturado\(\{ documentoId: l\.id, cst, porEmail/);
    });

    it('o Resumo por CFOP passa o CT-e pelo item sintético, e a chamada da correlação continua a mesma', () => {
        const f = ler('services/relatoriosAgregacoes.ts');
        expect(f).toMatch(/const itensDoDoc = itensParaEscriturar\(d\)/);
        expect(f).not.toMatch(/if \(!docValido\(d\) \|\| !\(d\.itens \|\| \[\]\)\.length\) continue;/);
    });

    it('o detalhe do documento oferece o ✏️ ao CT-e', () => {
        const f = ler('components/xml/XmlDocumentoDetalhe.tsx');
        expect(f).toMatch(/const ehCte = ehConhecimentoDeTransporte\(d as any\)/);
        expect(f).toMatch(/podeInformarEscrituracao && \(/);
    });
});
