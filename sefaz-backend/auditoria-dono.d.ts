// Tipos do núcleo do relatório de auditoria do dono — o dono é o .js.
export interface Trilha {
    id: string; colecao: string; rotulo: string;
    peso: 'critico' | 'alto' | 'medio'; desde: string;
    campoData: string; campoQuem: string;
}

export interface EventoAuditoria {
    id: string; trilha: string; rotulo: string; peso: string;
    em: string | null; quem: string | null; empresa: string | null; descricao: string;
}

export const DONOS_PADRAO: string[];
export const TRILHAS: Trilha[];

export function donosConfigurados(env?: Record<string, string | undefined>): string[];
export function ehDono(email: unknown, env?: Record<string, string | undefined>): boolean;
export function paraIso(v: unknown): string | null;
export function descreverEvento(trilhaId: string, d?: Record<string, unknown>): string;
export function normalizarEvento(trilha: Trilha, id: string, dados?: Record<string, unknown>): EventoAuditoria;
export function montarAuditoria(p: {
    leituras?: { trilha: Trilha; docs?: { id: string; dados: Record<string, unknown> }[]; erro?: string }[];
    de?: string | null; ate?: string | null; quemFiltro?: string | null;
}): {
    total: number; semAutor: number; semData: number;
    porPessoa: { quem: string; quantidade: number }[];
    porTrilha: { trilha: string; quantidade: number; rotulo: string }[];
    eventos: EventoAuditoria[];
    naoLidas: { trilha: string; rotulo: string; motivo: string }[];
    ressalvas: string[];
};
export function ressalvasDoPeriodo(p: { de?: string | null; naoLidas?: { rotulo: string }[]; semAutor?: number }): string[];
