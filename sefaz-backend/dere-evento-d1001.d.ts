import type { VeredictoDere } from './dere-regimes';
import type { XsdDere } from './dere';

export const TABELA_13_UF: Readonly<Record<number, string>>;
export const IND_NAT_TRIB: readonly { codigo: '0' | '1'; rotulo: string }[];
export const VER_APLIC_PADRAO: string;
export const XSD_D1001: XsdDere;

export interface GrupoD1001 { grupo: 'servFinanc' | 'plAssistSaude' | 'prognosticos'; regime: string; rotulo: string; atividades: string[] }

export interface ValoresD1001 {
    nrInsc: string;
    regTribPrinc: number;
    regTribSecund: number[];
    indNatTrib: string;
    iniValid: string;
    fimValid: string | null;
    grupos: GrupoD1001[];
    ufsCredenciadas: string[];
}

export interface InsumoD1001 {
    ok: boolean;
    pendencias: string[];
    avisos: string[];
    veredicto: VeredictoDere;
    valores: ValoresD1001 | null;
}

export interface ResumoD1001 extends ValoresD1001 {
    evento: 'D-1001';
    xsd: string;
    namespace: string;
    tpAmb: string;
    tpOper: string;
}

export interface EventoD1001 {
    ok: boolean;
    xml: string | null;
    id: string | null;
    pendencias: string[];
    avisos: string[];
    veredicto: VeredictoDere | null;
    resumo: ResumoD1001 | null;
}

export function lerAtividadeDere(bruto: unknown):
    | { ok: true; regime: string; codigo: string; descricao: string; motivo: null }
    | { ok: false; regime: string | null; codigo: string | null; motivo: string };
export function validarInsumoD1001(empresa: unknown, ctx?: { regimeCatalogo?: string | null }): InsumoD1001;
export function montarEventoD1001(
    empresa: unknown,
    opts?: { regimeCatalogo?: string | null; tpAmb?: 1 | 2 | '1' | '2'; tpOper?: 1 | '1'; data?: Date; sequencial?: number; verAplic?: string },
): EventoD1001;
