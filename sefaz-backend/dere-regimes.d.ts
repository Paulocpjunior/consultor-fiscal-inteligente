export interface RegimeEspecificoIbsCbs {
    codigo: string;
    rotulo: string;
    capitulo: string | null;
    baseLegal: string;
    /** TRUE só onde a documentação lida nomeia o regime como obrigado à DeRE. */
    dereConfirmada: boolean;
    /** Prefixos de CNAE (só dígitos) que fazem a empresa virar CANDIDATA. */
    cnaes: readonly string[];
}

export type DecisaoDere =
    | 'dispensada-simples'
    | 'obrigada'
    | 'nao-se-aplica'
    | 'regime-nao-confirmado'
    | 'candidata'
    | 'sem-sinal';

export interface SinalCnaeDere { regime: string; rotulo: string; cnae: string }

export interface VeredictoDere {
    decisao: DecisaoDere;
    regimeEspecifico: string | null;
    rotulo: string | null;
    motivo: string;
    acao: string | null;
    sinalCnae: SinalCnaeDere | null;
    fonte: string;
}

export const FONTES_DERE: Readonly<Record<
    'LC_214' | 'ATO_CONJUNTO_4' | 'ESCLARECIMENTO_26_08' | 'MOD_1_0_1' | 'LEIAUTES_1_0_0', string>>;
export const REGIMES_ESPECIFICOS_IBS_CBS: readonly RegimeEspecificoIbsCbs[];
export const REGIMES_ESPECIFICOS_VALIDOS: readonly string[];

export function regimeEspecificoPorCodigo(codigo: unknown): RegimeEspecificoIbsCbs | null;
export function validarRegimeEspecificoParaGravacao(bruto: unknown): { ok: boolean; codigo: string | null; motivo?: string };
export function sinalDeCnaeParaDere(cnae: unknown): SinalCnaeDere | null;
export function decidirDereNoCadastro(
    empresa: { regimeEspecificoIbsCbs?: string | null; cnae?: string | null; dadosFiscais?: { regimeEspecificoIbsCbs?: string | null; cnae?: string | null } | null } | null | undefined,
    ctx?: { regimeCatalogo?: string | null },
): VeredictoDere;
