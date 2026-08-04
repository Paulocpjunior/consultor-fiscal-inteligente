export type StatusAptidao =
    | 'apto-ativo' | 'apto-sem-fluxo' | 'apto-parou' | 'sem-prova' | 'sem-saida-55';

export interface LinhaAptidao {
    empresaId: string | null;
    cnpj: string;
    nome: string;
    status: StatusAptidao;
    rotulo: string;
    apto: boolean;
    trilhos: string[];
    provaChave: string | null;
    provaData: string | null;
    provaTipo: string | null;
    ultimaEntradaMs: number | null;
    diasSemReceber: number | null;
    acao: string;
}

export function provaDoDocumento(doc: unknown, cnpjEscritorio: string): 'cofre' | 'autxml' | null;

export function classificarAptidaoEmpresa(p: {
    empresa: { empresaId?: string; cnpj: string; nome?: string };
    docsDaEmpresa: unknown[];
    agoraMs: number;
    cnpjEscritorio: string;
    janelaAtivaDias?: number;
    limiteParouDias?: number;
}): LinhaAptidao;

export function montarAptidaoSaida(p: {
    empresas: Array<{ empresaId?: string; cnpj: string; nome?: string }>;
    docsSaida: unknown[];
    agoraMs: number;
    cnpjEscritorio: string;
    janelaAtivaDias?: number;
    limiteParouDias?: number;
}): {
    linhas: LinhaAptidao[];
    resumo: {
        total: number; comSaida55: number; aptos: number; ativos: number;
        aptosSemFluxo: number; aptosPararam: number; semProva: number; semSaida55: number;
    };
    ressalvas: string[];
};
