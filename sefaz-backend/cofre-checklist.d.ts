export function modeloDaChave(chave: unknown): string | null;

export interface CofreChecklistLinha {
    empresaId: string;
    cnpj: string;
    nome: string;
    regime: string;
    totalSaidas55: number;
    viaCofre: number;
    ultimaSaidaMs: number | null;
    ultimaSaidaCofreMs: number | null;
    status: 'cofre-ativo' | 'cofre-parado' | 'falta-migrar' | 'sem-saida-55';
}

export interface CofreChecklistResumo {
    totalEmpresas: number;
    comSaida55: number;
    cofreAtivo: number;
    cofreParado: number;
    faltaMigrar: number;
    semSaida55: number;
    docsSemEmpresa: number;
    inatividadeDias: number;
}

export function analisarChecklistCofre(args: {
    empresas: Array<{ empresaId: string; cnpj: string; nome: string; regime: string }>;
    docsSaida: Array<{ empresaCnpj?: string | null; chave?: string | null; origem?: string | null; dhEmi?: string | null }>;
    agoraMs: number;
    inatividadeDias?: number;
}): { resumo: CofreChecklistResumo; linhas: CofreChecklistLinha[] };
