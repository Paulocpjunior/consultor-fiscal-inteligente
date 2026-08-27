// Tipos de `cadastro-central-fechamentos.js` — fase 5 do túnel.
//
// ⚠️ `.d.ts` à mão é a armadilha das duas formas com outra roupa (20/08).
// Export novo no `.js` entra aqui no MESMO PR.

/** A frase que atravessa em toda linha entregue — ela PROÍBE recalcular. */
export const RESSALVA_NAO_RECALCULAR: string;

export interface LinhaDoFechamento {
    empresaId: string | null;
    cnpj: string | null;
    nome: string | null;
    competencia: string | null;
    estado: 'fechada' | 'reaberta' | 'aberta';
    /** Só `true` em 'fechada'. Aberta e reaberta NÃO entregam valor. */
    podeImportar: boolean;
    versao: number | null;
    /** Só na reaberta: a versão que o Contábil pode ter importado. */
    versaoQueVoceTalvezTenha?: number | null;
    motivo?: string;
    fechadoEm: string | null;
    fechadoPor: string | null;
    /** RESULTADO, nunca insumo. Ausência é `null`, nunca 0. */
    apurado: Record<string, number | null> | null;
    /** 'ficha-lucro' | 'simples' | 'simples-detalhado' — de onde veio o apurado. */
    apuradoFonte?: string | null;
    /** Ressalva do Simples: o valor do DAS não vive na ficha. */
    apuradoRessalva?: string | null;
    lastro: { situacao: string | null; cor: string | null; mensagem: string | null } | null;
    corte: {
        instante: string | null;
        ultNSU: number | null;
        maxNSU: number | null;
        documentos: number | null;
    } | null;
    ressalva?: string;
    reaberturas?: number;
}

export function linhaDoFechamento(p: {
    empresa: { id?: unknown; cnpj?: unknown; nome?: unknown } | null;
    competencia: string;
    fechamento: unknown;
}): LinhaDoFechamento;

export function resumirFechamentos(linhas: LinhaDoFechamento[] | null | undefined): {
    total: number;
    importaveis: number;
    abertas: number;
    reabertas: number;
    /** Fechado e SEM documento por trás — importável, e merece olho humano. */
    semLastro: number;
};
