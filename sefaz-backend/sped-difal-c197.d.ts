export const CFOPS_DIFAL_AQUISICAO: Set<string>;

export function notaGeraDifalAquisicao(nota: unknown, ufEmpresa?: string): boolean;

export function aliqInterestadual(
    item: unknown,
    ufOrigem?: string,
): { aliq: number; derivada: boolean };

export interface DifalDaNota {
    base: number;
    difal: number;
    itens: number;
    aliqInterna: number;
    aliqInterDerivada: boolean;
    aliqInterMedia: number;
}

export function calcularDifalDaNota(
    nota: unknown,
    p: { aliqInterna: number; ufEmpresa?: string },
): DifalDaNota;

export function montarC197Difal(p: {
    notas: unknown[];
    ufEmpresa?: string;
    aliqInternaPadrao?: number;
    aliqInternaPorChave?: Record<string, number>;
    codigoAjuste?: string;
    codObservacao?: string;
}): {
    porNota: Array<DifalDaNota & { chave: string; numero: string }>;
    linhasPorChave: Record<string, string[]>;
    avisos: string[];
    totalDifal: number;
};

// 03/09 (auditoria): exportações que o .js já entregava e o .d.ts não declarava —
// importador TypeScript não enxergava o símbolo (erro de compilação).
export function montarRegistro0460(...args: any[]): any;
export const TXT_OBS_DIFAL: string;
