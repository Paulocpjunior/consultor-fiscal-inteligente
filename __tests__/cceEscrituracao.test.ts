/**
 * A CARTA DE CORREÇÃO muda a escrituração — e ninguém estava vendo.
 *
 * A CC-e é capturada desde sempre (fica em `documentos_fiscais.eventos[]`) e
 * aparece na lista de XMLs com um selo. Mas NENHUM ponto da escrituração lê
 * esse array: nem o gerador do SPED, nem o Exportar SAGE.
 *
 * Pelo Ajuste SINIEF 07/05 a CC-e PODE corrigir a natureza da operação e o
 * CFOP — e o CFOP manda no livro, no C190, no DIFAL e na DIPAM. Se o cliente
 * corrigiu o CFOP e a gente escritura o XML original, o livro sai justamente
 * com o CFOP que ele mandou corrigir.
 *
 * O que este teste protege acima de tudo: o app NÃO aplica a correção. O texto
 * é livre, e deduzir o campo corrigido seria inventar dado fiscal.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { classificarCce, ccesDoDocumento, varrerCcesDoPeriodo } from '../sefaz-backend/cce-escrituracao';

const cce = (xCorrecao: string, over: any = {}) => ({ tipo: 'cce', tpEvento: '110110', xCorrecao, ...over });

describe('o que a correção mexe', () => {
    it('CFOP é o caso que MANDA na escrituração', () => {
        const c = classificarCce(cce('CORRIGIR O CFOP DE 5102 PARA 5405'));
        expect(c.classe).toBe('muda-escrituracao');
        expect(c.exigeConferencia).toBe(true);
        expect(c.motivo).toMatch(/XML ORIGINAL/);
    });

    it('natureza da operação também', () => {
        expect(classificarCce(cce('Correcao da natureza da operacao para VENDA DE MERCADORIA'))
            .classe).toBe('muda-escrituracao');
    });

    it('NCM e CST entram', () => {
        expect(classificarCce(cce('NCM correto: 8471.30.12')).classe).toBe('muda-escrituracao');
        expect(classificarCce(cce('ajuste de CST')).classe).toBe('muda-escrituracao');
    });

    it('transportador e observação não mexem no livro', () => {
        const c = classificarCce(cce('Incluir dados do transportador: TRANSPORTES XYZ, placa ABC1D23'));
        expect(c.classe).toBe('sem-efeito-fiscal');
        expect(c.exigeConferencia).toBe(false);
    });
});

describe('CC-e usada pra coisa que ela NÃO PODE corrigir', () => {
    it('mencionar VALOR acende — a CC-e não corrige valor (SINIEF 07/05 14-A §1º)', () => {
        const c = classificarCce(cce('Corrigir o valor total da nota para 1.500,00'));
        expect(c.classe).toBe('indevida-suspeita');
        expect(c.motivo).toMatch(/cancelamento e reemiss/);
    });

    it.each([
        ['quantidade', 'Corrigir a quantidade do item 1'],
        ['CNPJ do destinatário', 'CNPJ do destinatario correto e 11.111.111/0001-91'],
        ['data de emissão', 'A data de emissao correta e 05/08/2026'],
        ['alíquota', 'Alterar aliquota de ICMS para 12%'],
    ])('%s também acende', (_rotulo, texto) => {
        expect(classificarCce(cce(texto)).classe).toBe('indevida-suspeita');
    });

    it('a PROIBIDA vence a de escrituração — o problema maior manda', () => {
        // Se o texto fala em valor E em CFOP, o buraco é o valor.
        const c = classificarCce(cce('Corrigir CFOP para 5405 e o valor do item'));
        expect(c.classe).toBe('indevida-suspeita');
    });
});

describe('o app NÃO aplica a correção', () => {
    it('extrai "de X para Y" como SUGESTÃO, carimbada com o texto', () => {
        const c = classificarCce(cce('CORRIGIR O CFOP DE 5102 PARA 5405'));
        expect(c.sugestao).toEqual({ de: '5102', para: '5405' });
        // O texto original acompanha SEMPRE — sugestão sem origem vira boato.
        expect(c.texto).toMatch(/CORRIGIR O CFOP/);
    });

    it('texto sem "de/para" não inventa sugestão', () => {
        expect(classificarCce(cce('CFOP incorreto na nota')).sugestao).toBeNull();
    });

    it('a varredura AVISA que a correção não é aplicada sozinha', () => {
        const v = varrerCcesDoPeriodo([{ chave: '1', eventos: [cce('CFOP de 5102 para 5405')] }]);
        expect(v.avisos.join(' ')).toMatch(/NÃO aplica a correção sozinho/);
        expect(v.avisos.join(' ')).toMatch(/inventar/);
    });
});

describe('CC-e sem texto', () => {
    it('não é CC-e inofensiva — é CC-e que não dá pra avaliar', () => {
        const c = classificarCce(cce(''));
        expect(c.classe).toBe('sem-texto');
        expect(c.exigeConferencia).toBe(true);
    });

    it('a varredura manda reimportar o XML do evento', () => {
        const v = varrerCcesDoPeriodo([{ chave: '1', eventos: [cce('')] }]);
        expect(v.avisos.join(' ')).toMatch(/Reimporte o XML do evento/);
    });
});

describe('quais eventos são CC-e', () => {
    it('pega por tipo e por tpEvento 110110', () => {
        const doc = {
            eventos: [
                { tipo: 'cancelamento', tpEvento: '110111' },
                { tipo: 'cce', xCorrecao: 'a' },
                { tpEvento: '110110', xCorrecao: 'b' },
                { tipo: 'ciencia', tpEvento: '210210' },
            ],
        };
        expect(ccesDoDocumento(doc)).toHaveLength(2);
    });

    it('documento sem eventos não quebra', () => {
        expect(ccesDoDocumento({})).toEqual([]);
        expect(ccesDoDocumento(null)).toEqual([]);
    });
});

describe('varredura do período', () => {
    const docs = [
        { chave: 'A', numero: '1', competencia: '2026-07', eventos: [cce('CFOP de 5102 para 5405')] },
        { chave: 'B', numero: '2', competencia: '2026-07', eventos: [cce('Corrigir o valor do item 3')] },
        { chave: 'C', numero: '3', competencia: '2026-07', eventos: [cce('Incluir transportador')] },
        { chave: 'D', numero: '4', competencia: '2026-07', eventos: [] },
    ];

    it('conta por classe e diz quantas pedem conferência', () => {
        const v = varrerCcesDoPeriodo(docs);
        expect(v.resumo.cces).toBe(3);
        expect(v.resumo.documentos).toBe(3);
        expect(v.resumo.mudaEscrituracao).toBe(1);
        expect(v.resumo.indevidaSuspeita).toBe(1);
        expect(v.resumo.semEfeitoFiscal).toBe(1);
        expect(v.resumo.exigemConferencia).toBe(2);
    });

    it('a indevida vem primeiro — é o problema maior', () => {
        expect(varrerCcesDoPeriodo(docs).linhas[0].classe).toBe('indevida-suspeita');
    });

    it('período sem CC-e nenhuma não gera aviso', () => {
        const v = varrerCcesDoPeriodo([{ chave: 'D', eventos: [] }]);
        expect(v.resumo.cces).toBe(0);
        expect(v.avisos).toEqual([]);
    });

    it('duas CC-e no mesmo documento contam as duas, e o doc uma vez', () => {
        const v = varrerCcesDoPeriodo([
            { chave: 'A', eventos: [cce('CFOP errado', { nSeqEvento: 1 }), cce('NCM errado', { nSeqEvento: 2 })] },
        ]);
        expect(v.resumo.cces).toBe(2);
        expect(v.resumo.documentos).toBe(1);
    });
});
