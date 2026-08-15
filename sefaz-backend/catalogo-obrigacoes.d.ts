export type RegimeCatalogo = 'SIMPLES' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | 'INDEFINIDO';

export type Esfera = 'federal' | 'estadual' | 'municipal';

export interface ObrigacaoCatalogo {
    obrigacao: string;
    /** Quem define o prazo — e portanto onde se confere. */
    esfera: Esfera;
    /** Até onde a entrada vale: 'BR', 'UF:SP', 'IBGE:3550308'. */
    abrangencia: string;
    label: string;
    nome: string;
    frequencia: 'mensal' | 'trimestral' | 'anual';
    diaVencimento: number;
    mesesApos: number;
    ultimoDiaUtilDoMes?: boolean;
    /** Direção do ajuste quando cai em dia não útil — a errada custa multa. */
    ajusteDiaNaoUtil: 'prorroga' | 'antecipa';
    baseLegal: string;
    status: 'ativa' | 'proposta';
    /** Preenchido quando status='proposta': a condição que o app não avalia. */
    dependeDe?: string;
    /** Prazo/ajuste ainda não conferido com o Paulo/Alexandre. */
    revisar?: boolean;
}

export interface AlertaMes {
    tipo: 'regime-indefinido' | 'obrigacoes-a-confirmar';
    texto: string;
    acao: string;
}

export interface MesDoCliente {
    regime: RegimeCatalogo;
    regimeLabel: string;
    competencia: string;
    obrigacoes: Array<ObrigacaoCatalogo & { vencimento: Date }>;
    propostas: ObrigacaoCatalogo[];
    alertas: AlertaMes[];
    /** true ⇒ o catálogo não cobre o cliente; a etapa 4 não pode dar verde. */
    coberturaIncompleta: boolean;
}

export interface PendenciaConfirmacao {
    obrigacao: string;
    label: string;
    esfera: Esfera;
    abrangencia: string;
    status: 'ativa' | 'proposta';
    ajusteDiaNaoUtil: 'prorroga' | 'antecipa';
    baseLegal: string;
    dependeDe: string | null;
    oQueFalta: string;
    regimes: string[];
}

export const REGIMES: RegimeCatalogo[];
export const REGIME_LABEL: Record<RegimeCatalogo, string>;
export const CATALOGO: Record<RegimeCatalogo, ObrigacaoCatalogo[]>;

export function resolverRegime(
    empresa: { colecao?: string; regimePadrao?: string } | null | undefined,
): { regime: RegimeCatalogo; motivo: string | null };

/** Valida MM/AAAA na porta e devolve a própria competência. Lança se inválida. */
export function assertCompetencia(competencia: string): string;

export function competenciaFechaTrimestre(competencia: string): boolean;
export function competenciaFechaAno(competencia: string): boolean;

export function calcularVencimento(
    competencia: string,
    regra: Pick<ObrigacaoCatalogo, 'diaVencimento' | 'mesesApos'> &
        Partial<Pick<ObrigacaoCatalogo, 'ultimoDiaUtilDoMes' | 'ajusteDiaNaoUtil'>>,
): Date;

export function obrigacoesAplicaveis(
    regime: string | null | undefined,
    competencia: string,
    opts?: { incluirPropostas?: boolean },
): ObrigacaoCatalogo[];

export function mesDoCliente(
    empresa: { colecao?: string; regimePadrao?: string } | null | undefined,
    competencia: string,
): MesDoCliente;

export const ESFERAS: Esfera[];

export function porEsfera(
    regime: string | null | undefined,
    competencia: string,
    opts?: { incluirPropostas?: boolean },
): Record<Esfera, ObrigacaoCatalogo[]>;

export function pendenciasDeConfirmacao(): PendenciaConfirmacao[];

/**
 * A entrada vale para este cliente, pela ABRANGÊNCIA?
 * `uf-desconhecida` quando o cliente não tem UF cadastrada — sem UF não se
 * afirma nem que o prazo de SP vale, nem que não vale.
 */
export function alcanceDaObrigacao(
    regra: { abrangencia?: string },
    ctx?: { uf?: string },
): 'aplica' | 'fora-de-abrangencia' | 'uf-desconhecida';
