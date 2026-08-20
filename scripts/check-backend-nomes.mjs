#!/usr/bin/env node
// ============================================================================
// scripts/check-backend-nomes.mjs
//
// NOME USADO E NUNCA DECLARADO no backend fiscal — a trava que faltava.
//
// ═══ POR QUE EXISTE (20/08) ═════════════════════════════════════════════════
//
// Paulo, com o print: *"Erro ao gerar SPED · Falha interna — este erro é de
// hoje de manhã, tem que ser sanado"*. A causa era uma reescrita MINHA que
// apagou `const participantesMap = new Map()` do orquestrador. O arquivo
// continuava usando o nome três vezes, e a primeira empresa que gerasse SPED
// batia num ReferenceError.
//
// E NADA PEGOU, por três razões que se somam:
//   · `npm run lint` é `tsc --noEmit`, e o tsconfig do app tem allowJs:false —
//     o sefaz-backend inteiro (quem GERA IMPOSTO) não era verificado;
//   · `node --check` enxerga só sintaxe, não escopo;
//   · o jest não carrega o orquestrador (ele puxa firebase-admin).
//
// Corrigir a linha seria consertar a INSTÂNCIA. Isto aqui fecha a CLASSE.
//
// ⚠️ POR QUE SÓ TS2304/TS2552: ligar checkJs no backend legado acusa ~520
// TS2339 ("propriedade não existe") que são ruído de código dinâmico. Trava que
// nasce vermelha é trava que a equipe desliga — então o filtro é cirúrgico:
// só a classe "usou um nome que não existe", que é sempre defeito de verdade.
//
// ⚠️ E JSDoc NÃO CONTA: `@returns { statusCode, body }` faz o TS ler as chaves
// como tipo e reclamar de um nome que é só documentação. Linha de comentário é
// descartada — senão a trava nasceria com 5 falsos positivos.
// ============================================================================
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** A classe que interessa: "Cannot find name" (com e sem sugestão). */
const CLASSE = /error (TS2304|TS2552):/;

let saida = '';
try {
    execSync('npx tsc -p tsconfig.backend.json', { cwd: RAIZ, encoding: 'utf8', stdio: 'pipe' });
} catch (e) {
    // tsc sai != 0 por causa do ruído de tipo esperado — a saída é o que vale.
    saida = `${e.stdout || ''}${e.stderr || ''}`;
}

const achados = [];
for (const linha of saida.split('\n')) {
    if (!CLASSE.test(linha)) continue;
    const m = linha.match(/^(.+?)\((\d+),\d+\): error/);
    if (!m) continue;
    const [, arquivo, nLinha] = m;
    let texto = '';
    try {
        texto = readFileSync(resolve(RAIZ, arquivo), 'utf8').split('\n')[Number(nLinha) - 1] || '';
    } catch { /* arquivo sumiu entre o tsc e a leitura — mantém o achado */ }
    const ehComentario = /^\s*(\*|\/\/|\/\*)/.test(texto);
    if (ehComentario) continue;   // JSDoc não é código
    achados.push(`${linha.trim()}\n      → ${texto.trim()}`);
}

if (achados.length) {
    console.error('\n🚨 NOME USADO E NUNCA DECLARADO no backend fiscal:\n');
    for (const a of achados) console.error('  ' + a + '\n');
    console.error(
        'Isso vira "Falha interna" na primeira vez que o caminho rodar — foi o que\n'
        + 'derrubou a geração do SPED em 20/08. Declare o nome (ou corrija o import).\n',
    );
    process.exit(1);
}

console.log('✓ backend fiscal: nenhum nome usado sem declaração.');
