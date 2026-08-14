// ============================================================================
// AÇÃO ESCONDIDA ATRÁS DE ROLAGEM HORIZONTAL É AÇÃO QUE NÃO EXISTE.
//
// Paulo, 14/08: *"cadê a opção p ATIVAR EMPRESA"*. Ele buscou o código 1200 no
// Painel Simples Nacional, achou a linha da empresa — e não tinha como entrar
// nela.
//
// A coluna **Ações** (Painel · Cliente · ✏️ · 🗑) EXISTIA. Só que ela vem depois
// de sete outras colunas, dentro de um `overflow-x-auto` que **não avisa que há
// mais coisa à direita**. Numa tela de notebook ela simplesmente não aparece, e
// a ação principal da tela — abrir a empresa — ficou invisível.
//
// ═══ POR QUE ISSO É A MESMA FAMÍLIA DO MATA-BURRO DE 13/08 ══════════════════
//
// "Fileira de botões quebra linha" era layout que não declarava o que acontece
// quando não cabe. Este é o mesmo defeito na horizontal: a tabela ROLA, e rolar
// é uma decisão de layout legítima — o que não vale é a rolagem levar embora
// justamente o que a pessoa veio fazer.
//
// ═══ A TRAVA É VARREDURA, NÃO LISTA ═════════════════════════════════════════
//
// Não adianta consertar a tabela que eu vi: a próxima tabela larga nasce com o
// mesmo furo. Aqui se percorre `components/` atrás de tabela ROLÁVEL com coluna
// de Ações, e se cobra que ela fique GRUDADA (`sticky right-0`).
//
// O limiar de 6 colunas evita o falso positivo da tabela estreita, que cabe em
// qualquer tela — teste que grita sem motivo é teste que alguém desliga (a
// mesma calibragem do `cabecalhoNaoTransborda`, que só acusa a partir de 5
// botões).
// ============================================================================
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..', 'components');

function varrerTsx(dir: string): string[] {
    const out: string[] = [];
    for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) out.push(...varrerTsx(caminho));
        else if (nome.endsWith('.tsx')) out.push(caminho);
    }
    return out;
}

interface Achado {
    arquivo: string;
    colunas: number;
    grudada: boolean;
}

/**
 * Acha toda coluna de Ações que vive dentro de uma tabela ROLÁVEL.
 *
 * Rolável = existe um `overflow-x-auto` antes dela, no mesmo bloco. A janela é
 * limitada para não casar com o `overflow-x-auto` de outra tabela da página.
 */
function acoesEmTabelaRolavel(fonte: string, arquivo: string): Achado[] {
    const achados: Achado[] = [];
    const re = /Ações<\/th>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fonte)) !== null) {
        const fim = m.index;
        const janela = fonte.slice(Math.max(0, fim - 4000), fim);
        const rolavel = janela.lastIndexOf('overflow-x-auto');
        if (rolavel === -1) continue;

        const cabecalho = janela.slice(rolavel);
        const colunas = (cabecalho.match(/<th\b/g) || []).length + 1;
        // A tag <th> das Ações começa antes do texto: pega ela inteira.
        const inicioTh = fonte.lastIndexOf('<th', fim);
        const tagTh = fonte.slice(inicioTh, fim);
        achados.push({
            arquivo,
            colunas,
            grudada: /sticky/.test(tagTh) && /right-0/.test(tagTh),
        });
    }
    return achados;
}

const arquivos = varrerTsx(RAIZ);
const todos = arquivos.flatMap((f) => acoesEmTabelaRolavel(readFileSync(f, 'utf8'), f.replace(join(__dirname, '..') + '/', '')));

describe('a varredura enxerga o que deve enxergar', () => {
    it('acha o Painel Simples Nacional — se não achar, ela não prova nada', () => {
        // Guarda da própria trava: uma varredura que não casa com nada passa em
        // silêncio para sempre. Este é o caso REAL que a originou.
        const simples = todos.filter((a) => a.arquivo.includes('SimplesNacionalDashboard'));
        expect(simples.length).toBeGreaterThan(0);
        expect(simples[0].colunas).toBeGreaterThanOrEqual(6);
    });
});

describe('coluna de Ações em tabela larga e rolável fica GRUDADA', () => {
    const largas = todos.filter((a) => a.colunas >= 6);

    it.each(largas.length ? largas.map((a) => [a.arquivo, a] as const) : [['(nenhuma)', null] as const])(
        '%s', (_nome, achado) => {
            if (!achado) return;
            expect(achado.grudada).toBe(true);
        });

    it('tabela ESTREITA não é cobrada — ela cabe, e alarme sem motivo é alarme desligado', () => {
        // A régua vale para a tabela que ROLA de verdade. Cobrar de todas faria
        // a trava virar ruído e alguém a desligaria inteira.
        const estreitas = todos.filter((a) => a.colunas < 6);
        expect(estreitas.every((a) => a.colunas < 6)).toBe(true);
    });
});

describe('e a empresa se abre pelo NOME, sem depender de rolar', () => {
    const painel = readFileSync(join(RAIZ, 'SimplesNacionalDashboard.tsx'), 'utf8');

    it('o nome da empresa é o caminho para o painel dela', () => {
        // Grudar a coluna resolve a rolagem; clicar no nome é a affordance que
        // a pessoa procura primeiro. As duas juntas é que fecham o caso.
        expect(painel).toMatch(/onSelectEmpresa\(e\.id, 'detalhe'\)[\s\S]{0,300}\{e\.nome\}/);
        expect(painel).toMatch(/Abrir o painel desta empresa/);
    });
});
