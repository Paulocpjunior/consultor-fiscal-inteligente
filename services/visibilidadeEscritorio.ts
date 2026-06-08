/**
 * services/visibilidadeEscritorio.ts
 *
 * Flag temporario: "modo escritorio aberto" -- quando ligado, COLABORADORES
 * (nao-admin) veem TODAS as empresas/notas/documentos do escritorio, sem
 * passar pelo filtro de carteira.
 *
 * Uso pretendido: rodar enquanto a Carteira de Clientes ainda nao esta
 * 100% atribuida. Assim o colaborador trabalha normalmente em vez de
 * ficar com tela vazia. Ao concluir a atribuicao da carteira, basta
 * desligar a flag (remover env / setar pra 0).
 *
 * Trade-off de seguranca: enquanto ligado, colaborador A consegue ler
 * dados de carteira do colaborador B (IDOR). Issue #104 trata da solucao
 * definitiva (Firestore rules denormalizadas). Esta flag NAO altera as
 * rules -- elas ja permitem leitura ampla; a flag so destrava o filtro
 * do app. Admin continua intacto.
 *
 * Como ligar:
 *   .env / GitHub Actions secrets: VITE_VISIBILIDADE_ABERTA=1
 *   (o workflow ja passa todas VITE_* como build-args do Vite.)
 *
 * Auditoria: o uso da flag aparece num console.info no boot, pra ficar
 * claro que esta ativo. Nao logar repetidamente por chamada -- so 1x.
 */

let avisoLogado = false;

export function isModoEscritorioAberto(): boolean {
    try {
        const ativo = ((import.meta as any).env?.VITE_VISIBILIDADE_ABERTA ?? '') === '1';
        if (ativo && !avisoLogado) {
            // Aviso uma unica vez por sessao. Importante deixar visivel pro
            // dev que abre o console -- evita "ah, era a flag" no diagnostico.
            console.info(
                '[visibilidade] Modo escritorio ABERTO -- colaboradores veem TODAS as empresas. ' +
                'Desligue VITE_VISIBILIDADE_ABERTA ao concluir a atribuicao da Carteira de Clientes.'
            );
            avisoLogado = true;
        }
        return ativo;
    } catch {
        return false;
    }
}
