/**
 * Consulta de prazo municipal — proposta COM FONTE, nunca escrita direta.
 * O `.d.ts` entra no mesmo PR que o módulo.
 */
export function ehFonteOficial(url: string): boolean;

export function montarPromptPrazoMunicipal(p: {
    municipioNome?: string | null;
    uf?: string | null;
    codMunIBGE: string;
    obrigacao?: string;
}): string;

export function interpretarPropostaPrazo(p: {
    texto: string;
    /** groundingChunks já normalizados. VAZIO ⇒ a proposta é RECUSADA. */
    fontes?: Array<{ uri: string; title?: string }>;
    cadastroAtual?: { diaVencimento?: number; mesesApos?: number } | null;
}): {
    ok: boolean;
    motivo?: string;
    proposta?: { diaVencimento: number; mesesApos: number; baseLegal: string; observacao: string | null };
    fontes: Array<{ uri: string; title: string; oficial: boolean }>;
    diferenca?: { mudou: boolean; campos: string[]; acao: string } | null;
    avisos: string[];
};
