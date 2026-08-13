// ============================================================================
// MATA-BURRO: HOOK DEPOIS DE `return` DERRUBA A TELA INTEIRA.
//
// 13/08: acrescentei `const [idAnterior, setIdAnterior] = useState(...)` DEPOIS
// do `if (!isOpen) return null;` do ConfigAdminModal. Com o modal fechado o
// componente roda 7 hooks; aberto, 8. O React não tolera contagem variável e
// derruba a aplicação com o **erro #310** — tela preta, "Erro ao carregar",
// tudo fora do ar. Não foi o modal que quebrou: foi o app.
//
// ═══ POR QUE UM TESTE, E NÃO "prestar atenção" ══════════════════════════════
//
// O `npm run lint` deste projeto é `tsc --noEmit`, e o TypeScript NÃO vê regra
// de hooks — o código compila limpo. O plugin do ESLint que pegaria isso não
// está no projeto, e trocar a esteira de lint no meio de um dia de entrega é
// mudança maior que o defeito. Este teste cobre exatamente a forma do erro que
// aconteceu, que é o que a casa pede: trava é barreira FÍSICA no caminho, não
// aviso que se lê.
//
// ═══ A HEURÍSTICA, E POR QUE ELA NÃO VIRA RUÍDO ═════════════════════════════
//
// Ela usa a INDENTAÇÃO como prova de escopo: um `return` no primeiro nível do
// componente (4 espaços) seguido, MAIS ABAIXO E NO MESMO NÍVEL, de uma chamada
// de hook. Componente aninhado, callback e closure vivem indentados mais
// fundo, então não entram — e é isso que evita o falso positivo que
// desligaria o teste.
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

/** `return` de saída antecipada no primeiro nível do componente. */
const RE_RETURN_CEDO = /^ {4}if \([^)]*\)\s*return[^;]*;\s*$/;
/** Chamada de hook no primeiro nível do componente. */
const RE_HOOK = /^ {4}(?:const|let)\s+.*=\s*use[A-Z]\w*\s*[(<]|^ {4}use[A-Z]\w*\s*\(/;
/** Fim do componente — a partir daí, outro escopo. */
const RE_FIM_DE_ESCOPO = /^\};?\s*$|^const \w+.*=.*=>|^export /;

const ARQUIVOS = arquivosTsx(join(RAIZ, 'components'));

describe('MATA-BURRO: hook depois de return antecipado', () => {
    it('a varredura enxerga os componentes (se vier vazia, a trava é falsa)', () => {
        expect(ARQUIVOS.length).toBeGreaterThan(100);
        const comReturnCedo = ARQUIVOS.filter((f) =>
            readFileSync(f, 'utf8').split('\n').some((l) => RE_RETURN_CEDO.test(l)));
        expect(comReturnCedo.length).toBeGreaterThan(5);
    });

    it('nenhum hook é chamado depois de uma saída antecipada', () => {
        const infratores: string[] = [];

        for (const arquivo of ARQUIVOS) {
            const linhas = readFileSync(arquivo, 'utf8').split('\n');
            let depoisDoReturn = false;
            for (let i = 0; i < linhas.length; i++) {
                const linha = linhas[i];
                if (RE_FIM_DE_ESCOPO.test(linha)) { depoisDoReturn = false; continue; }
                if (RE_RETURN_CEDO.test(linha)) { depoisDoReturn = true; continue; }
                if (depoisDoReturn && RE_HOOK.test(linha)) {
                    infratores.push(
                        `${relative(RAIZ, arquivo).split('\\').join('/')}:${i + 1}  →  ${linha.trim().slice(0, 90)}`,
                    );
                    depoisDoReturn = false;   // um por escopo basta pra consertar
                }
            }
        }

        if (infratores.length) {
            throw new Error(
                '\n\n🚧 HOOK CHAMADO DEPOIS DE UMA SAÍDA ANTECIPADA\n\n'
                + infratores.map((i) => `  · ${i}`).join('\n')
                + '\n\nO componente passa a rodar um número DIFERENTE de hooks conforme o caminho, e o\n'
                + 'React derruba a APLICAÇÃO INTEIRA com o erro #310 ("Rendered more hooks than\n'
                + 'during the previous render") — tela preta, não só o componente.\n\n'
                + 'Mova a chamada para junto dos outros hooks, ANTES do primeiro `return`. Se ela\n'
                + 'precisa mesmo ser condicional, o condicional vai DENTRO do hook, não em volta\n'
                + 'dele.\n\n'
                + 'O tsc não pega isto (TypeScript não conhece regra de hooks) — por isso a trava\n'
                + 'é este teste.\n',
            );
        }
        expect(infratores).toEqual([]);
    });

    /** Prova que a heurística ACUSA a forma exata do defeito de 13/08. */
    it('a heurística reconhece o padrão que quebrou (prova da trava)', () => {
        const trecho = [
            'const X: React.FC = ({ isOpen }) => {',
            '    const [a, setA] = useState(false);',
            '    if (!isOpen) return null;',
            '    const [b, setB] = useState<string | null>(null);',
            '};',
        ];
        let depois = false;
        let achou = false;
        for (const l of trecho) {
            if (RE_FIM_DE_ESCOPO.test(l)) { depois = false; continue; }
            if (RE_RETURN_CEDO.test(l)) { depois = true; continue; }
            if (depois && RE_HOOK.test(l)) achou = true;
        }
        expect(achou).toBe(true);
    });

    /** E que ela NÃO acusa hook de componente aninhado (o falso positivo caro). */
    it('componente aninhado no mesmo arquivo não é falso positivo', () => {
        const trecho = [
            'const Pai: React.FC = ({ isOpen }) => {',
            '    const [a, setA] = useState(false);',
            '    if (!isOpen) return null;',
            '    return <div />;',
            '};',
            '',
            'const Filho: React.FC = () => {',
            '    const [b, setB] = useState(0);',
            '    return <span />;',
            '};',
        ];
        let depois = false;
        let achou = false;
        for (const l of trecho) {
            if (RE_FIM_DE_ESCOPO.test(l)) { depois = false; continue; }
            if (RE_RETURN_CEDO.test(l)) { depois = true; continue; }
            if (depois && RE_HOOK.test(l)) achou = true;
        }
        expect(achou).toBe(false);
    });
});
