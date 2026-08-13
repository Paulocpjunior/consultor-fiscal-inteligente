// ============================================================================
// MATA-BURRO: MODAL ALTO NÃO PODE ESCONDER O FIM DE SI MESMO.
//
// Paulo, 13/08: *"ajuste de layout esta escondendo os botoes no fim da pagina"*
// — no detalhe da DCTFWeb, "Gerar DARF" e as guias por vencimento ficavam fora
// de alcance.
//
// ═══ A CAUSA, QUE É DE FLEXBOX E NÃO DE CSS "FALTANDO" ══════════════════════
//
// `fixed inset-0 flex items-center` com um filho MAIS ALTO que o container faz
// o excesso transbordar para CIMA **e** para BAIXO, em partes iguais. E o
// pedaço de cima é INALCANÇÁVEL: não existe rolagem negativa. Some metade do
// modal, e a metade que some é justamente a que tem os botões quando o
// conteúdo cresce.
//
// `max-h-[90vh] overflow-auto` no CARD não resolve sozinho — ele limita a
// altura, mas se algum descendente forçar altura (iframe de PDF, tabela larga),
// o card estoura e o overlay centralizado corta os dois lados.
//
// ═══ A REGRA ════════════════════════════════════════════════════════════════
//
// Overlay de modal DEVE declarar o que acontece quando o conteúdo não cabe.
// Vale qualquer uma destas:
//   · `overflow-y-auto` no overlay (a página rola até o fim do card);
//   · `items-start` (o excesso cai só para baixo, onde há rolagem);
//   · `max-h-*` + `overflow-*` no card, quando o card é curto e previsível.
//
// O que NÃO vale é `items-center` sem nenhuma delas — aí o excesso some por
// cima e ninguém descobre até um cliente reclamar.
//
// ═══ POR QUE A VARREDURA É CONSERVADORA ═════════════════════════════════════
//
// Ela só acusa overlay que casa `fixed inset-0` + `items-center` E não declara
// NADA sobre transbordo na mesma linha. Um teste que gritasse em todo modal
// (41 arquivos) seria desligado no primeiro dia — e teste desligado não protege
// ninguém. É a mesma calibragem do `cabecalhoNaoTransborda`.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const RAIZ = join(__dirname, '..');

function arquivosTsx(dir: string): string[] {
    const out: string[] = [];
    for (const nome of readdirSync(dir)) {
        if (nome === 'node_modules' || nome.startsWith('.')) continue;
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) { out.push(...arquivosTsx(caminho)); continue; }
        if (nome.endsWith('.tsx')) out.push(caminho);
    }
    return out;
}

/** A linha do overlay: `fixed inset-0` no mesmo className. */
const RE_OVERLAY = /className="[^"]*\bfixed\s+inset-0\b[^"]*"/g;

/** O que declara o comportamento quando não cabe. */
const DECLARA_TRANSBORDO = /\boverflow-y-auto\b|\boverflow-auto\b|\bitems-start\b|\boverflow-y-scroll\b/;

/** Centralização vertical — só é problema quando nada acima está declarado. */
const CENTRALIZA = /\bitems-center\b/;

const ARQUIVOS = arquivosTsx(join(RAIZ, 'components'));

describe('MATA-BURRO: modal alto não esconde o próprio fim', () => {
    it('a varredura enxerga os modais (se vier vazia, a trava é falsa)', () => {
        const comOverlay = ARQUIVOS.filter((f) => /className="[^"]*fixed\s+inset-0/.test(readFileSync(f, 'utf8')));
        expect(comOverlay.length).toBeGreaterThan(20);
    });

    it('nenhum overlay centraliza sem dizer o que acontece quando não cabe', () => {
        const infratores: string[] = [];
        for (const arquivo of ARQUIVOS) {
            const conteudo = readFileSync(arquivo, 'utf8');
            for (const m of conteudo.matchAll(RE_OVERLAY)) {
                const classe = m[0];
                if (!CENTRALIZA.test(classe)) continue;          // não centraliza: sem risco
                if (DECLARA_TRANSBORDO.test(classe)) continue;   // declarou: ok
                // O card FILHO pode declarar por ele — só aceita quando o
                // recorte logo abaixo traz max-h junto de overflow.
                const janela = conteudo.slice(m.index || 0, (m.index || 0) + 600);
                if (/max-h-\[[^\]]+\][^"]*\boverflow-(y-)?auto\b/.test(janela)) continue;
                infratores.push(`${relative(RAIZ, arquivo).split('\\').join('/')}  →  ${classe.slice(0, 110)}`);
            }
        }

        if (infratores.length) {
            throw new Error(
                '\n\n🚧 MODAL PODE ESCONDER O PRÓPRIO FIM\n\n'
                + 'Estes overlays usam `fixed inset-0` com `items-center` e não declaram o que fazer\n'
                + 'quando o conteúdo é mais alto que a tela:\n'
                + infratores.map((i) => `  · ${i}`).join('\n')
                + '\n\nCom `items-center`, o excesso transborda para CIMA e para BAIXO — e o pedaço de\n'
                + 'cima é INALCANÇÁVEL (não existe rolagem negativa). Foi assim que os botões do\n'
                + 'detalhe da DCTFWeb sumiram (Paulo, 13/08).\n\n'
                + 'Resolve qualquer uma:\n'
                + '  · `overflow-y-auto` no overlay — a página rola até o fim do card;\n'
                + '  · `items-start` — o excesso cai só para baixo, onde há rolagem;\n'
                + '  · `max-h-[...]` + `overflow-auto` no card logo abaixo, se ele for curto.\n\n'
                + 'O que não vale é não declarar nada.\n',
            );
        }
        expect(infratores).toEqual([]);
    });

    /**
     * O detalhe da DCTFWeb foi o caso real — e ele ganhou a defesa completa,
     * inclusive o PORTAL: qualquer ancestral com `transform`/`will-change` vira
     * containing block de `position: fixed` (spec CSS), e aí nem `inset-0`
     * salva. Auditar a árvore inteira a cada animação nova não escala; o portal
     * imuniza de uma vez.
     */
    it('o detalhe da DCTFWeb usa portal, rola por dentro e mede em dvh', () => {
        const tela = readFileSync(join(RAIZ, 'components/DCTFWeb/DetalheDeclaracao.tsx'), 'utf8');
        expect(tela).toMatch(/createPortal\(/);
        expect(tela).toMatch(/document\.body/);
        expect(tela).toMatch(/fixed inset-0[^"]*items-start[^"]*overflow-y-auto/);
        // dvh conta a área REALMENTE visível; vh conta a barra de endereço junto.
        expect(tela).toMatch(/max-h-\[92dvh\]/);
        expect(tela).toMatch(/flex-1 min-h-0 overflow-y-auto/);
    });
});
