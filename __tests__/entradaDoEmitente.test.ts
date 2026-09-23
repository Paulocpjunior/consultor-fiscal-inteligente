/**
 * 🚨 A ENTRADA DECLARADA NO DOCUMENTO PODE SER DO **EMITENTE**, NÃO NOSSA.
 *
 * Caso real (09/09, Paulo, MV LIDER · comércio do SIMPLES · 08/2026):
 * *"como não escriturar essas notas que são de devolução do próprio
 * fornecedor? que não entra na escrituração?"* — com os dois XMLs, que
 * respondem sozinhos. Os números aqui são os das notas reais; os CNPJs são
 * FICTÍCIOS, porque dado de cliente não entra no repositório.
 *
 *   · **FERA ATAC → MV LIDER** — `tpNF 0` · `finNFe 4` · CFOP **1411** ·
 *     *"Dev vda merc terc suj reg ST"* · `refNFe` de uma nota da PRÓPRIA FERA.
 *   · **LPS COMPANY (SC) → MV LIDER** — `tpNF 0` · `finNFe 4` · CFOP **2202** ·
 *     *"DEVOL. VENDAS"* · **vBC 199,59 · vICMS 7,98**, que é o número que
 *     subia no Livro de Entradas dela.
 *
 * Nas duas o emitente é o FORNECEDOR: é ele dando entrada no estoque DELE da
 * mercadoria devolvida. `tpNF=0` significa entrada para QUEM EMITIU — se a
 * mercadoria entra nele, ela sai de quem está no `<dest>`.
 *
 * O que este arquivo trava: a régua responde certo, ela é SEGURA na direção do
 * erro barato (na dúvida a nota FICA no livro), e os quatro escrituradores —
 * Livro, SPED (as duas famílias), demais relatórios e `.FML` — leem o MESMO
 * dono, com o que sai NOMEADO em cada um.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    ehEntradaDoEmitente, ehNotaPropriaDeEntrada, direcaoEfetivaDoc,
} from '../sefaz-backend/xml-metadata-helper.js';
import {
    selecionarNotasBlocoC, avisosDaSelecao,
} from '../sefaz-backend/sped-selecao-documentos.js';
import { escrituraveisNoLivroDeEntradas } from '../services/livroNotaProdutor';

const EMPRESA = '20385151000112';     // fictício — o cliente que ESCRITURA
const FORNECEDOR = '00288671000108';  // fictício — quem emitiu a nota de entrada

/** A nota que o Paulo circulou: o fornecedor dando entrada da devolução. */
const devolucaoRecebidaPeloFornecedor = (over: any = {}) => ({
    id: 'dev-1',
    numero: '1138363',
    chave: '4226'.padEnd(44, '0'),
    dhEmi: '2026-08-25T10:00:00-03:00',
    tpNF: '0',
    direcao: 'entrada',                 // o importer grava assim: dest === empresa
    empresaCnpj: EMPRESA,
    cnpjEmit: FORNECEDOR,
    xNomeEmit: 'FORNECEDOR LTDA',
    cnpjDest: EMPRESA,
    xNomeDest: 'CLIENTE LTDA',
    tipoDoc: 'NFe',
    modelo: '55',
    totais: { vNF: 199.59, vBC: 199.59, vICMS: 7.98 },
    itens: [{ nItem: '1', cProd: 'X', cfop: '2202', vProd: 181.86, vBC: 199.59, vICMS: 7.98, cst: '00' }],
    ...over,
});

/** Compra normal: o fornecedor vendeu (tpNF=1) e a empresa recebeu. */
const compraNormal = (over: any = {}) => devolucaoRecebidaPeloFornecedor({
    id: 'compra-1', numero: '900', tpNF: '1', ...over,
});

/** A NOSSA nota própria de entrada (art. 136) — quem emite é a empresa. */
const notaPropriaDaEmpresa = (over: any = {}) => devolucaoRecebidaPeloFornecedor({
    id: 'propria-1', numero: '77', cnpjEmit: EMPRESA, cnpjDest: '11111111000191',
    xNomeDest: 'PRODUTOR', ...over,
});

describe('ehEntradaDoEmitente — o FATO do documento', () => {
    it('a devolução recebida pelo FORNECEDOR é entrada DELE, não nossa', () => {
        const r = ehEntradaDoEmitente(devolucaoRecebidaPeloFornecedor(), EMPRESA);
        expect(r.sim).toBe(true);
        expect(r.prova).toBe('tpNF');
    });

    it('a compra normal (tpNF=1) continua sendo entrada nossa', () => {
        expect(ehEntradaDoEmitente(compraNormal(), EMPRESA).sim).toBe(false);
    });

    it('a NOSSA nota própria de entrada (art. 136) NÃO é entrada do emitente', () => {
        const d = notaPropriaDaEmpresa();
        // As duas réguas são complementares por construção: o que é nosso
        // nunca é dele. Se as duas dissessem "sim", a nota do produtor rural
        // sairia do livro — livro a MENOS, o erro caro.
        expect(ehNotaPropriaDeEntrada(d, EMPRESA).sim).toBe(true);
        expect(ehEntradaDoEmitente(d, EMPRESA).sim).toBe(false);
    });

    it('nota gravada como saída (banco antigo, antes do backfill) continua NOSSA', () => {
        const d = notaPropriaDaEmpresa({ direcao: 'saida' });
        expect(ehEntradaDoEmitente(d, EMPRESA).sim).toBe(false);
    });

    // ⚠️ AUSÊNCIA NÃO É PROVA, e aqui ela decide o LADO do erro: tirar nota
    // legítima é livro a MENOS, que não se confere depois.
    it.each([
        ['sem tpNF', devolucaoRecebidaPeloFornecedor({ tpNF: undefined })],
        ['tpNF vazio', devolucaoRecebidaPeloFornecedor({ tpNF: '' })],
        ['sem CNPJ da empresa', devolucaoRecebidaPeloFornecedor({ empresaCnpj: undefined })],
        ['sem emitente legível', devolucaoRecebidaPeloFornecedor({ cnpjEmit: '', emitente: null })],
    ])('%s ⇒ NÃO afirma (a nota fica no livro)', (_nome, doc) => {
        expect(ehEntradaDoEmitente(doc, undefined).sim).toBe(false);
    });

    it('lê o CNPJ nas DUAS formas do banco (achatada e aninhada)', () => {
        const aninhado = devolucaoRecebidaPeloFornecedor({
            cnpjEmit: undefined, emitente: { cnpjCpf: FORNECEDOR },
        });
        expect(ehEntradaDoEmitente(aninhado, EMPRESA).sim).toBe(true);
    });

    it('a DIREÇÃO gravada não muda — quem responde é a régua da escrituração', () => {
        // Ela continua 'entrada' de propósito: o documento é de uma entrada
        // (no emitente). Trocar para 'saida' inflaria o faturamento e o débito
        // de ICMS de uma nota que a empresa nem emitiu.
        expect(direcaoEfetivaDoc(devolucaoRecebidaPeloFornecedor())).toBe('entrada');
    });
});

describe('Livro de Entradas — sai do total e sai NOMEADA', () => {
    const montar = (d: any) => ({ numero: d.numero });
    const valorDe = (d: any) => d.totais?.vNF || 0;

    it('a devolução recebida pelo fornecedor não entra, e o motivo vem junto', () => {
        const r = escrituraveisNoLivroDeEntradas(
            [compraNormal(), devolucaoRecebidaPeloFornecedor()], montar, valorDe, EMPRESA);
        expect(r.linhas).toEqual([{ numero: '900' }]);
        expect(r.excluidas).toHaveLength(1);
        expect(r.excluidas[0].numero).toBe('1138363');
        expect(r.excluidas[0].valor).toBe(199.59);
        expect(r.excluidas[0].motivo).toMatch(/ENTRADA DO FORNECEDOR/);
    });

    it('sem o CNPJ da empresa a nota FICA — a régua não afirma no escuro', () => {
        const semCnpj = devolucaoRecebidaPeloFornecedor({ empresaCnpj: undefined });
        const r = escrituraveisNoLivroDeEntradas([semCnpj], montar, valorDe, '');
        expect(r.linhas).toHaveLength(1);
        expect(r.excluidas).toHaveLength(0);
    });

    it('não gasta o orçamento da dedup do art. 136 com a nota do fornecedor', () => {
        // A nota de devolução do fornecedor tem contraparte e valor iguais aos
        // de uma compra de produtor; se ela entrasse no pareamento, consumiria
        // a nota própria que cobre OUTRO documento e o livro sairia a menos.
        const propria = notaPropriaDaEmpresa({ cnpjDest: FORNECEDOR });
        const doProdutor = compraNormal({ id: 'p2', numero: '901' });
        const r = escrituraveisNoLivroDeEntradas(
            [devolucaoRecebidaPeloFornecedor(), propria, doProdutor], montar, valorDe, EMPRESA);
        const numeros = r.linhas.map((l: any) => l.numero).sort();
        expect(numeros).toEqual(['77']);            // a própria fica; a do produtor pareou
        expect(r.excluidas.map((e) => e.numero).sort()).toEqual(['1138363', '901']);
        // Duas CAUSAS diferentes, duas frases diferentes — a tela agrupa por
        // motivo, e uma frase só mandaria procurar no lugar errado.
        expect(new Set(r.excluidas.map((e) => e.motivo)).size).toBe(2);
    });
});

describe('SPED — as duas famílias, pelo MESMO ponto de seleção', () => {
    it('a nota de entrada do fornecedor não vai ao bloco C', () => {
        const sel = selecionarNotasBlocoC(
            [compraNormal(), devolucaoRecebidaPeloFornecedor()], EMPRESA);
        expect(sel.notas.map((n: any) => n.numero)).toEqual(['900']);
        expect(sel.entradaDoEmitente).toEqual(['1138363']);
    });

    it('e o que ficou fora sai NOMEADO no aviso da geração, com a ação', () => {
        const sel = selecionarNotasBlocoC([devolucaoRecebidaPeloFornecedor()], EMPRESA);
        const avisos = avisosDaSelecao(sel).join(' ');
        expect(avisos).toMatch(/1138363/);
        expect(avisos).toMatch(/ENTRADA DO FORNECEDOR/);
        expect(avisos).toMatch(/nota de SAÍDA/);
    });

    it('sem o CNPJ a nota volta ao bloco C — por isso o argumento é vigiado', () => {
        // Este é o comportamento que `consumidoresMedidos.test.ts` impede de
        // acontecer em produção: a régua não afirma sem saber quem escritura.
        const sel = selecionarNotasBlocoC([devolucaoRecebidaPeloFornecedor({ empresaCnpj: undefined })], undefined);
        expect(sel.notas).toHaveLength(1);
        expect(sel.entradaDoEmitente).toEqual([]);
    });

    it('cancelada de terceiro também não é entrada nossa', () => {
        // A régua vem ANTES do `docCancelado`, que devolve a nota ao bloco C
        // (C100 sem filhos, Guia Prático). Cancelada dele continua sendo dele.
        const sel = selecionarNotasBlocoC(
            [devolucaoRecebidaPeloFornecedor({ status: 'cancelado' })], EMPRESA);
        expect(sel.notas).toHaveLength(0);
        expect(sel.entradaDoEmitente).toEqual(['1138363']);
    });
});

describe('a lista de leitores se MEDE, não se lembra', () => {
    const ler = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

    it('o Exportar SAGE e o preflight passam o CNPJ da empresa', () => {
        // Preflight que não visse o mesmo que a geração prometeria um arquivo
        // diferente do que sai — o defeito de 12/08.
        const tela = ler('components/xml/XmlExportarIobSage.tsx');
        const chamadas = tela.match(/(exportarParaIobSage|conferirAntesDeGerar)\(/g) || [];
        expect(chamadas.length).toBe(2);
        expect((tela.match(/empresaCnpj: empresaSelecionada\?\.cnpj/g) || []).length).toBe(2);
    });

    it('o gerador do .FML delega ao dono — não reimplementa a régua', () => {
        const src = ler('services/iobSageExportService.ts');
        expect(src).toMatch(/ehEntradaDoEmitente\(d, empresaCnpj\)/);
        expect(src).toMatch(/foraDaEscrituracao/);
        // O que sai do arquivo sai NOMEADO na tela, nunca só no console.
        expect(ler('components/xml/XmlExportarIobSage.tsx')).toMatch(/setForaDaEscrituracao\(result\.foraDaEscrituracao\)/);
    });

    it('as abas de escrituração dos Relatórios recebem o recorte filtrado', () => {
        const tela = ler('components/Relatorios/index.tsx');
        for (const aba of ['AbaCfop', 'AbaImpostosResumo', 'AbaUf', 'AbaAliquota', 'AbaProduto', 'AbaParticipante']) {
            expect(tela).toMatch(new RegExp(`<${aba} docs=\\{escriturados\\}`));
        }
        // O Livro recebe TUDO: é ele que nomeia linha a linha, na tela e no PDF.
        expect(tela).toMatch(/<AbaLivro docs=\{docsRecorte\}/);
        // E a ✏️ CFOP por nota também — é lá que a pessoa VÊ a nota e entende
        // por que ela não está no livro.
        expect(tela).toMatch(/<AbaCfopPorNota docs=\{docsRecorte\}/);
    });
});
