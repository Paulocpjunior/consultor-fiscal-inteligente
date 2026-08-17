/**
 * De quem é cada débito do DARF da DCTFWeb — o `.d.ts` entra no MESMO PR que o
 * módulo. Enviar guia de departamento errado dobra a cobrança no cliente.
 */
export type DepartamentoDarf = 'fiscal' | 'dp-folha' | 'contabil' | 'nao-classificado';

export const DEPARTAMENTOS_DARF: Record<DepartamentoDarf, { rotulo: string; origem: string }>;

export function departamentoPelaDescricao(descricao: unknown): DepartamentoDarf | null;

export function classificarDebitoDarf(debito: {
    codReceita?: string; codigo?: string; descricao?: string; valor?: number;
}): {
    departamento: DepartamentoDarf;
    motivo: string;
    fonte: string | null;
    confianca: string | null;
};

export interface GrupoDarf {
    departamento: DepartamentoDarf;
    rotulo: string;
    origem: string;
    total: number;
    linhas: Array<{
        codigo: string; descricao: string; valor: number;
        motivo: string; fonte: string | null;
    }>;
}

export interface SeparacaoDarf {
    grupos: GrupoDarf[];
    total: number;
    departamentos: DepartamentoDarf[];
    naoClassificados: GrupoDarf['linhas'];
    /** TRUE com mais de um departamento OU com débito de origem desconhecida. */
    misturado: boolean;
}

export function separarDarfPorDepartamento(debitos?: unknown[]): SeparacaoDarf;

export function avisoDeMistura(separacao: SeparacaoDarf | null | undefined):
    { titulo: string; texto: string; acao: string } | null;
