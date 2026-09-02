import type { VeredictoDere, RegimeEspecificoIbsCbs, DecisaoDere } from './dere-regimes';

export interface MarcoDere { dataIso: string; marco: string; detalhe: string; fonte: string }
export interface EventoDere {
    codigo: string;
    nome: string;
    grupo: 'tabela' | 'mensal' | 'retorno';
    desde?: string;
    mensalDesde?: string;
    nota?: string;
}
export interface EventosDaCompetencia { tabela: EventoDere[]; mensais: EventoDere[] }

export type SituacaoDere = DecisaoDere | 'ainda-nao-vigente';

export interface SituacaoDereEmpresa extends VeredictoDere {
    competencia: string;
    competenciaIso: string;
    situacao: SituacaoDere;
    vigente: boolean;
    vigenciaDesde: string;
    prazo: Date | null;
    prazoTexto: string | null;
    eventos: EventosDaCompetencia;
    entregaPeloApp: false;
    ressalvaEntrega: string;
}

export interface LinhaDere {
    id: string | null;
    cnpj: string | null;
    nome: string;
    regimeTributario: string | null;
    cnae: string | null;
    regimeEspecifico: string | null;
    regimeEspecificoRotulo: string | null;
    situacao: SituacaoDere;
    motivo: string;
    acao: string | null;
    sinalCnae: string | null;
    prazoTexto: string | null;
}

export interface TriagemDere {
    competencia: string;
    vigente: boolean;
    vigenciaDesde: string;
    prazoTexto: string | null;
    eventos: EventosDaCompetencia;
    cronograma: readonly MarcoDere[];
    regimes: readonly RegimeEspecificoIbsCbs[];
    fontes: Record<string, string>;
    obrigadas: LinhaDere[];
    candidatas: LinhaDere[];
    regimeNaoConfirmado: LinhaDere[];
    naoSeAplica: LinhaDere[];
    resumo: {
        total: number; obrigadas: number; candidatas: number; regimeNaoConfirmado: number;
        naoSeAplica: number; dispensadasSimples: number; semSinal: number;
    };
    ressalvas: string[];
}

export const VIGENCIA_DERE: string;
export const CRONOGRAMA_DERE: readonly MarcoDere[];
export const EVENTOS_DERE: readonly EventoDere[];

export function eventosDaCompetencia(competencia: string): EventosDaCompetencia;
export function prazoDere(competencia: string): Date | null;
export function situacaoDere(
    empresa: unknown,
    competencia: string,
    ctx?: { regimeCatalogo?: string | null },
): SituacaoDereEmpresa;
export function triarCarteiraDere(empresas: unknown[], competencia: string): TriagemDere;
