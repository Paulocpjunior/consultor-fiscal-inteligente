export const NATUREZA_DA_RAIZ: Readonly<Record<number, 'D' | 'C'>>;
export const COD_NAT_DA_RAIZ: Readonly<Record<number, 1 | 2 | 4 | 5>>;
export const MESES_PT: Readonly<Record<string, number>>;

export interface ContaPgcc {
    codigo: string;
    cCta: string;
    nome: string;
    indCta: 'A' | 'S';
    natCta: 'C' | 'D' | 'V';
    reduzido: string | null;
    cCtaRef: string | null;
    codTrib: string | null;
    iniVig: string | null;
    fimVig: string | null;
    cCtaSup: string | null;
    nivelCta: number;
    codNat: 1 | 2 | 3 | 4 | 5 | null;
    raiz: string;
}

export interface ContaForaDoPgcc {
    cCta: string;
    codigo: string;
    nome: string;
    indCta: 'A' | 'S';
    motivo: 'compensacao' | 'apuracao-do-resultado' | 'raiz-sem-codnat';
}

export interface ResumoPlano {
    total: number;
    analiticas: number;
    sinteticas: number;
    foraDoPgcc: number;
    compensacao: number;
    apuracao: number;
    nivelMaximo: number;
    comCtaRef: number;
    analiticasComCodTrib: number;
    comIniVig: number;
    porCodNat: Record<string, number>;
    nomesCortados: number;
}

export interface PlanoLido {
    ok: boolean;
    contas: ContaPgcc[];
    foraDoPgcc: ContaForaDoPgcc[];
    pendencias: string[];
    avisos: string[];
    resumo: ResumoPlano | null;
    colunas: Record<string, number> | null;
}

export interface LinhaBalancete {
    codigo: string;
    cCta: string;
    nome: string;
    saldoInicial: number;
    debitos: number;
    creditos: number;
    saldoFinal: number;
    saldoInicialNatureza?: 'D' | 'C';
    saldoFinalNatureza?: 'D' | 'C';
}

export interface BalanceteLido {
    ok: boolean;
    competencia: string | null;
    linhas: LinhaBalancete[];
    pendencias: string[];
    avisos: string[];
    resumo: { linhas: number; competenciaDoTitulo: string | null } | null;
    colunas: Record<string, number> | null;
}

export function cCtaDe(codigo: unknown): string | null;
export function lerNumeroCelula(v: unknown): { valor: number | null; natureza: 'D' | 'C' | null };
export function competenciaDoTitulo(linhas: unknown[][], ateLinha: number): string | null;
export function lerPlanoDeContas(linhas: unknown[][]): PlanoLido;
export function lerBalancete(linhas: unknown[][]): BalanceteLido;
export function natSaldoPelaRaiz(cCta: string, valor: number, naturezaExplicita?: 'D' | 'C' | null): { nat: 'D' | 'C' | null; valor: number; raiz: 'D' | 'C' | null };
export function conferirAritmeticaDaLinha(linha: LinhaBalancete): { ok: boolean; esperado?: number; motivo: string | null };
