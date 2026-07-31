export function modeloDaChave(chave: unknown): string | null;

export function trilhoAutomatico(origem: unknown, fonte?: unknown): 'cofre' | 'autxml' | null;

export interface CofreChecklistLinha {
    empresaId: string;
    cnpj: string;
    nome: string;
    regime: string;
    totalSaidas55: number;
    viaCofre: number;
    viaAutXml: number;
    viaAuto: number;
    ultimaSaidaMs: number | null;
    ultimaSaidaCofreMs: number | null;
    ultimaSaidaAutXmlMs: number | null;
    ultimaAutoMs: number | null;
    status: 'ativo' | 'parado' | 'falta-migrar' | 'sem-saida-55';
    trilho: 'cofre' | 'autxml' | 'ambos' | null;
}

export interface CofreChecklistResumo {
    totalEmpresas: number;
    comSaida55: number;
    ativos: number;
    ativosCofre: number;
    ativosAutXml: number;
    parados: number;
    faltaMigrar: number;
    semSaida55: number;
    docsSemEmpresa: number;
    docsDonoErrado: number;
    inatividadeDias: number;
}

export function analisarChecklistCofre(args: {
    empresas: Array<{ empresaId: string; cnpj: string; nome: string; regime: string }>;
    docsSaida: Array<{ empresaCnpj?: string | null; chave?: string | null; origem?: string | null; dhEmi?: string | null; capturadoPor?: { fonte?: string | null } | null }>;
    agoraMs: number;
    inatividadeDias?: number;
}): { resumo: CofreChecklistResumo; linhas: CofreChecklistLinha[] };
