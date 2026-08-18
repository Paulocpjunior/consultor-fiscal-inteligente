/**
 * atalhoCfopPorNota — o atalho do card CFOP tem que CHEGAR na aba.
 *
 * Paulo, 18/08, com o print do card 🔄 CFOP aberto: *"n identifiquei"*. O
 * ✏️ CFOP por nota tinha subido no dia anterior, dentro de Relatórios, e quem
 * procura CFOP procura no card que se chama CFOP. Não era falta de entrega —
 * era entrega numa porta que ninguém abre, a mesma família do "rota sem botão"
 * (13/08) e do botão que existia no lugar errado (17/08, guia separada).
 *
 * O que esta trava impede de voltar, EM SILÊNCIO:
 *
 *  (1) o atalho apontar para uma aba que não existe mais — renomear `cfop-nota`
 *      em Relatórios deixaria o botão levando à primeira aba, e o colaborador
 *      cairia no Livro de Entradas achando que o campo sumiu;
 *  (2) o atalho grudar — sem a limpeza no `selecionarTipo`, quem clicasse uma
 *      vez abriria Relatórios naquela aba para sempre, respondendo a um pedido
 *      que ninguém fez;
 *  (3) o guia deixar de dizer onde é — quem lê o guia é justamente quem não
 *      achou a tela.
 */
import * as fs from 'fs';
import * as path from 'path';

const raiz = path.resolve(__dirname, '..');
const ler = (p: string) => fs.readFileSync(path.join(raiz, p), 'utf8');

describe('atalho do card CFOP → ✏️ CFOP por nota', () => {
    const app = ler('App.tsx');
    const relatorios = ler('components/Relatorios/index.tsx');

    it('o botão existe no card CFOP e leva para Relatórios', () => {
        expect(app).toContain("searchType === SearchType.CFOP && (");
        expect(app).toContain("selecionarTipo(SearchType.RELATORIOS); setRelatoriosAba('cfop-nota')");
    });

    it('a aba que o atalho pede EXISTE em Relatórios', () => {
        // A união AbaId é a lista real das abas — se `cfop-nota` sair dela, o
        // atalho vira um botão que leva ao lugar errado sem nada acusar.
        const uniao = relatorios.slice(
            relatorios.indexOf('export type AbaId'),
            relatorios.indexOf("'trimestre'") + 20,
        );
        expect(uniao).toContain("'cfop-nota'");
        // E a tela tem que HONRAR o pedido — prop lida no estado inicial.
        expect(relatorios).toContain("useState<AbaId>(abaInicial || 'livro')");
    });

    it('o atalho não gruda: trocar de card limpa a aba pedida', () => {
        const inicio = app.indexOf('const selecionarTipo');
        const corpo = app.slice(inicio, inicio + 900);
        expect(corpo).toContain('setRelatoriosAba(null)');
    });

    it('o guia diz que o card CFOP é consulta à IA — nas DUAS metades', () => {
        for (const arquivo of ['public/guia-cfop-por-nota.html', 'docs/guia-colaborador-cfop.md']) {
            const texto = ler(arquivo);
            expect(texto).toMatch(/card <strong>CFOP<\/strong>|card \*\*CFOP\*\*/);
            expect(texto).toMatch(/consulta a IA|consulta<\/strong> a IA|<strong>consulta a IA<\/strong>/);
        }
    });
});
