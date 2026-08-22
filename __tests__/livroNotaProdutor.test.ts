/**
 * Livro de Entradas × compra de produtor rural — o livro estava DOBRADO.
 *
 * Paulo, 12/08/2026, conferindo a VINCENZO GUERRA BANANAS 07/2026: oito notas
 * em pares de valor idêntico, total 37.800,00 quando a entrada real do mês é
 * 18.900,00.
 *
 * É a mesma duplicidade que dobrou o FUNRURAL em 11/08, agora no livro — e a
 * correção existia desde então, só que valia só para a aba 🌾.
 */
import {
    contraparteNormalizada, ehNotaPropriaDeEntrada, livroSemNotaDeProdutorDuplicada,
} from '../services/livroNotaProdutor';

const PRODUTOR = '10112335845';

/** NF-e emitida pelo PRODUTOR (documento de origem) — participantes ACHATADOS. */
const doProdutor = (numero: string, dia: string, valor: number) => ({
    numero, dhEmi: `2026-07-${dia}T10:00:00`, direcao: 'entrada', tpNF: '1',
    cnpjEmit: PRODUTOR, xNomeEmit: 'ROSANGELA GUERRA', ufEmit: 'SP',
    valorTotal: valor,
});

const EMPRESA = '63027940000194';

/**
 * Nota PRÓPRIA de entrada, emitida pelo cliente (tpNF=0) — forma ANINHADA.
 *
 * 🚨 `direcao: 'saida'` É COMO ELA FICA GRAVADA (22/08). A versão anterior
 * deste fixture usava 'entrada' — a forma PÓS-backfill —, e por isso o teste
 * passava enquanto a produção não deduplicava nada: o Livro de Entradas
 * filtrava pelo campo cru, então essa nota nem chegava à dedup. O fixture
 * agora é o caso REAL, e `empresaCnpj` vai junto porque o importer o grava.
 */
const propria = (numero: string, dia: string, valor: number, direcao = 'saida') => ({
    numero, dhEmi: `2026-07-${dia}T10:00:00`, direcao, tpNF: '0',
    empresaCnpj: EMPRESA,
    emitente: { cnpjCpf: EMPRESA, nome: 'VINCENZO GUERRA BANANAS LTDA' },
    destinatario: { cnpjCpf: PRODUTOR, nome: 'ROSANGELA GUERRA' },
    valorTotal: valor,
});

// Exatamente o mês do print.
const DOCS = [
    doProdutor('95', '16', 5200), propria('16', '18', 5200),
    doProdutor('96', '20', 5000), propria('17', '21', 5000),
    doProdutor('97', '24', 3500), propria('18', '27', 3500),
    doProdutor('98', '29', 5200), propria('19', '30', 5200),
];

const montar = (d: any) => ({ numero: String(d.numero), valor: d.valorTotal });
const valorDe = (d: any) => d.valorTotal;

describe('contraparte lida nas DUAS formas', () => {
    // A coluna "Fornecedor/Remetente" do print saiu toda com "—" porque o
    // relatório lia só a forma aninhada.
    it('lê o participante quando o documento vem com campos CHATOS', () => {
        expect(contraparteNormalizada(doProdutor('95', '16', 5200))).toMatchObject({
            nome: 'ROSANGELA GUERRA', doc: PRODUTOR,
        });
    });

    it('na nota PRÓPRIA de entrada a contraparte é o DESTINATÁRIO', () => {
        // O cliente é o emitente ali — ler o emitente devolveria o próprio cliente.
        expect(contraparteNormalizada(propria('16', '18', 5200)).doc).toBe(PRODUTOR);
    });

    it('reconhece a nota própria de entrada pelo tpNF', () => {
        expect(ehNotaPropriaDeEntrada(propria('16', '18', 5200))).toBe(true);
        expect(ehNotaPropriaDeEntrada(doProdutor('95', '16', 5200))).toBe(false);
    });
});

describe('o livro da VINCENZO deixa de dobrar', () => {
    it('8 notas viram 4 — e o total cai de 37.800 para 18.900', () => {
        const r = livroSemNotaDeProdutorDuplicada(DOCS, montar, valorDe);
        expect(r.linhas).toHaveLength(4);
        expect(r.linhas.reduce((s, l) => s + l.valor, 0)).toBe(18900);
        // As escrituradas são as PRÓPRIAS (16-19), não as do produtor (95-98).
        expect(r.linhas.map((l) => l.numero)).toEqual(['16', '17', '18', '19']);
    });

    it('as excluídas NÃO somem: vêm nomeadas, com a base legal', () => {
        const r = livroSemNotaDeProdutorDuplicada(DOCS, montar, valorDe);
        expect(r.excluidas.map((e) => e.numero)).toEqual(['95', '96', '97', '98']);
        expect(r.excluidas[0].participante).toBe('ROSANGELA GUERRA');
        expect(r.excluidas[0].motivo).toMatch(/art\. 136/);
        expect(r.excluidas[0].motivo).toMatch(/RC 33068\/2025/);
    });
});

describe('o que NÃO pode sumir do livro', () => {
    it('NF-e de produtor SEM par fica — muitos clientes escrituram ela direto', () => {
        const r = livroSemNotaDeProdutorDuplicada(
            [doProdutor('95', '16', 5200), doProdutor('96', '20', 5000)], montar, valorDe,
        );
        expect(r.linhas).toHaveLength(2);
        expect(r.excluidas).toEqual([]);
    });

    it('uma nota própria cobre UMA nota do produtor, não todas', () => {
        const r = livroSemNotaDeProdutorDuplicada(
            [doProdutor('95', '16', 5200), doProdutor('99', '17', 5200), propria('16', '18', 5200)],
            montar, valorDe,
        );
        expect(r.linhas).toHaveLength(2);      // 1 do produtor sobra + a própria
        expect(r.excluidas).toHaveLength(1);
    });

    it('valor diferente NÃO pareia — sem prova, escritura as duas', () => {
        const r = livroSemNotaDeProdutorDuplicada(
            [doProdutor('95', '16', 5200), propria('16', '18', 4000)], montar, valorDe,
        );
        expect(r.linhas).toHaveLength(2);
        expect(r.excluidas).toEqual([]);
    });

    it('sem contraparte no documento, nada é excluído', () => {
        const semParte = { numero: '95', dhEmi: '2026-07-16', direcao: 'entrada', tpNF: '1', valorTotal: 5200 };
        const r = livroSemNotaDeProdutorDuplicada(
            [semParte, { ...propria('16', '18', 5200), destinatario: {} }], montar, valorDe,
        );
        expect(r.linhas).toHaveLength(2);
        expect(r.excluidas).toEqual([]);
    });

    it('nota de FORNECEDOR normal (PJ) não é tocada', () => {
        const fornecedor = {
            numero: '400', dhEmi: '2026-07-05', direcao: 'entrada', tpNF: '1',
            cnpjEmit: '11222333000144', xNomeEmit: 'ATACADO LTDA', valorTotal: 5200,
        };
        const r = livroSemNotaDeProdutorDuplicada([fornecedor, propria('16', '18', 5200)], montar, valorDe);
        expect(r.linhas).toHaveLength(2);
        expect(r.excluidas).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A DEDUP NÃO RODAVA PARA NOTA NENHUMA (22/08)
//
// Dois defeitos que se sustentavam:
//
//   · o **Livro de Entradas** filtrava `d.direcao === 'entrada'` — campo CRU.
//     A nota própria de entrada fica gravada como 'saida', então ela NÃO
//     chegava ao livro de entradas (aparecia no de SAÍDAS) e, por tabela,
//     nunca chegava à dedup;
//   · e a `ehNotaPropriaDeEntrada` DESTE arquivo exigia `direcao === 'entrada'`
//     — o contrário do dono no backend. Uma função com o MESMO NOME
//     respondendo diferente, que é o começo de duas respostas divergentes.
//
// Resultado: a nota do PRODUTOR ficava sem par e entrava no livro, com a
// própria contada do outro lado. **A compra dobrava, em dois livros.**
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 a forma REAL do banco (pré-backfill) é reconhecida', () => {
    it('a própria de entrada gravada como "saida" É nota própria de entrada', () => {
        expect(ehNotaPropriaDeEntrada(propria('16', '18', 5200))).toBe(true);
    });

    it('e a pós-backfill ("entrada") também — o backfill não pode quebrar a dedup', () => {
        expect(ehNotaPropriaDeEntrada(propria('16', '18', 5200, 'entrada'))).toBe(true);
    });

    it('a nota do PRODUTOR (tpNF=1) continua não sendo própria de entrada', () => {
        expect(ehNotaPropriaDeEntrada(doProdutor('95', '16', 5200))).toBe(false);
    });

    // O dono barra o tpNF=0 de TERCEIRO: sem esse laço, a nota de entrada do
    // fornecedor viraria "nossa" e a contraparte sairia do lado errado.
    it('tpNF=0 de TERCEIRO não vira nota própria nossa', () => {
        const deTerceiro = {
            numero: '900', dhEmi: '2026-07-10', direcao: 'entrada', tpNF: '0',
            empresaCnpj: EMPRESA,
            emitente: { cnpjCpf: '99999999000199', nome: 'OUTRA EMPRESA LTDA' },
            valorTotal: 100,
        };
        expect(ehNotaPropriaDeEntrada(deTerceiro)).toBe(false);
    });

    // A dedup com a forma REAL: é este o caso que a produção vive hoje.
    it('e a dedup roda: 8 notas gravadas como no banco viram 4', () => {
        const docs = [
            doProdutor('95', '16', 5200), propria('16', '18', 5200),
            doProdutor('96', '20', 5000), propria('17', '21', 5000),
            doProdutor('97', '24', 3500), propria('18', '27', 3500),
            doProdutor('98', '29', 5200), propria('19', '30', 5200),
        ];
        const r = livroSemNotaDeProdutorDuplicada(docs, montar, (d: any) => d.valorTotal);
        expect(r.linhas).toHaveLength(4);
        expect(r.excluidas).toHaveLength(4);
    });
});

// 🔒 O filtro do Livro de Entradas lê pela régua — senão a nota própria nem
// chega aqui, e a dedup fica de enfeite.
describe('🚨 o Livro de Entradas filtra pela RÉGUA', () => {
    it('a tela não filtra pelo campo cru', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const path = require('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', 'components/Relatorios/index.tsx'), 'utf8',
        );
        expect(src).toMatch(/docs\.filter\(d => direcaoEfetivaDoc\(d\) === direcao/);
        expect(src).not.toMatch(/docs\.filter\(d => d\.direcao === direcao/);
    });
});
