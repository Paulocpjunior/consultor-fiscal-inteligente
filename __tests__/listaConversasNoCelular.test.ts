// ============================================================================
// 📱 A LISTA NO CELULAR — dois defeitos no mesmo print (Paulo, 25/08)
//
// *"Achei um erro, no app no celular, vc coloca as últimas 500 mensagens mas
// não carrega"* — com o print mostrando o chip **Todas · 500**, o aviso
// dizendo **"mostrando as 300 conversas mais recentes"**, e QUATRO conversas
// na tela antes do rodapé.
//
// 🐛 (1) O TETO NÃO CORTAVA NADA — e o defeito é meu, de quando baixei o teto
//    de 2000 para 300 sem olhar o tamanho da PÁGINA do banco, que é 500. A
//    primeira leitura já trazia 500, o laço saía satisfeito, e a rota devolvia
//    500 anunciando 300. Duas leituras do mesmo fato na mesma tela.
//
// 🐛 (2) E A LISTA "NÃO CARREGAVA" porque não tinha ESPAÇO: a coluna tem
//    altura fixa e a rolagem era só da lista, DENTRO dela, com o cabeçalho
//    (busca + avisos + aviso do teto + 9 chips) ocupando quase metade da caixa
//    num celular. Quem rolava a página batia no rodapé e concluía, com razão,
//    que tinha acabado.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';

const raiz = (...p: string[]) => path.join(process.cwd(), ...p);
const rota = fs.readFileSync(raiz('sefaz-backend/whatsapp-routes.js'), 'utf8');
const tela = fs.readFileSync(raiz('components/SpConnect/index.tsx'), 'utf8');

describe('🚨 o que sai é o que o aviso promete', () => {
    it('a leitura por PÁGINA é cortada no teto — senão a página do banco manda', () => {
        // A regra é a relação, não os números: enquanto a página for MAIOR que
        // o teto, sem o corte a rota devolve a página inteira.
        expect(rota).toMatch(/docsConversas\.concat\(pagina\.docs\)\.slice\(0, TETO_LEITURA_CONVERSAS\)/);
    });

    it('a leitura por FILA também — duas consultas no teto podem somar o dobro', () => {
        expect(rota).toMatch(/\.sort\(\(a, b\) => quando\(b\) - quando\(a\)\)\.slice\(0, TETO_LEITURA_CONVERSAS\)/);
    });

    it('🚨 o corte tem que existir enquanto a página for maior que o teto', () => {
        const teto = Number(/const TETO_LEITURA_CONVERSAS = (\d+)/.exec(rota)?.[1]);
        const pagina = Number(/const PAGINA_CONVERSAS = (\d+)/.exec(rota)?.[1]);
        expect(Number.isFinite(teto) && Number.isFinite(pagina)).toBe(true);
        // Se um dia a página encolher abaixo do teto o corte fica inofensivo —
        // o que NÃO pode é a página ser maior e o corte sumir num refactor.
        if (pagina > teto) expect(rota).toMatch(/slice\(0, TETO_LEITURA_CONVERSAS\)/);
    });

    it('o aviso do teto continua sendo DITO (recorte calado é o defeito de origem)', () => {
        expect(tela).toMatch(/Mostrando as \{limiteConversas\} conversas mais recentes/);
    });
});

describe('📱 no celular quem rola é a COLUNA, não uma caixinha dentro dela', () => {
    it('a coluna de conversas rola no celular e volta ao normal no md+', () => {
        expect(tela).toMatch(/min-h-0 overflow-y-auto md:overflow-hidden/);
    });

    it('🚨 a lista NÃO pode ter flex-1 no celular — ele comprime de volta', () => {
        // Com `flex-1` a lista volta ao tamanho da caixa de altura fixa e o
        // defeito reaparece inteiro, com a coluna rolando 2px.
        const bloco = tela.slice(tela.indexOf('{visiveis.length === 0 && !carregando ?') - 300,
            tela.indexOf('{visiveis.length === 0 && !carregando ?'));
        expect(bloco).toMatch(/md:flex-1 md:overflow-y-auto md:min-h-0/);
        expect(bloco).not.toMatch(/className="flex-1 overflow-y-auto min-h-0"/);
    });

    it('a THREAD continua com rolagem própria — lá o cabeçalho é pequeno', () => {
        // O composer precisa ficar preso embaixo; rolar a coluna inteira ali
        // levaria o campo de escrever para fora da tela.
        expect(tela).toMatch(/flex-1 overflow-y-auto min-h-0 p-3 space-y-1\.5/);
    });
});
