import type { VeredictoDere, RegimeEspecificoIbsCbs, DecisaoDere } from './dere-regimes';

export interface MarcoDere { dataIso: string; marco: string; detalhe: string; fonte: string }
export interface EventoDere {
    codigo: string;
    nome: string;
    grupo: 'tabela' | 'mensal' | 'retorno';
    desde?: string;
    mensalDesde?: string;
    nota?: string;
    /** Evento auxiliar exigido só de quem tem no PGCC conta com um destes codTribs (Anexo II). */
    condicional?: { codTribs: readonly string[]; texto: string };
}
export interface EventosDaCompetencia { tabela: EventoDere[]; mensais: EventoDere[] }

export interface EndpointDere { metodo: 'GET' | 'POST' | 'DELETE'; caminho: string; oQue: string }
export interface IntegracaoDere {
    fonte: string;
    autenticacao: { padrao: string; tokenUrl: string; validadeMin: number };
    ambiente: string;
    urlBase: string;
    endpoints: readonly EndpointDere[];
    assinatura: { padrao: string; certificado: string };
    namespaces: string;
    preRequisitos: readonly string[];
    protocoloNaoEhRecibo: string;
}

export interface DocumentoDere { titulo: string; versao: string; data: string; pdf: string; texto: string }

export type SituacaoDere = DecisaoDere | 'ainda-nao-vigente';

export interface SituacaoDereEmpresa extends VeredictoDere {
    competencia: string;
    competenciaIso: string;
    situacao: SituacaoDere;
    /** CNPJ raiz (8) — a declaração é uma por raiz; null quando o CNPJ não é legível. */
    raiz: string | null;
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
    raiz: string | null;
    nome: string;
    regimeTributario: string | null;
    cnae: string | null;
    regimeEspecifico: string | null;
    regimeEspecificoRotulo: string | null;
    codigoD1001: number | null;
    situacao: SituacaoDere;
    motivo: string;
    acao: string | null;
    sinalCnae: string | null;
    prazoTexto: string | null;
}

export interface DeclaracaoDere {
    raiz: string;
    regimeEspecifico: string | null;
    codigoD1001: number | null;
    estabelecimentos: { id: string | null; cnpj: string | null; nome: string }[];
    /** Estabelecimentos da mesma raiz com regimes específicos diferentes no cadastro — acende, não escolhe. */
    regimesDivergem: boolean;
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
    documentos: readonly DocumentoDere[];
    documentosFaltando: readonly string[];
    integracao: IntegracaoDere;
    obrigadas: LinhaDere[];
    declaracoes: DeclaracaoDere[];
    obrigadasSemRaiz: LinhaDere[];
    candidatas: LinhaDere[];
    foraDoLeiaute: LinhaDere[];
    naoSeAplica: LinhaDere[];
    resumo: {
        total: number; obrigadas: number; declaracoes: number; obrigadasSemRaiz: number;
        candidatas: number; foraDoLeiaute: number;
        naoSeAplica: number; dispensadasSimples: number; semSinal: number;
    };
    ressalvas: string[];
}

export const VIGENCIA_DERE: string;
export const CRONOGRAMA_DERE: readonly MarcoDere[];
export const EVENTOS_DERE: readonly EventoDere[];
export const INTEGRACAO_DERE: IntegracaoDere;
export const DOCUMENTOS_DERE: readonly DocumentoDere[];
export const DOCUMENTOS_DERE_FALTANDO: readonly string[];

export function montarIdEventoDere(
    args: { codigoEvento: string; cnpj: string; data: Date; sequencial?: number },
): { ok: boolean; id: string | null; motivo: string | null };
export function lerIdEventoDere(id: unknown):
    | { ok: true; evento: string; tipoInscricao: string; cnpj: string; geradoEm: string; sequencial: number }
    | { ok: false; motivo: string };
export function lerRecibo(recibo: unknown):
    | { ok: true; evento: string; periodo: string; idInterno: string }
    | { ok: false; motivo: string };
export function lerProtocolo(protocolo: unknown):
    | { ok: true; ambiente: 'producao' | 'pre-producao'; recebidoEm: string; numero: string; ressalva: string }
    | { ok: false; motivo: string };

export function eventosDaCompetencia(competencia: string): EventosDaCompetencia;
export function prazoDere(competencia: string): Date | null;
export function situacaoDere(
    empresa: unknown,
    competencia: string,
    ctx?: { regimeCatalogo?: string | null },
): SituacaoDereEmpresa;
export function triarCarteiraDere(empresas: unknown[], competencia: string): TriagemDere;
