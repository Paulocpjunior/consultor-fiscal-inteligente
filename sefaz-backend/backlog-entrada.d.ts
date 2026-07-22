export interface DocEntradaBacklog {
    empresaCnpj?: string | null;
    empresaId?: string | null;
    schema?: string | null;
    tipoDoc?: string | null;
    eventos?: Array<{ tipo?: string }> | null;
    dhEmi?: string | null;
}

export function docEhResumo(doc: DocEntradaBacklog | null | undefined): boolean;
export function docTemManifestacao(doc: DocEntradaBacklog | null | undefined): boolean;
export function classificarDocEntrada(
    doc: DocEntradaBacklog | null | undefined,
    agoraMs: number,
): 'completa' | 'resumo_manifestado' | 'resumo_pendente' | 'resumo_fora_prazo';

export interface BacklogEntradaLinha {
    empresaId: string;
    cnpj: string;
    nome: string;
    regime: string;
    totalEntradas: number;
    completas: number;
    resumosManifestados: number;
    resumosPendentes: number;
    resumosForaPrazo: number;
    ultimaSyncMs: number | null;
    cStatUltimaSync: string | null;
    pendenciaNSU: number;
    nsuTravado: string | null;
    travada: boolean;
    status: 'ok' | 'sem-captura' | 'aguardando-completa' | 'pendente-ciencia' | 'travada';
    pctCompleta: number | null;
}

export interface BacklogEntradaResumo {
    totalEmpresas: number;
    comEntradas: number;
    travadas: number;
    pendentesCiencia: number;
    aguardandoCompleta: number;
    semCaptura: number;
    ok: number;
    totalDocs: number;
    totalCompletas: number;
    totalResumosPendentes: number;
    totalResumosManifestados: number;
    totalResumosForaPrazo: number;
    docsSemEmpresa: number;
}

export function analisarBacklogEntrada(args: {
    empresas: Array<{ empresaId: string; cnpj: string; nome: string; regime: string }>;
    docs: DocEntradaBacklog[];
    states: Record<string, {
        ultimaSyncMs?: number | null;
        cStatUltimaSync?: string | null;
        pendenciaNSU?: number;
        nsuTravado?: string | null;
    }>;
    agoraMs: number;
}): { resumo: BacklogEntradaResumo; linhas: BacklogEntradaLinha[] };
