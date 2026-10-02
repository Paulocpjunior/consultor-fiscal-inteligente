export type SituacaoPeriodo = 'abertura' | 'encerramento' | 'cisao' | 'fusao' | 'incorporacao';

export const SITUACOES_PERIODO: Readonly<Record<SituacaoPeriodo, { codigo: SituacaoPeriodo; rotulo: string; move: 'DT_INI' | 'DT_FIN' }>>;

export interface PeriodoDaGeracao {
    isoIni: string; isoFim: string; dtIni: string; dtFin: string;
    situacao: SituacaoPeriodo | null; rotulo: string | null; parcial: boolean; aviso: string;
}

export function limitesDaCompetencia(competencia: unknown): { primeiro: string; ultimo: string } | null;

export function conferirPeriodoDaGeracao(p?: {
    competencia?: string; dataInicio?: string; dataFim?: string; situacao?: string;
}): { ok: true; valor: PeriodoDaGeracao | null } | { ok: false; erro: string };

export function dataDoDocumentoNoLivro(nota: any): string;

export function recortarNotasPeloPeriodo<T = any>(
    notas: T[] | null | undefined,
    periodo: { isoIni: string; isoFim: string; rotulo?: string | null } | null | undefined,
): { docs: T[]; fora: Array<{ numero: string; data: string; direcao: string | null }>; semData: number; avisos: string[] };
