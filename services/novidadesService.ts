/**
 * novidadesService.ts — o selo "novo" do comunicado interno (📣 Novidades).
 *
 * A página `/novidades-cfi.html` existia desde 02/08, mas o ÚNICO acesso era
 * um link dentro do cabeçalho do card Relatórios — quem não abrisse Relatórios
 * nunca via o comunicado (relato do colaborador, 04/08: "não localizei o botão
 * NOVIDADES"). O botão passou para o cabeçalho do app, visível em toda tela.
 *
 * Regra de farol honesto: o pontinho só some quando o colaborador ABRE a
 * versão atual. Marcar como lido é ação dele, nunca do app — e versão nova
 * reacende o selo sozinha (o comparador é textual, não "maior que").
 */

/**
 * Data da última revisão do comunicado (o mesmo "atualizado em" impresso no
 * topo de public/novidades-cfi.html). MUDOU A PÁGINA → MUDA AQUI, no mesmo PR;
 * senão a equipe fica sem o aviso de que há coisa nova.
 *
 * 🚨 E ISSO ACONTECEU (Paulo, 15/08: *"o botão novidade do CFI você não está
 * inserindo o detalhe em vermelho que sinaliza que algo foi feito"*). A regra
 * do par estava escrita bem aqui e não tinha TRAVA: entregamos onze dias de
 * mudança — Ativar Empresa, nota digitada, farol de lastro — com o selo
 * apagado, então a equipe não tinha como saber que havia o que ler. É a mesma
 * família do guia órfão e do "0/388" repetido: par que envelhece EM SILÊNCIO.
 * Agora `__tests__/novidadesService.test.ts` compara esta constante com o
 * "atualizado em" da página e derruba o build quando as duas divergem.
 */
export const NOVIDADES_VERSAO = '2026-09-02';

export const NOVIDADES_URL = '/novidades-cfi.html';

const CHAVE_LOCAL = 'cfi_novidades_lida';

/** Há comunicado não lido? Versão vista diferente da atual (ou nunca vista). */
export function temNovidadeNaoLida(
    versaoAtual: string,
    versaoVista?: string | null,
): boolean {
    if (!versaoAtual) return false;
    return String(versaoVista || '').trim() !== versaoAtual.trim();
}

/**
 * Leitura/gravação da versão vista, com a CHAVE por parâmetro.
 *
 * Existem dois comunicados hoje — o 📣 Novidades do CFI e o ℹ️ SOBRE do SP
 * Connect — e cada um tem a própria chave. O que NÃO se duplica é a régua de
 * comparação (`temNovidadeNaoLida`): selo com duas réguas acaba divergindo, e
 * aí um dos dois some sem ninguém perceber (foi assim que o do CFI passou onze
 * dias apagado).
 */
export function versaoVistaEm(chave: string): string | null {
    try {
        return localStorage.getItem(chave);
    } catch {
        return null;
    }
}

export function marcarVistaEm(chave: string, versao: string): void {
    try {
        localStorage.setItem(chave, versao);
    } catch {
        /* navegador sem storage (aba anônima): o selo fica aceso, e tudo bem */
    }
}

/** Última versão que ESTE navegador abriu (null quando nunca abriu). */
export function versaoVistaLocal(): string | null {
    return versaoVistaEm(CHAVE_LOCAL);
}

/** Carimba a versão atual como lida. Chamado quando o colaborador ABRE a página. */
export function marcarNovidadesComoLidas(versao: string = NOVIDADES_VERSAO): void {
    marcarVistaEm(CHAVE_LOCAL, versao);
}
