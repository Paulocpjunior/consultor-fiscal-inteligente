export const ALIQ_INTERNA_PADRAO: number;

export function baseDifalPorDentro(valorOperacao: number, icmsOrigem: number, aliqInterna: number): number | null;

export function calcularArt117(p: { base: number; aliqInterna: number; icmsDestacado: number }): {
    debito: number; credito: number; diferenca: number;
};

export type CfopDoItemResolver = (nota: unknown, item: unknown) => string;

export interface DifalArt117Nota {
    chave: string;
    numero: string;
    emitente: string;
    cnpjEmitente: string;
    ufOrigem: string;
    cfops: string[];
    itens: number;
    valorOperacao: number;
    icmsDestacado: number;
    icmsDestacadoZero: boolean;
    aliqInterDerivada: boolean;
    aliqInterna: number;
    base: number;
    debito: number;
    credito: number;
    diferenca: number;
    origem: 'proposta' | 'informada' | 'nao-devido';
    informadoPor?: string | null;
    informadoEm?: string | null;
    motivo?: string | null;
}

export interface DifalArt117Informado {
    base?: number | string | null;
    aliqInterna?: number | string | null;
    icmsDestacado?: number | string | null;
    naoDevido?: boolean;
    motivo?: string | null;
    por?: string | null;
    em?: string | null;
}

export function propostaDifalDaNota(
    nota: unknown,
    p: { ufEmpresa: string; aliqInterna: number; cfopDoItem: CfopDoItemResolver },
): DifalArt117Nota | null;

export function aplicarInformado(proposta: DifalArt117Nota | null, informado?: DifalArt117Informado | null): DifalArt117Nota | null;

export interface CodigoArt117 { codigo: string; ok: boolean; erro: string | null }

export function validarCodigosArt117(p: { codigoDebito?: string; codigoCredito?: string; ufEmpresa?: string }): {
    debito: CodigoArt117; credito: CodigoArt117;
};

export interface DifalArt117Consolidado {
    porNota: DifalArt117Nota[];
    totais: {
        notas: number; naoDevidas: number; valorOperacao: number; icmsDestacado: number;
        base: number; debito: number; credito: number; diferenca: number;
    };
    codigos: { debito: CodigoArt117; credito: CodigoArt117 };
    ajustes: Array<{ codigo: string; descricao: string; valor: number; origem: 'difal-art117' }>;
    avisos: string[];
}

export function consolidarDifalArt117(p: {
    notas: unknown[];
    ufEmpresa: string;
    aliqInternaPadrao?: number;
    cfopDoItem: CfopDoItemResolver;
    informadoPorChave?: Record<string, DifalArt117Informado>;
    codigoDebito?: string;
    codigoCredito?: string;
    codigoC197?: string;
}): DifalArt117Consolidado;
