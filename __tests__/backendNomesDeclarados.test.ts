// ============================================================================
// 🚨 A TRAVA DA TRAVA — o gate do deploy TEM que rodar o check de nomes.
//
// Paulo, 20/08, com o print: *"Erro ao gerar SPED · Falha interna — este erro é
// de hoje de manhã, tem que ser sanado"*. Uma reescrita minha apagou
// `const participantesMap = new Map()` do orquestrador; o nome continuou sendo
// usado três vezes e a primeira geração de SPED morreu em ReferenceError.
//
// Nada pegou porque `npm run lint` é só `tsc --noEmit` e o tsconfig do app tem
// `allowJs: false` — o sefaz-backend inteiro, que é quem GERA IMPOSTO, não
// passava por verificação nenhuma. `node --check` vê sintaxe, não escopo, e o
// jest não carrega o orquestrador (ele puxa firebase-admin).
//
// Corrigir a linha fecha a instância. Estes testes fecham a CLASSE.
// ============================================================================
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const raiz = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8');

describe('nome não declarado no backend fiscal não passa pelo gate', () => {
    it('o script existe e o tsconfig do backend liga o checkJs', () => {
        expect(existsSync(join(raiz, 'scripts/check-backend-nomes.mjs'))).toBe(true);
        const cfg = JSON.parse(ler('tsconfig.backend.json'));
        expect(cfg.compilerOptions.allowJs).toBe(true);
        expect(cfg.compilerOptions.checkJs).toBe(true);
        expect(cfg.include).toContain('sefaz-backend/**/*.js');
    });

    it('🚨 o `lint` do package.json CHAMA o script — senão o gate não roda', () => {
        // É este comando que o passo "Typecheck + testes" do deploy executa.
        const pkg = JSON.parse(ler('package.json'));
        expect(pkg.scripts.lint).toMatch(/check-backend-nomes\.mjs/);
    });

    it('só a classe "nome não existe" é travada — 520 erros de tipo legado seriam trava desligada', () => {
        const script = ler('scripts/check-backend-nomes.mjs');
        expect(script).toMatch(/TS2304\|TS2552/);
        // E JSDoc não conta: `@returns { statusCode }` vira "nome" para o TS.
        expect(script).toMatch(/ehComentario/);
    });
});
