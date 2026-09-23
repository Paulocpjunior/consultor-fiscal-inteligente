// ============================================================================
// 🚨 UMA REQUISIÇÃO POR CARD DERRUBA A TELA — HTTP 429 (27/08)
//
// Paulo mandou o print da Rotina do Mês com **HTTP 429** no lugar da lista.
//
// ═══ O DEFEITO FOI MEU, E A RÉGUA ESTAVA NO TOPO DO ARQUIVO QUE EU EDITEI ═══
//
// Ao ligar o "Dar fim de mês" (26/08) eu pus o bloco dentro do `map` das
// empresas, e cada card disparava o próprio `GET /fim-de-mes/situacao` no
// mount. Com ~400 clientes na carteira isso é ~400 requisições SIMULTÂNEAS
// contra um teto de 600/min (`apiLimiter`, server.js) — e, pior, **cada uma
// relia o MÊS INTEIRO de documentos**, porque a rota monta a rotina daquela
// empresa.
//
// O cabeçalho de `rotina-fiscal-routes.js` diz, desde 28/07, exatamente o que
// eu quebrei:
//
//   "Junta as quatro fontes reais numa leitura só (nada por empresa, senão
//    seriam ~400 idas ao Firestore)"
//
// ═══ O QUE FICA ═════════════════════════════════════════════════════════════
//
// Componente renderizado POR LINHA de uma lista de carteira recebe o estado por
// PROPS — quem lê é o painel, uma vez. O componente só chama o backend quando a
// PESSOA AGE (fechar, reabrir), que é um clique por vez.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');
const fonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

describe('🚨 o bloco do fim de mês não busca nada sozinho', () => {
    const src = fonte('components/FimDeMesBloco.tsx');

    // A LEITURA (`situacaoFimDeMes`) é a que multiplica por card. Os ATOS
    // (`darFimDeMes`, `reabrirCompetencia`) são um clique por vez e ficam.
    it('não importa a LEITURA por empresa', () => {
        expect(src).not.toMatch(/situacaoFimDeMes/);
    });

    it('os ATOS continuam — eles são um clique por vez', () => {
        expect(src).toMatch(/darFimDeMes/);
        expect(src).toMatch(/reabrirCompetencia/);
    });

    // Sem `useEffect` de carga não há como voltar a buscar no mount.
    it('não há carga no mount', () => {
        expect(src).not.toMatch(/useEffect/);
    });

    it('o estado chega por PROPS', () => {
        expect(src).toMatch(/fechamento\?:\s*FechamentoCompetencia/);
        expect(src).toMatch(/bloqueios:\s*BloqueioFimDeMes\[\]/);
    });
});

describe('🚨 o painel lê tudo numa requisição só', () => {
    it('o painel passa o carimbo e os bloqueios ao bloco', () => {
        const src = fonte('components/RotinaFiscalPainel.tsx');
        expect(src).toMatch(/fechamento=\{r\.fechamento/);
        expect(src).toMatch(/bloqueios=\{bloqueiosDasEtapas\(r\.etapas\)\}/);
    });

    // 🔒 UMA query para a competência inteira, nunca uma por empresa — nem no
    // painel, nem no túnel do CCI (que faz a mesma coisa para outro app).
    it.each([
        ['sefaz-backend/rotina-fiscal-routes.js', 'o painel da carteira'],
        ['sefaz-backend/cadastro-central-routes.js', 'o túnel do CCI'],
    ])('%s usa a leitura em LOTE', (rel) => {
        expect(fonte(rel)).toMatch(/lerFechamentosDaCompetencia\(/);
    });

    // A assinatura do defeito: `await lerFechamentoDaCompetencia` (singular)
    // dentro de um laço. Ela é legítima na rota de UMA empresa — o que não pode
    // é aparecer em quem responde pela carteira inteira.
    it.each([
        'sefaz-backend/rotina-fiscal-routes.js',
        'sefaz-backend/cadastro-central-routes.js',
    ])('%s não lê carimbo dentro de laço', (rel) => {
        const src = fonte(rel);
        const emLaco = src.match(
            /for\s*\([^)]*\)\s*\{[^}]*await\s+lerFechamentoDaCompetencia\(/,
        );
        expect({ rel, emLaco: emLaco?.[0] || null }).toEqual({ rel, emLaco: null });
    });
});
