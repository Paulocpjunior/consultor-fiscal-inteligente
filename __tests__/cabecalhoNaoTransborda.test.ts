/**
 * MATA-BURRO: FILEIRA DE BOTÕES QUEBRA LINHA.
 *
 * Paulo, 13/08: *"caralho meu! terceira vez erro de layout"*. Ele estava certo,
 * e as três foram a MESMA causa não vista: o cabeçalho do detalhe do Simples
 * tem DOZE botões num `flex gap-2` sem `flex-wrap`. Sem quebra de linha eles
 * transbordam a viewport, empurram o cabeçalho e o nome da empresa desce numa
 * coluna de uma palavra por linha.
 *
 * Eu venho somando botões nessa fileira (🔎 Atividades, 📄 Declarar sem
 * movimento, 🔬 Sondar forma) sem olhar o conjunto — cada um "só mais um".
 *
 * Este teste não avalia estética. Ele guarda UMA regra mecânica e verificável:
 * container com muitos botões declara como quebra a linha. Um `flex` de N
 * botões sem `flex-wrap` transborda — isso é comportamento do CSS, não gosto.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const RAIZ = join(__dirname, '..');
const COMPONENTES = join(RAIZ, 'components');

/** A partir de quantos botões a linha única deixa de caber. */
const LIMITE = 5;

function arquivos(dir: string): string[] {
    const out: string[] = [];
    for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) { out.push(...arquivos(caminho)); continue; }
        if (nome.endsWith('.tsx')) out.push(caminho);
    }
    return out;
}

describe('MATA-BURRO: fileira de botões não transborda a tela', () => {
    const suspeitos = arquivos(COMPONENTES)
        .map((f) => ({ arquivo: relative(RAIZ, f), conteudo: readFileSync(f, 'utf8') }))
        .filter((f) => (f.conteudo.match(/btn-press/g) || []).length >= LIMITE);

    it('a varredura acha os componentes com muitos botões', () => {
        expect(suspeitos.length).toBeGreaterThan(0);
        expect(suspeitos.map((s) => s.arquivo)).toContain('components/SimplesNacionalDetalhe.tsx');
    });

    it.each(suspeitos.map((s) => [s.arquivo, s] as const))(
        '%s: nenhum container de botões usa `flex gap-N` sem flex-wrap',
        (arquivo, s) => {
            // A assinatura do defeito não é "existe um flex gap-N" — fileira
            // de 2 ou 3 botões cabe em qualquer tela, e proibir isso encheria
            // a trava de falso positivo (teste que grita sem motivo é teste
            // desligado). O que transborda é o flex com MUITOS botões: conta
            // quantos `btn-press` vêm logo depois da abertura do container.
            const JANELA = 4000;
            const cru: string[] = [];
            const re = /className="flex gap-\d+"/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(s.conteudo)) !== null) {
                const trecho = s.conteudo.slice(m.index, m.index + JANELA);
                const botoes = (trecho.match(/btn-press/g) || []).length;
                if (botoes >= LIMITE) cru.push(`${m[0]} (~${botoes} botões)`);
            }
            if (cru.length) {
                throw new Error(
                    `\n\n🚧 FILEIRA DE BOTÕES SEM QUEBRA DE LINHA — ${arquivo}\n\n`
                    + `  ${cru.length} container(es) com \`className="flex gap-N"\` num componente de `
                    + `${(s.conteudo.match(/btn-press/g) || []).length} botões.\n\n`
                    + 'Sem `flex-wrap` a fileira transborda a viewport, empurra o cabeçalho e espreme\n'
                    + 'o que estiver do lado (foi assim que o nome da empresa virou uma coluna de\n'
                    + 'letras, três vezes em 13/08).\n\n'
                    + 'Use `flex flex-wrap gap-N md:justify-end` — ou `grid`, ou `overflow-x-auto`.\n'
                    + 'O que não vale é não declarar o que acontece quando não cabe.\n',
                );
            }
            expect(cru).toEqual([]);
        },
    );

    it('o cabeçalho do Simples deixa o nome encolher sem virar coluna de letras', () => {
        const s = readFileSync(join(COMPONENTES, 'SimplesNacionalDetalhe.tsx'), 'utf8');
        // `min-w-0` é o que permite o flex item encolher; sem ele o navegador
        // respeita a largura mínima do conteúdo e quebra palavra a palavra.
        expect(s).toMatch(/flex items-center gap-3 min-w-0/);
        expect(s).toMatch(/flex flex-wrap gap-2 md:justify-end/);
    });

    it('e o texto não quebra DENTRO do botão', () => {
        const s = readFileSync(join(COMPONENTES, 'SimplesNacionalDetalhe.tsx'), 'utf8');
        const comPadding = (s.match(/btn-press flex items-center gap-2 px-4 py-2 /g) || []).length;
        const comNowrap = (s.match(/btn-press flex items-center gap-2 px-4 py-2 whitespace-nowrap/g) || []).length;
        expect(comNowrap).toBe(comPadding);
    });
});
