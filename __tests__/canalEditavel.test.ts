// ============================================================================
// ✏️ CADASTRO SEM COMO CORRIGIR É BECO
//
// 26/08, primeiro uso real do cadastro de 2º número: o Paulo cadastrou o
// 3155-1554 e o número de exibição saiu com **um dígito a mais**
// (`5511311551554`, 13 dígitos, onde o certo tem 12). O painel tinha só
// "➕ Novo número" — nenhum jeito de corrigir.
//
// 🚨 E a saída que existia era pior que nenhuma: redigitar TUDO com o MESMO
// `id` do canal (a gravação é `doc(id).set()`, sobrescreve) — só que o painel
// **não mostrava o `id` do canal**, só o `phoneNumberId`. Ou seja: o caminho
// de volta dependia de a pessoa lembrar algo que a tela escondia.
//
// É a família do ✕ "tirar do FUNRURAL" (14/08): **botão que grava nasce com o
// caminho de volta**, e o de volta precisa ser ACHÁVEL.
//
// 🚨 E A ARMADILHA DE DENTRO: `set()` é SEM MERGE. Editar com o formulário
// pela metade APAGARIA o `envToken`, e o número pararia de receber mensagem
// em silêncio — a armadilha do `setDoc` sem merge de 21/08, do lado da tela.
// Por isso o ✏️ carrega TODOS os campos, e a tela DIZ que sobrescreve.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const tela = readFileSync(join(process.cwd(), 'components/SpConnect/index.tsx'), 'utf8');

describe('✏️ o canal cadastrado tem como ser corrigido', () => {
    it('existe um ✏️ editar na linha do canal', () => {
        expect(tela).toMatch(/✏️ editar/);
        expect(tela).toMatch(/editarCanal/);
    });

    it('🚨 e o `id` do CANAL aparece na tela — é ele que a correção precisa', () => {
        // Sem isto o caminho de volta existe e ninguém acha: a linha mostrava
        // só o phoneNumberId, que é outro número.
        const linha = tela.slice(tela.indexOf('número não informado'), tela.indexOf('número não informado') + 400);
        expect(linha).toMatch(/canal/);
        expect(linha).toMatch(/\{c\.id\}/);
    });

    it('🚨 o ✏️ carrega TODOS os campos — `set()` é sem merge', () => {
        // Campo que não vier preenchido é campo APAGADO na gravação. O
        // envToken é o mais caro: sem ele o número para de receber, calado.
        const fn = tela.slice(tela.indexOf('const editarCanal'), tela.indexOf('const cancelarEdicaoCanal'));
        for (const campo of ['id:', 'rotulo:', 'phoneNumberId:', 'envToken:', 'numeroExibicao:', 'wabaId:']) {
            expect(fn).toContain(campo);
        }
    });

    it('a tela DIZ que vai sobrescrever, e o botão muda de nome', () => {
        // "Cadastrar número" enquanto se edita faria parecer que cria um
        // segundo canal — e o backend recusaria com 409, deixando a pessoa
        // sem entender o que fez de errado.
        expect(tela).toMatch(/Salvar alterações/);
        expect(tela).toMatch(/SOBRESCREVE este canal/);
    });

    it('e dá para DESISTIR da edição sem gravar', () => {
        // Trava sem caminho de volta é trava que a equipe contorna — aqui o
        // contorno seria recarregar a página no meio de um cadastro.
        expect(tela).toMatch(/cancelarEdicaoCanal/);
        expect(tela).toMatch(/Cancelar/);
    });

    it('⚠️ e o canal PADRÃO (o do Cloud Run) não ganha ✏️ nem id de canal', () => {
        // Ele não mora no banco: vem do ENV. Oferecer editar ali seria botão
        // que não faz nada — e o backend recusa `id === principal` de
        // propósito ("é o canal do ENV e não se cadastra aqui").
        expect(tela).toMatch(/c\.origem !== 'env' && \(\s*<button onClick=\{\(\) => editarCanal/);
    });
});
