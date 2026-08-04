export const IDS_RETENCAO_ISS: number[];
export const IDS_JA_MAPEADOS: number[];
export const ORIGENS_ACEITAS: string[];
export const COLECAO_ATIVIDADES_CODIGOS: string;

export function validarIdAtividadeSup(
    id: unknown,
    p?: { origem?: string; idsDeclarados?: number[] },
): { ok: boolean; id?: number; erro?: string };

export interface CodigoAtividadeSup {
    idAtividade: number;
    origem: string | null;
    cnpjOrigem: string | null;
    competenciaOrigem: string | null;
    atualizadoPor: string | null;
    atualizadoEm: string;
}

export function lerCodigoAtividadeSup(db: unknown): Promise<CodigoAtividadeSup | null>;
export function gravarCodigoAtividadeSup(db: unknown, p: {
    id: number;
    origem?: string;
    cnpjOrigem?: string;
    competenciaOrigem?: string;
    usuario?: string;
}): Promise<CodigoAtividadeSup>;
