// Tipos de `competencia-acervo.js` — a metade que faltou em 03/09: a nota JÁ
// GRAVADA no mês errado. Ver o cabeçalho do `.js` para o porquê de cada regra.
export type SituacaoCompetenciaAcervo =
    | 'fora-do-escopo'
    | 'sem-fato-gerador'
    | 'ilegivel'
    | 'ja-corrigida'
    | 'confere'
    | 'mes-errado';

export interface ClassificacaoCompetenciaAcervo {
    situacao: SituacaoCompetenciaAcervo;
    precisaCorrigir: boolean;
    competenciaGravada?: string | null;
    competenciaCerta?: string;
    motivo?: string;
    /** O que muda nos DOIS meses — dito ANTES do clique. */
    consequencia?: string;
    corrigidaPor?: string | null;
    corrigidaEm?: string | null;
}

export interface NotaNaFilaCompetencia extends ClassificacaoCompetenciaAcervo {
    id: string | null;
    numero: string | null;
    prestador: string | null;
    valor: number | null;
}

export interface FilaCompetencia {
    paraCorrigir: NotaNaFilaCompetencia[];
    contagem: {
        examinadas: number;
        conferem: number;
        semFatoGerador: number;
        ilegiveis: number;
        jaCorrigidas: number;
        foraDoEscopo: number;
    };
    resumo: string;
}

export function classificarCompetenciaDoAcervo(doc: unknown): ClassificacaoCompetenciaAcervo;
export function montarFilaCompetencia(documentos: unknown[]): FilaCompetencia;
export function patchCorrecaoCompetencia(args: {
    doc: unknown;
    porEmail?: string;
    motivo?: string;
    agoraIso?: string;
}): { ok: false; erro: string } | {
    ok: true;
    de: string | null;
    para: string;
    patch: {
        competencia: string;
        competenciaOrigem: 'fato-gerador';
        competenciaCorrigida: {
            de: string | null; para: string; porEmail: string; motivo: string; em: string;
        };
    };
};
