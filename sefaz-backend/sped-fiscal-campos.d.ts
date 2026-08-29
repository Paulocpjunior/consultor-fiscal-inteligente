// Tipos do núcleo da contagem de campos do EFD ICMS/IPI.
// ⚠️ Função nova no `.js` entra AQUI no mesmo PR: `.d.ts` atrás do `.js` faz
// quem importa silenciar o `tsc`, e aí o módulo volta a ser `any`.
export interface ContagemFiscal {
    campos: number;
    fonte: string;
}

export interface ErroContagemFiscal {
    registro: string;
    linha: number;
    esperado: number;
    recebido: number;
    fonte: string;
    mensagem: string;
}

export const CAMPOS_POR_REGISTRO_FISCAL: Record<string, ContagemFiscal | undefined>;
export const CAMPOS_PROVADOS_POR_RECIBO_FISCAL: Record<string, ContagemFiscal>;
/** Lido campo a campo do MESMO Guia, onde a extração mecânica não fechou. */
export const CAMPOS_LIDOS_A_MAO_NO_GUIA_FISCAL: Record<string, ContagemFiscal>;
/** Registros cuja leitura do Guia ficou incompleta — a trava é MUDA neles. */
export const REGISTROS_SEM_CONTAGEM_FISCAL: readonly string[];

export function conferirContagemDeCamposFiscal(linhas: string[] | null | undefined): {
    erros: ErroContagemFiscal[];
    /** Registro emitido que a tabela não cobre — silêncio NÃO é aprovação. */
    naoConferidos: string[];
    ok: boolean;
};

export function avisosDeContagemDeCamposFiscal(linhas: string[] | null | undefined): string[];
