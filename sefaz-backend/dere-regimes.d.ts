export interface RegimeEspecificoIbsCbs {
    codigo: string;
    rotulo: string;
    capitulo: string | null;
    baseLegal: string;
    /** TRUE = tem código no D-1001 {regTribPrinc} do leiaute vigente (cabe na declaração). */
    dereConfirmada: boolean;
    /** O valor do {regTribPrinc}/{regTribSecund} do D-1001 (1, 2, 3) — null fora do leiaute. */
    codigoD1001: number | null;
    /** Prefixos de CNAE (só dígitos) que fazem a empresa virar CANDIDATA. */
    cnaes: readonly string[];
}

export type DecisaoDere =
    | 'dispensada-simples'
    | 'obrigada'
    | 'nao-se-aplica'
    | 'regime-fora-do-leiaute'
    | 'candidata'
    | 'sem-sinal';

export interface SinalCnaeDere { regime: string; rotulo: string; cnae: string }

export interface VeredictoDere {
    decisao: DecisaoDere;
    regimeEspecifico: string | null;
    rotulo: string | null;
    codigoD1001: number | null;
    motivo: string;
    acao: string | null;
    sinalCnae: SinalCnaeDere | null;
    fonte: string;
}

export const FONTES_DERE: Readonly<Record<
    'LC_214' | 'LEIAUTES_1_1_0' | 'MANUAL_DEV_1_0_2' | 'ATO_CONJUNTO_4' | 'ESCLARECIMENTO_26_08' | 'MOD_1_0_1', string>>;
export const REGIMES_ESPECIFICOS_IBS_CBS: readonly RegimeEspecificoIbsCbs[];
export const REGIMES_ESPECIFICOS_VALIDOS: readonly string[];
/** Tabelas 21/31/41 do Anexo I: [código NNC, descrição], por regime com código no D-1001. */
export const ATIVIDADES_DERE: Readonly<Record<'SERVICOS_FINANCEIROS' | 'PLANOS_SAUDE' | 'CONCURSOS_PROGNOSTICOS', readonly (readonly [string, string])[]>>;

export function regimeEspecificoPorCodigo(codigo: unknown): RegimeEspecificoIbsCbs | null;
export function raizDoCnpj(cnpj: unknown): string | null;
export function validarRegimeEspecificoParaGravacao(bruto: unknown): { ok: boolean; codigo: string | null; motivo?: string };
export function sinalDeCnaeParaDere(cnae: unknown): SinalCnaeDere | null;
export function decidirDereNoCadastro(
    empresa: { regimeEspecificoIbsCbs?: string | null; cnae?: string | null; dadosFiscais?: { regimeEspecificoIbsCbs?: string | null; cnae?: string | null } | null } | null | undefined,
    ctx?: { regimeCatalogo?: string | null },
): VeredictoDere;
