// ============================================================================
// A FILA SAI DO APP — para o Paulo correr atrás.
//
// Paulo, 14/08: *"mais fácil me mandar os fornecedores e os erros igual o
// Antonio, de manhã eu corro atrás"*. O trabalho dele não é na tela — é no
// CADESP e no telefone. Uma fila que só existe dentro do app é uma fila que
// ninguém ataca.
//
// ═══ O QUE ESTAS TRAVAS VIGIAM ══════════════════════════════════════════════
//
// · NENHUMA CONTA NOVA: tudo sai do payload que a tela já mostra. Export com
//   conta própria diverge da tela sozinho (o card 4 ficou dois dias mentindo).
// · AGRUPADO POR FORNECEDOR: a ação é por fornecedor — uma consulta ao CADESP
//   resolve todas as notas dele. Por nota, a fila pareceria dez vezes maior do
//   que o trabalho que ela é.
// · LISTA CORTADA DIZ QUE CORTOU: o `slice(0,20)` mudo do painel de Legalização
//   (30/07) contradizia os próprios selos e ninguém via.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    montarFilaFornecedores, resumirFila, textoDaFila, linhasDoPdf, totaisDoPdf,
    observacoesDoPdf, fmtDoc, LIMITE_WHATSAPP,
} from '../services/dipamFilaExport';

const pend = (over: Record<string, unknown> = {}) => ({
    codigo: 'fornecedor-indefinido',
    mensagem: 'Fornecedor com CNPJ e sem IE de produtor.',
    acao: 'Consulte o CADESP e confirme a natureza.',
    fornecedor: 'ANTONIO DIAS DA SILVA',
    doc: '08507490000129',
    notas: 4,
    valor: 18900,
    funruralPotencial: 308.07,
    ...over,
});

describe('agrupa por FORNECEDOR — a ação é dele, não da nota', () => {
    it('o mesmo CNPJ em duas pendências vira UMA linha, somando', () => {
        const fila = montarFilaFornecedores([
            pend({ notas: 4, valor: 18900, funruralPotencial: 308.07 }),
            pend({ notas: 2, valor: 1100, funruralPotencial: 17.93 }),
        ]);
        expect(fila).toHaveLength(1);
        expect(fila[0].notas).toBe(6);
        expect(fila[0].valor).toBe(20000);
        expect(fila[0].funruralPotencial).toBeCloseTo(326, 2);
    });

    it('sem fornecedor lido, o eixo é a NOTA — senão não há o que fazer', () => {
        // "12 notas sem fornecedor" num balde só não diz QUAIS, e aí ninguém
        // consegue abrir nenhuma delas.
        const fila = montarFilaFornecedores([
            pend({ fornecedor: null, doc: null, numero: '95', chave: 'A' }),
            pend({ fornecedor: null, doc: null, numero: '96', chave: 'B' }),
        ]);
        expect(fila).toHaveLength(2);
        expect(fila[0].quem).toMatch(/Nota nº 9/);
    });

    it('ordena pelo que vale mais — a primeira costuma resolver o mês', () => {
        const fila = montarFilaFornecedores([
            pend({ doc: '11111111111', fornecedor: 'PEQUENO', valor: 100 }),
            pend({ doc: '22222222222', fornecedor: 'GRANDE', valor: 90000 }),
        ]);
        expect(fila.map(f => f.quem)).toEqual(['GRANDE', 'PEQUENO']);
    });

    it('leva a AÇÃO, nunca o código interno', () => {
        // Quem lê no WhatsApp não sabe o que é `fornecedor-sociedade`, e o
        // código não diz o que fazer.
        const fila = montarFilaFornecedores([pend()]);
        expect(fila[0].oQueFalta).toMatch(/CADESP/);
        expect(fila[0].oQueFalta).not.toMatch(/fornecedor-indefinido/);
    });
});

describe('o texto do WhatsApp', () => {
    const fila = montarFilaFornecedores([pend()]);
    const txt = textoDaFila({ empresa: 'NOVA ERA', competencia: '2026-07', fila });

    it('abre com empresa, competência e o total que está parado', () => {
        expect(txt).toMatch(/NOVA ERA/);
        expect(txt).toMatch(/2026-07/);
        expect(txt).toMatch(/1 fornecedor\(es\) · 4 nota\(s\)/);
        expect(txt).toMatch(/R\$\s*18\.900,00/);
    });

    it('cada linha tem quem, quanto e o que falta', () => {
        expect(txt).toMatch(/ANTONIO DIAS DA SILVA/);
        expect(txt).toMatch(/08\.507\.490\/0001-29/);
        expect(txt).toMatch(/Consulte o CADESP/);
    });

    it('lista cortada DIZ que cortou, e onde está a inteira', () => {
        const grande = montarFilaFornecedores(
            Array.from({ length: LIMITE_WHATSAPP + 5 }, (_, i) =>
                pend({ doc: String(i).padStart(11, '0'), fornecedor: `F${i}`, valor: 1000 - i })),
        );
        const t = textoDaFila({ empresa: 'X', competencia: '2026-07', fila: grande });
        expect(t).toMatch(new RegExp(`Mostrando os ${LIMITE_WHATSAPP} maiores de ${LIMITE_WHATSAPP + 5}`));
        expect(t).toMatch(/O PDF traz todos/);
    });

    it('fila vazia NÃO afirma que está tudo certo', () => {
        // Zero só vale com a captura saudável — e quem sabe isso é o painel,
        // não este texto. Mesma lição do "sem movimento" do PGDAS-D.
        const t = textoDaFila({ empresa: 'X', competencia: '2026-07', fila: [] });
        expect(t).toMatch(/Nenhuma pendência/);
        expect(t).toMatch(/não prova que as notas chegaram/);
    });
});

describe('o PDF', () => {
    const fila = montarFilaFornecedores([pend()]);

    it('as linhas saem na ordem das colunas declaradas', () => {
        const [l] = linhasDoPdf(fila);
        expect(l[0]).toBe('ANTONIO DIAS DA SILVA');
        expect(l[1]).toBe('08.507.490/0001-29');
        expect(l[2]).toBe('4');
        expect(String(l[5])).toMatch(/CADESP/);
    });

    it('o total fecha com a soma das linhas', () => {
        const r = resumirFila(fila);
        const t = totaisDoPdf(fila);
        expect(t[0]).toBe('TOTAL');
        expect(String(t[3])).toContain('18.900,00');
        expect(r.funruralPotencial).toBeCloseTo(308.07, 2);
    });

    it('o rodapé DIZ que esse dinheiro não é imposto devido', () => {
        // Um papel com "R$ 1,4 milhão fora do total" sem essa frase faz alguém
        // provisionar valor que não existe.
        const obs = observacoesDoPdf(null);
        expect(obs.join(' ')).toMatch(/FORA do total/);
        expect(obs.join(' ')).toMatch(/não o que é devido/);
    });

    it('e avisa quem já foi tirado por decisão — senão procuram no CADESP à toa', () => {
        const obs = observacoesDoPdf({
            funrural: { tiradosPorDecisao: [{ doc: '1', fornecedor: 'X', decisao: 'nao_aplica', rotulo: '', reversivelNaLinha: true, notas: 1, valor: 1, funruralPotencial: 1 }] },
        } as any);
        expect(obs.join(' ')).toMatch(/decisão gravada/);
    });
});

describe('formatação de documento', () => {
    it.each([
        ['08507490000129', '08.507.490/0001-29'],
        ['06603394987', '066.033.949-87'],
        ['', '—'],
    ])('%s → %s', (entrada, saida) => {
        expect(fmtDoc(entrada)).toBe(saida);
    });
});

describe('a TELA tem os dois botões, e o PDF usa a casca única', () => {
    const painel = readFileSync(
        join(__dirname, '..', 'components/xml/DipamProdutorRuralPanel.tsx'), 'utf8');

    it('copiar e PDF existem no bloco de pendências', () => {
        expect(painel).toMatch(/copiar a fila/);
        expect(painel).toMatch(/PDF da fila/);
    });

    it('o PDF sai pela casca da casa — identidade SP num lugar só', () => {
        expect(painel).toMatch(/gerarRelatorioPdf/);
    });

    it('a tela NÃO refaz a conta — ela chama o núcleo', () => {
        expect(painel).toMatch(/montarFilaFornecedores\(painel\.pendencias\)/);
    });
});
