// Tipos da sonda do Instagram — o dono é o .js.
export interface CandidatoSondaInstagram {
    id: 'token' | 'paginas';
    rotulo: string;
    caminho: () => string;
    hipotese: string;
}
export const CANDIDATOS_SONDA: CandidatoSondaInstagram[];

export interface ResultadoSondaInstagram {
    situacao: 'token-ok' | 'conta-encontrada' | 'pagina-sem-instagram' | 'sem-pagina'
        | 'sem-permissao' | 'nao-reconhecido' | 'indeterminado';
    motivo: string;
    acao?: string;
    pagina?: { id: string; nome: string };
    instagram?: { id: string; username: string | null };
    bruto: unknown;
}

export function interpretarSondaInstagram(
    candidatoId: 'token' | 'paginas', status: number | null, corpo: any,
): ResultadoSondaInstagram;

export interface ConclusaoSondaInstagram {
    veredito: 'conta-encontrada' | 'pagina-sem-instagram' | 'sem-pagina' | 'sem-permissao' | 'indeterminado';
    motivo: string;
    acao?: string;
    pagina?: { id: string; nome: string };
    instagram?: { id: string; username: string | null };
}

export function concluirSondaInstagram(
    resultados?: (ResultadoSondaInstagram & { candidato: string; rotulo?: string; hipotese?: string })[],
): ConclusaoSondaInstagram;

export const SOBRE_RESTRINGIR_ATENDENTES: { titulo: string; texto: string };
