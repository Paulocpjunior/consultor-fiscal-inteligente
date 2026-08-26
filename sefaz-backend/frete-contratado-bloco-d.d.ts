// Tipos do dono da decisão do bloco D (frete contratado) — ver o `.js` ao lado.
//
// ⚠️ `.d.ts` À MÃO É A ARMADILHA DAS DUAS FORMAS COM OUTRA ROUPA (20/08): o
// tipo e a implementação são duas declarações do MESMO fato, e divergem em
// silêncio. Campo novo no `.js` entra AQUI no mesmo PR.

export const INDICADORES_NATUREZA_FRETE: Readonly<Record<string, string>>;
export const INDICADORES_TIPO_FRETE: Readonly<Record<string, string>>;
export const CST_FRETE_COM_CREDITO: string;
export const CST_FRETE_SEM_CREDITO: string;

export function regimeAdmiteBlocoD(regimeApuracao: unknown): boolean;

export interface CadastroFreteContratado {
    indNatFrete: string;
    indFrt: string;
    natBcCred: string;
}
export function cadastroDoFreteContratado(dadosFiscais: unknown): CadastroFreteContratado;

export interface DecisaoFreteBlocoD {
    entra: boolean;
    motivo: string;
    indNatFrete?: string;
    indFrt?: string;
    cst?: string;
    natBcCred?: string;
    comCredito?: boolean;
}
export function decidirFreteNoBlocoD(params: {
    direcao?: string;
    regimeApuracao?: unknown;
    cadastro?: CadastroFreteContratado | null;
}): DecisaoFreteBlocoD;

export function avisosDoBlocoD(porMotivo: Record<string, string[]> | null | undefined): string[];
