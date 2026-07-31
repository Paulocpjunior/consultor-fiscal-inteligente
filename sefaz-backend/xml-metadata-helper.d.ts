export interface XmlParticipantesNfe {
    emitente: { cnpj: string | null; nome: string | null };
    destinatario: { cnpj: string | null; nome: string | null };
}

export function competenciaFromDhEmi(value: unknown): string | null;
export function extrairParticipantesNfe(xml: string): XmlParticipantesNfe;

export function direcaoEfetivaDoc(
    d: { direcao?: string | null; tpNF?: string | number | null } | null | undefined,
): string | undefined;
