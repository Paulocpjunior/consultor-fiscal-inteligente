/**
 * services/visibilidadeEscritorio.ts
 *
 * Flag temporario: "modo escritorio aberto" -- quando ligado, COLABORADORES
 * (nao-admin) veem TODAS as empresas/notas/documentos do escritorio, sem
 * passar pelo filtro de carteira.
 *
 * IMPORTANTE: O acesso a `import.meta.env.VITE_VISIBILIDADE_ABERTA` precisa
 * ser DIRETO -- Vite substitui essa expressao por uma string literal no
 * build (replace estatico via AST). Nao usar optional chain nem cast, senao
 * a substituicao NAO acontece e a flag fica sempre "undefined" em prod.
 *
 * Como ligar: Repository Variable `VITE_VISIBILIDADE_ABERTA=1` no GitHub
 * Actions. Workflow ja passa via --build-arg pro Docker, que repassa pro
 * Vite via ENV. Pra desligar: apaga a variable e rebuild.
 */

const FLAG_RAW = import.meta.env.VITE_VISIBILIDADE_ABERTA;

// Diagnostico de boot: imprime UMA vez o que Vite gravou. Crucial pra
// distinguir "flag desligada" de "variavel nao chegou no build".
//   undefined  -> Variable nao foi passada pelo Docker/Workflow (config)
//   ""         -> Variable existe mas vazia
//   "1"        -> Ligada
//   outra      -> Setada com valor invalido
console.info('[visibilidade] VITE_VISIBILIDADE_ABERTA =', JSON.stringify(FLAG_RAW));

let avisoLogado = false;

export function isModoEscritorioAberto(): boolean {
    const ativo = FLAG_RAW === '1';
    if (ativo && !avisoLogado) {
        console.info(
            '[visibilidade] Modo escritorio ABERTO -- colaboradores veem TODAS as empresas. ' +
            'Desligue VITE_VISIBILIDADE_ABERTA ao concluir a atribuicao da Carteira de Clientes.'
        );
        avisoLogado = true;
    }
    return ativo;
}

/** Expoe o valor cru pra debug -- o que Vite gravou no bundle. */
export function debugRawValue(): unknown {
    return FLAG_RAW;
}
