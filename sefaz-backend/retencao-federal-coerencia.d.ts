/**
 * Tipos mínimos para o frontend importar a assinatura de alíquota das
 * retenções federais (PIS 0,65 · COFINS 3 · CSLL 1 · CSRF 4,65).
 */

export const ALIQ_CSRF: number;

export function aliquotaEfetiva(valor: unknown, base: unknown): number | null;

export interface CoerenciaRetencao {
    situacao:
        | 'sem-base'
        | 'sem-retencao'
        | 'csll-e-o-total'
        | 'campos-sao-totais-da-operacao'
        // O documento DECLARA que não houve retenção: campos de PIS/COFINS com
        // a assinatura da OPERAÇÃO e o campo de contribuições RETIDAS presente
        // e ZERO ("PIS/COFINS/CSLL Não Retidos" na NFS-e paulistana).
        | 'sem-retencao-declarada'
        | 'aliquota-fora'
        | 'coerente';
    motivo: string;
    acao: string | null;
    aliquotas: { pis: number | null; cofins: number | null; csll: number | null };
    exigeAcao: boolean;
}

export function conferirRetencaoFederal(n: {
    base?: unknown; pis?: unknown; cofins?: unknown; csll?: unknown; ir?: unknown; inss?: unknown;
    /** PRESENÇA do campo de contribuições retidas — `?? 0` do chamador colapsa
     *  ausência em zero, e é essa diferença que decide "o documento diz que não
     *  houve" × "o documento não trouxe o campo". */
    csllPresente?: boolean;
}): CoerenciaRetencao;

// `any` de propósito: os consumidores existentes acessam o resumo livremente.
export function varrerRetencaoFederal(notas: unknown[]): any;
