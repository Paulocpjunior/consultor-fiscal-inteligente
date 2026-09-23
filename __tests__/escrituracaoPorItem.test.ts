// ============================================================================
// ✂️ CFOP E CST POR ITEM — a nota MISTA (Sandra, 11/09)
//
// *"essa nota tem 2 produtos, com o CFOP 5929, é uma nota de consumo pra
// Distribuidora, então lançamos como 1407 ou 1556 até aí ok, eu preciso lançar
// 2 CFOPS nessa nota, porque um produto é com ST outro sem ou seja 1407 e 1556,
// como eu ajusto, aqui nesse informar CFOP e CST só consigo colocar um CFOP e
// um CST só"*.
//
// E do lado do arquivo (Paulo, mesmo dia): *"CFOPs de uso e consumo que estão
// puxando com ICMS … são as notas que eu preciso ajustar no consultor ainda das
// notas com 2 cfop"* — o CST 90 informado por nota não alcançava SÓ o item de
// uso/consumo, então ou o item com ST perdia o 60, ou o de consumo seguia
// creditando.
//
// ═══ AS TRAVAS ══════════════════════════════════════════════════════════════
//   1. A precedência mora no DONO: ITEM > NOTA > cérebro > empresa > régua.
//   2. O item sem `nItem` NÃO recebe decisão (casar por posição pula de produto).
//   3. TODOS os leitores passam o ITEM (registro `consumidoresMedidos`) — aqui
//      se prova pelo ARQUIVO: C170/C190 das duas famílias e o Livro.
//   4. A gravação é por CAMINHO (`escrituracaoItens.<n>`), nunca o mapa inteiro.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    chaveDoItem, escrituracaoDoItem, cfopInformadoDoItem, resumoEscrituracaoItens,
} from '../sefaz-backend/escrituracao-item.js';
import { cfopDoLancamento, origemDoCfopLancamento } from '../sefaz-backend/cfop-correlacao.js';
import { cstInformadoDoItem, cstDoLancamento } from '../sefaz-backend/cst-correlacao.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { buildBlocoC } from '../sefaz-backend/sped-fiscal-blocoC.js';
import { buildBlocoC_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';
import { alocarTributacaoIcms, ctxAlocacaoDoDoc } from '../services/iobSageExportService';
import { resumoPorCfop } from '../services/relatoriosAgregacoes';

const RAIZ = join(__dirname, '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');
const ctx = { naturezaAtividade: 'comercio' };

// ─── A NOTA DA SANDRA (CNPJs fictícios — dado de cliente não entra no repo) ──
const EMPRESA = '11111111000191';
const FORN = '22222222000191';
const CHAVE = '35260822222222000191550010000005929000000019';
const notaMista = (over: Record<string, unknown> = {}) => ({
    id: 'mista', chave: CHAVE, numero: '5929', serie: '1', modelo: '55', tipo: 'NFe', tipoDoc: 'NFe',
    direcao: 'entrada', tpNF: '1', status: 'autorizado', dhEmi: '2026-08-10T10:00:00-03:00', competencia: '2026-08',
    empresaId: 'e', empresaCnpj: EMPRESA,
    emitente: { cnpjCpf: FORN, nome: 'FORNECEDOR', uf: 'SP', codMunIBGE: '3550308' },
    destinatario: { cnpjCpf: EMPRESA, nome: 'DISTRIBUIDORA' },
    itens: [
        // Item COM ST: o fornecedor já recolheu — CST 60, e entra como 1407.
        { nItem: '1', cProd: 'ST1', xProd: 'PRODUTO COM ST', cfop: '5929', cst: '060', cstIcms: '060', vProd: 100, qCom: 1, uCom: 'UN', vBC: 0, vICMS: 0, vICMSST: 12 },
        // Item SEM ST, de uso/consumo: CST 00 do fornecedor, entra como 1556 · 90.
        { nItem: '2', cProd: 'UC1', xProd: 'PRODUTO DE CONSUMO', cfop: '5929', cst: '000', cstIcms: '000', vProd: 200, qCom: 1, uCom: 'UN', vBC: 200, vICMS: 36, aliqIcms: 18 },
    ],
    totais: { vNF: 300, vProd: 300, vBC: 200, vICMS: 36 },
    ...over,
});
const decisaoDaSandra = {
    '1': { cfop: '1407', cst: '60', por: 'sandra@sp.com.br', em: '2026-09-11T10:00:00Z' },
    '2': { cfop: '1556', cst: '90', por: 'sandra@sp.com.br', em: '2026-09-11T10:00:00Z' },
};

describe('o dono: onde a decisão por item mora', () => {
    it('a chave é o nItem sem zeros à esquerda — e item sem nItem não tem chave', () => {
        expect(chaveDoItem({ nItem: '002' })).toBe('2');
        expect(chaveDoItem({ nItem: 7 })).toBe('7');
        expect(chaveDoItem({})).toBe('');
        expect(chaveDoItem({ nItem: 'x' })).toBe('');
    });

    it('lê o que foi informado para ESTE item e nada para os outros', () => {
        const doc = { escrituracaoItens: decisaoDaSandra };
        expect(escrituracaoDoItem(doc, { nItem: '1' })).toMatchObject({ cfop: '1407', cst: '60', por: 'sandra@sp.com.br' });
        expect(escrituracaoDoItem(doc, { nItem: '3' })).toBeNull();
        expect(cfopInformadoDoItem(doc, { nItem: '2' })).toBe('1556');
        expect(cfopInformadoDoItem({}, { nItem: '2' })).toBe('');
    });

    it('entrada torta no mapa não vira decisão (CFOP com 3 dígitos, objeto vazio)', () => {
        expect(escrituracaoDoItem({ escrituracaoItens: { '1': { cfop: '140' } } }, { nItem: '1' })).toBeNull();
        expect(escrituracaoDoItem({ escrituracaoItens: { '1': {} } }, { nItem: '1' })).toBeNull();
    });

    it('o resumo NOMEIA os itens — número sem alvo é meio farol', () => {
        expect(resumoEscrituracaoItens({ escrituracaoItens: decisaoDaSandra })).toEqual({ total: 2, nItens: ['1', '2'] });
        expect(resumoEscrituracaoItens({})).toEqual({ total: 0, nItens: [] });
    });
});

describe('🚨 a precedência: ITEM > NOTA > cérebro > empresa > régua', () => {
    it('o item informado vence o CFOP da nota; o item não informado segue a nota', () => {
        const doc = { cfopEscriturado: '1102', escrituracaoItens: { '2': { cfop: '1556' } } };
        expect(cfopDoLancamento(doc, '5929', 'entrada', ctx, { nItem: '1' })).toBe('1102');
        expect(cfopDoLancamento(doc, '5929', 'entrada', ctx, { nItem: '2' })).toBe('1556');
    });

    it('o caso da Sandra: dois CFOPs na MESMA nota', () => {
        const doc = notaMista({ escrituracaoItens: decisaoDaSandra });
        expect(cfopDoLancamento(doc, '5929', 'entrada', ctx, doc.itens[0])).toBe('1407');
        expect(cfopDoLancamento(doc, '5929', 'entrada', ctx, doc.itens[1])).toBe('1556');
        // E a ORIGEM diz que foi o item, e quem foi.
        const o = origemDoCfopLancamento(doc, '5929', 'entrada', ctx, doc.itens[0]);
        expect(o.origem).toBe('item');
        expect(o.rotulo).toMatch(/item \(nº 1\)/);
        expect(o.por).toBe('sandra@sp.com.br');
    });

    it('sem item (CT-e, null DITO) e sem decisão por item, nada muda', () => {
        expect(cfopDoLancamento({ cfopEscriturado: '1102' }, '5929', 'entrada', ctx, null)).toBe('1102');
        expect(cfopDoLancamento({}, '5102', 'entrada', ctx, null)).toBe('1102');
    });

    it('item SEM nItem não recebe a decisão — casar por posição pularia de produto', () => {
        const doc = { escrituracaoItens: { '1': { cfop: '1407' } } };
        expect(cfopDoLancamento(doc, '5929', 'entrada', ctx, { cfop: '5929' })).toBe('1929');
    });

    it('o CST informado por item vence o da nota — e a origem do item é preservada', () => {
        const doc = notaMista({ cstEscriturado: '90', escrituracaoItens: { '1': { cst: '60' } } });
        expect(cstInformadoDoItem(doc, doc.itens[0])).toBe('60');
        expect(cstInformadoDoItem(doc, doc.itens[1])).toBe('90');
        expect(cstInformadoDoItem({}, doc.itens[1])).toBe('');
        expect(cstDoLancamento('100', '1407', cstInformadoDoItem(doc, doc.itens[0])).cst).toBe('160');
    });
});

describe('🚨 O ARQUIVO honra o item — C170 e C190 das duas famílias', () => {
    const dados = (nota: any) => ({
        empresa: { cnpj: EMPRESA, nome: 'DISTRIBUIDORA', _regime: 'lucro', dadosFiscais: { uf: 'SP', codMunIBGE: '3550308', regimeTributario: 'LUCRO_PRESUMIDO' } },
        notas: [nota], competencia: '2026-08', competenciaInicio: '2026-08', competenciaFim: '2026-08',
        periodoInicio: '2026-08-01', periodoFim: '2026-08-31', regimeApuracao: '2', warnings: [] as string[],
    });
    const cfopsDoC170 = (linhas: string[]) => linhas.filter(l => l.startsWith('|C170|')).map(l => l.split('|')[11]);
    const cstsDoC170 = (linhas: string[]) => linhas.filter(l => l.startsWith('|C170|')).map(l => l.split('|')[10]);
    const c190 = (linhas: string[]) => linhas.filter(l => l.startsWith('|C190|')).map(l => `${l.split('|')[2]}|${l.split('|')[3]}`);

    it('EFD ICMS/IPI: o item com ST sai 1407·060 e o de consumo 1556·090 — na MESMA nota', () => {
        const r: any = buildBlocoC(dados(notaMista({ escrituracaoItens: decisaoDaSandra })));
        const linhas: string[] = r.linhas || r;
        expect(cfopsDoC170(linhas)).toEqual(['1407', '1556']);
        expect(cstsDoC170(linhas)).toEqual(['060', '090']);
        // E o C190 — que é o que a apuração soma — tem os DOIS grupos.
        expect(c190(linhas)).toEqual(expect.arrayContaining(['060|1407', '090|1556']));
    });

    it('🔁 PROVA POR REVERSÃO: só com o campo por NOTA, os dois itens saem iguais', () => {
        const r: any = buildBlocoC(dados(notaMista({ cfopEscriturado: '1556', cstEscriturado: '90' })));
        const linhas: string[] = r.linhas || r;
        expect(cfopsDoC170(linhas)).toEqual(['1556', '1556']);
        // O item com ST perde o 60 — é exatamente o que a Sandra não podia aceitar.
        expect(cstsDoC170(linhas)).toEqual(['090', '090']);
    });

    it('EFD-Contribuições: o C170 usa a MESMA decisão por item', () => {
        const r: any = buildBlocoC_Contrib(dados(notaMista({ escrituracaoItens: decisaoDaSandra })));
        const linhas: string[] = r.linhas || r;
        expect(cfopsDoC170(linhas)).toEqual(['1407', '1556']);
        expect(cstsDoC170(linhas)).toEqual(['060', '090']);
    });

    it('o Resumo por CFOP abre a nota em DUAS linhas, uma por CFOP', () => {
        const linhas = resumoPorCfop([notaMista({ escrituracaoItens: decisaoDaSandra }) as any], ctx as any);
        expect(linhas.map(l => l.cfop).sort()).toEqual(['1407', '1556']);
    });
});

describe('🚨 a COLUNA do livro segue o CST do item — o "uso e consumo puxando com ICMS"', () => {
    it('o item 90 vai para Outras (sem crédito) e o item 60 também; nada em Base/ICMS', () => {
        const doc = notaMista({ escrituracaoItens: decisaoDaSandra });
        const c = ctxAlocacaoDoDoc(doc, { regimeTributario: 'LUCRO_PRESUMIDO' });
        expect(c.cstEscrituradoItens).toEqual({ '1': '60', '2': '90' });
        const a = alocarTributacaoIcms(doc.itens as any, 300, c);
        expect(a.base).toBe(0);
        expect(a.icms).toBe(0);
        expect(a.outras).toBe(300);
    });

    it('sem a decisão por item, o item de consumo CREDITA — era o defeito', () => {
        const doc = notaMista();
        const a = alocarTributacaoIcms(doc.itens as any, 300, ctxAlocacaoDoDoc(doc, { regimeTributario: 'LUCRO_PRESUMIDO' }));
        expect(a.icms).toBe(36);
    });

    it('o item informado vence o CST da NOTA só nele — os outros seguem a nota', () => {
        const doc = notaMista({ cstEscriturado: '90', escrituracaoItens: { '2': { cst: '00' } } });
        const a = alocarTributacaoIcms(doc.itens as any, 300, ctxAlocacaoDoDoc(doc, { regimeTributario: 'LUCRO_PRESUMIDO' }));
        // Item 1 (nota diz 90) → Outras; item 2 (item diz 00) → tributado.
        expect(a.icms).toBe(36);
        expect(a.outras).toBe(100);
    });
});

describe('🔌 a gravação e as telas', () => {
    it('o service grava POR CAMINHO e limpa por caminho — nunca o mapa inteiro', () => {
        const f = ler('services/cfopEscrituradoService.ts');
        expect(f).toMatch(/const caminho = `escrituracaoItens\.\$\{chave\}`/);
        expect(f).toMatch(/\[caminho\]: deleteField\(\)/);
        expect(f).not.toMatch(/escrituracaoItens: \{/);
        // E valida com as MESMAS réguas da nota (faixa × direção, Tabela B).
        expect(f).toMatch(/validarCfopEscriturado\(i\.cfop, i\.direcao\)/);
        expect(f).toMatch(/validarCstEscriturado\(i\.cst\)/);
    });

    it('o detalhe da nota oferece o ✂️ por item, e a régua da tela é o mesmo dono', () => {
        const f = ler('components/xml/XmlDocumentoDetalhe.tsx');
        expect(f).toMatch(/gravarEscrituracaoItem\(/);
        expect(f).toMatch(/Informar por item/);
        expect(f).toMatch(/cfopDoLancamento\(d as any, cru, direcaoDoDoc, \{\}, it\)/);
        expect(f).toMatch(/resumoEscrituracaoItens\(d as any\)/);
    });

    it('o ✏️ CFOP por nota mostra o selo ✂️ e diz onde se edita por item', () => {
        const f = ler('components/Relatorios/index.tsx');
        expect(f).toMatch(/porItem: resumoEscrituracaoItens\(d\)/);
        expect(f).toMatch(/✂️ \{l\.porItem\.total\} item\(ns\)/);
        expect(f).toMatch(/cstInformadoDoItem\(/);
    });
});
