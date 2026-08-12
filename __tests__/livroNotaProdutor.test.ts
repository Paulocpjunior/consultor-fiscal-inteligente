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

/** Nota PRÓPRIA de entrada, emitida pelo cliente (tpNF=0) — forma ANINHADA. */
const propria = (numero: string, dia: string, valor: number) => ({
    numero, dhEmi: `2026-07-${dia}T10:00:00`, direcao: 'entrada', tpNF: '0',
    emitente: { cnpjCpf: '63027940000194', nome: 'VINCENZO GUERRA BANANAS LTDA' },
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
