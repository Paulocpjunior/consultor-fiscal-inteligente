// Tipos do núcleo `fim-de-mes.js`.
//
// ⚠️ `.d.ts` à mão é a armadilha das duas formas com outra roupa (20/08): o
// tipo e a implementação são DUAS declarações do mesmo fato e divergem em
// silêncio. Export novo no `.js` entra aqui no MESMO PR — `dtsNaoPrometeFantasma`
// varre a direção contrária (declarar o que o `.js` não exporta mais), que é a
// que estoura em produção no primeiro clique.

export const MOTIVO_REABERTURA_MINIMO: number;
export const CAMPOS_APURADOS: readonly string[];

export interface QuemFechou {
    uid: string | null;
    email: string | null;
    nome: string | null;
}

export interface CorteDoFechamento {
    /** Instante do corte, ISO. É ele que a régua compara — o NSU é a PROVA. */
    instante: string;
    /** Cursor do DistDFe no instante do corte. `null` = ausente, nunca 0. */
    ultNSU: number | null;
    maxNSU: number | null;
    documentos: { entradas: number; saidas: number; total: number };
}

export interface Reabertura {
    em: string;
    por: string | null;
    motivo: string;
    versaoReaberta: number;
    apuradoNaVersao: Record<string, number | null> | null;
}

export interface EtapaNoFechamento {
    id: string;
    nome: string;
    status: string;
    resumo: string | null;
}

export interface Fechamento {
    empresaId: string;
    competencia: string;
    regime: string | null;
    estado: 'fechada' | 'reaberta';
    versao: number;
    fechadoEm: string;
    fechadoPor: QuemFechou | null;
    corte: CorteDoFechamento | null;
    /** Valores APURADOS — ausência é `null`, nunca 0. */
    apurado: Record<string, number | null>;
    /** 'ficha-lucro' | 'simples' | 'simples-detalhado'. */
    apuradoFonte?: string | null;
    /** Ressalva do Simples: o valor do DAS não vive na ficha financeira. */
    apuradoRessalva?: string | null;
    fichaId: string | null;
    lastro: unknown | null;
    etapas: EtapaNoFechamento[];
    reaberturas: Reabertura[];
    reabertoEm?: string;
    reabertoPor?: QuemFechou | null;
}

export interface Bloqueio {
    id: string;
    ordem: number;
    nome: string;
    status: string;
    resumo: string | null;
    acao: string | null;
    onde: string | null;
}

export function valoresApuradosDaFicha(ficha: unknown): Record<string, number | null>;

export function podeDarFimDeMes(rotina: unknown): {
    pode: boolean;
    bloqueios: Bloqueio[];
    motivo: string | null;
};

export function montarCorte(args: {
    agoraIso: string;
    state?: { ultNSU?: unknown; maxNSU?: unknown } | null;
    documentos?: { entradas?: unknown; saidas?: unknown; total?: unknown } | null;
}): CorteDoFechamento;

export function montarFimDeMes(args: {
    empresaId: string;
    competencia: string;
    regime?: string | null;
    rotina: unknown;
    ficha: unknown;
    corte?: CorteDoFechamento | null;
    lastro?: unknown;
    /**
     * A apuração do DONO (`acharApuracaoDaCompetencia`) — ela conhece as TRÊS
     * fontes. Sem ela o Simples, que não tem `fichaFinanceira`, era recusado
     * com "sem apuração registrada" DEPOIS de a Rotina dizer "pronto".
     */
    apuracao?: { fonte?: string; totalImpostos?: number | null; receita?: number | null } | null;
    quem?: Partial<QuemFechou> | null;
    agoraIso: string;
    anterior?: Partial<Fechamento> | null;
}): { ok: true; fechamento: Fechamento }
    | { ok: false; motivo: string; bloqueios: Bloqueio[] };

export function conferirReabertura(args: {
    fechamento: Partial<Fechamento> | null;
    motivo: string;
    ehAdmin: boolean;
}): { pode: boolean; erro: string | null };

export function aplicarReabertura(args: {
    fechamento: Fechamento;
    motivo: string;
    quem?: Partial<QuemFechou> | null;
    agoraIso: string;
}): Fechamento;

export function competenciaFechada(fechamento: Partial<Fechamento> | null | undefined): boolean;

export function descreverFechamento(fechamento: Partial<Fechamento> | null | undefined): {
    estado: 'aberta' | 'fechada' | 'reaberta';
    texto: string;
};
