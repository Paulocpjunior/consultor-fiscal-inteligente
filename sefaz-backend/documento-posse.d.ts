/**
 * De quem é o documento — e quando tirar de quem está com ele é conserto e
 * quando é roubo. O `.d.ts` entra no mesmo PR que o módulo.
 */

/** CNPJ/CPF das partes (emitente e destinatário), nas DUAS formas do documento. */
export function partesDoDocumento(doc: any): string[];

/** O CNPJ/CPF é uma das partes do documento? */
export function ehParteDoDocumento(doc: any, cnpj: unknown): boolean;

export type SituacaoPosse =
    /** A captura não veio em nome de empresa nenhuma. */
    | 'sem-pretendente'
    /** Já é desta empresa. */
    | 'mesmo-dono'
    /** Sem `empresaId` — invisível em qualquer filtro por cliente (caso GUARANI). */
    | 'sem-dono'
    /** Tem dono, mas o CNPJ dele não está gravado: não se afirma erro sem prova. */
    | 'posse-indeterminada'
    /** 🚨 As DUAS empresas são partes: saída de uma, entrada da outra. */
    | 'contraparte-legitima'
    /** O dono é parte do documento (o pretendente, não). */
    | 'dono-e-parte'
    /** O dono não é emitente nem destinatário — posse errada de verdade. */
    | 'dono-nao-e-parte';

export function decidirPosseDocumento(p: {
    existente: { empresaId?: string | null; empresaCnpj?: string | null; empresaNome?: string | null } | null | undefined;
    pretendente: { empresaId?: string | null; empresaCnpj?: string | null } | null | undefined;
    /** O documento (default: o próprio `existente`). */
    documento?: any;
}): {
    situacao: SituacaoPosse;
    /** Só `sem-dono` e `dono-nao-e-parte` autorizam trocar a dona. */
    reatribuir: boolean;
    motivo: string;
};
