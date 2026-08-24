// ============================================================================
// ❓ Confirmação do SP Connect é DO APP — `window.confirm` não existe no Teams
// ----------------------------------------------------------------------------
// Paulo (24/08): clicou em "☎️ Pedir permissão de ligação" e **"nada
// aconteceu"**. A causa não era o botão nem a rota (as duas certas): o
// webview do Teams — onde TODO colaborador usa o Connect — SUPRIME
// `window.confirm` sem erro nenhum. A função devolve `false`, o handler
// desiste e a ação some em silêncio. O Safari faz o mesmo depois que alguém
// marca "impedir que esta página crie diálogos".
//
// Eram CINCO ações mortas por isso, e todas caras: pedir permissão de
// ligação (mensagem ao cliente), gravar o tronco/horário na Meta, excluir
// contato e — pelos DOIS `window.prompt` — registrar consentimento e
// eliminar dados do titular, que são justamente os atos de LGPD que dão
// lastro ao selo do rodapé. A régua que fica: **pergunta que decide ação
// nasce como caixa nossa**, que funciona em qualquer casca.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';

const fonte = fs.readFileSync(
    path.join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8',
);
// Comentário é PROSA — a varredura lê código (lição do reguaUnica, 22/08).
const codigo = fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('SP Connect não usa diálogo do navegador', () => {
    it('nenhum window.confirm/alert/prompt no código do Connect', () => {
        expect(codigo).not.toMatch(/window\.(confirm|alert|prompt)\s*\(/);
    });

    it('as ações que perguntam usam a caixa do app (sim/não e com campo)', () => {
        // Permissão de ligação, gravação na Meta e exclusão de contato.
        expect((codigo.match(/await pedirConfirmacao\(/g) || []).length).toBeGreaterThanOrEqual(3);
        // Consentimento e eliminação LGPD — os dois que eram window.prompt.
        expect((codigo.match(/await pedirTexto\(/g) || []).length).toBeGreaterThanOrEqual(2);
    });
});

describe('a caixa de confirmação responde de verdade', () => {
    it('a promessa só resolve pelos botões — os dois lados existem', () => {
        expect(codigo).toMatch(/new Promise<boolean>\(\(resolver\) => \{/);
        expect(codigo).toMatch(/new Promise<string \| null>\(\(resolver\) => \{/);
        expect(codigo).toMatch(/setConfirmPendente\(\{ texto, rotuloOk/);
        expect(codigo).toMatch(/responderConfirmacao\(true\)/);
        expect(codigo).toMatch(/responderConfirmacao\(false\)/);
        // Resolver SEMPRE ao fechar: promessa pendente trava o handler pra
        // sempre (o botão volta a "não fazer nada", que é o defeito de origem).
        expect(codigo).toMatch(/if \(c\) c\.resolver\(/);
        // Cancelar com CAMPO devolve null, nunca string vazia: `false` viraria
        // motivo em branco gravado num registro de LGPD.
        expect(codigo).toMatch(/c\.campo \? \(v \? confirmTexto : null\) : v/);
    });

    it('o rótulo do botão de OK vem da ação, não é "OK" genérico', () => {
        expect(codigo).toMatch(/rotuloOk/);
        expect(codigo).toMatch(/'Enviar pedido'/);
        expect(codigo).toMatch(/'Excluir contato'/);
        expect(codigo).toMatch(/'Eliminar dados'/);
    });

    it('a caixa com campo não grava em BRANCO', () => {
        expect(codigo).toMatch(/disabled=\{confirmPendente\.campo && !confirmTexto\.trim\(\)\}/);
    });
});
