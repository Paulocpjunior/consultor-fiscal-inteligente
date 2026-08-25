// Tipos da IA de triagem (o .js é o dono; este arquivo acompanha no MESMO PR
// — a regra de 20/08: `.d.ts` à mão e implementação são duas declarações do
// mesmo fato, e divergem em silêncio se andarem separadas).
import type { ConfigAtendimento } from './whatsapp-atendimento';

export const CONFIANCA_MINIMA_TRIAGEM: number;

export interface FilaDaTriagem { fila: string; rotulo: string }

export interface LeituraDaTriagem {
    /** `null` quando o modelo devolveu uma fila que NÃO existe no menu. */
    fila: string | null;
    confianca: number;
    motivo: string;
    /** O que ele tentou devolver, quando `fila` é null — para sair nomeado. */
    invalida?: string;
}

export type SituacaoTriagem =
    | 'classificada' | 'sem-certeza' | 'nao-entendi'
    | 'fila-inexistente' | 'ia-indisponivel';

export interface DestinoDaTriagem {
    fila: string | null;
    rotulo?: string;
    situacao: SituacaoTriagem;
    confianca?: number;
    motivo?: string | null;
    detalhe?: string | null;
    /** Em 'sem-certeza': o que ela teria escolhido se a confiança bastasse. */
    sugeria?: string;
}

export function filasParaTriagem(config: ConfigAtendimento): FilaDaTriagem[];
export function valeClassificar(texto: string | null | undefined): boolean;
export function montarPromptTriagem(p: { texto: string; filas: FilaDaTriagem[] }): string;
export function interpretarRespostaTriagem(
    bruto: string | null | undefined, filas: FilaDaTriagem[],
): LeituraDaTriagem | null;
export function decidirDestinoDaTriagem(p: {
    resultado: LeituraDaTriagem | null;
    filas: FilaDaTriagem[];
    minimo?: number;
    erro?: unknown;
}): DestinoDaTriagem;
