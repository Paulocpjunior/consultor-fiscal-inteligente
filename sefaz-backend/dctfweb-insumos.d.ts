export interface SeloInsumo {
    departamento: string;
    rotulo: string;
    fonte: string;
    estado: 'recebido' | 'pendente' | 'sem-movimento' | 'indeterminado';
    detalhe: string;
    quando?: string | null;
    quem?: string | null;
}

export const DEPARTAMENTO_INSUMO: Record<string, { departamento: string; rotulo: string }>;

export function seloEsocial(consulta: {
    ok?: boolean; entregue?: boolean; situacao?: string; dataEntrega?: string | null; erro?: string;
} | null | undefined): SeloInsumo;

export function seloMit(situacao: {
    ok?: boolean; situacao?: number | string; descricao?: string | null; erro?: string;
} | null | undefined): SeloInsumo;

export function seloReinf(p?: {
    lotesGateway?: Array<{ protocolo?: string | null; por?: string | null; em?: string | null }>;
    retencoesApuradas?: { totalNotasComRetencao: number; semCamposGravados: number } | null;
}): SeloInsumo;

export function vereditoInsumos(
    selos: Array<Pick<SeloInsumo, 'estado' | 'rotulo'> & { departamento?: string }>,
    opts?: { ignorarDepartamentos?: string[] },
): {
    veredito: 'pronto' | 'incompleto' | 'incerto';
    frase: string;
};

export function contarRetencoesTomadas(
    docs: unknown[],
    competencia?: string,
): { totalNotasComRetencao: number; semCamposGravados: number };
