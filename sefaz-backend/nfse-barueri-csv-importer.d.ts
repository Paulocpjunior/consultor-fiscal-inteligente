/**
 * Gravação das notas do CSV do portal de Barueri. As partes PURAS
 * (documento, direção, posse) são exercitáveis por teste; a gravação fala com
 * o Firestore. O `.d.ts` entra no mesmo PR que o módulo.
 */
import type { CsvBarueriLido, NotaBarueri } from './nfse-barueri-csv-parser.js';

export interface CtxImportBarueri {
    empresaId?: string | null;
    empresaCnpj?: string | null;
    empresaNome?: string | null;
    importadoPor?: string | null;
}

export function direcaoDaNotaBarueri(
    nota: Partial<NotaBarueri>, empresaCnpj?: string | null,
): 'entrada' | 'saida' | null;

export function conferirPosseDoCsvBarueri(
    parsed: Pick<CsvBarueriLido, 'notas'> | null | undefined, empresaCnpj?: string | null,
): { ok: boolean; motivo: string | null; prestadores: string[]; semChave: boolean };

/** Os campos do documento nas formas que os leitores do app já leem. */
export function documentoDaNotaBarueri(
    nota: NotaBarueri, ctx?: CtxImportBarueri,
): Record<string, any>;

export function salvarNotaBarueri(nota: NotaBarueri, ctx?: CtxImportBarueri): Promise<{
    status: 'criada' | 'atualizada';
    docId: string;
    numero: string;
    valor: number | null;
    tomador: string;
    direcao: 'entrada' | 'saida' | null;
    competencia: string | null;
    cancelada: boolean;
    /** Estava ATIVA no banco e o município diz que foi cancelada. */
    virouCancelada: boolean;
}>;

export function importarCsvNfseBarueri(parsed: CsvBarueriLido, ctx?: CtxImportBarueri): Promise<{
    criadas: number;
    atualizadas: number;
    erros: number;
    viraramCanceladas: Array<{ numero: string; valor: number | null }>;
    detalhes: Array<Record<string, any>>;
    totalNotas: number;
    canceladas: number;
    valorTotal: number;
    periodo: { inicio: string | null; fim: string | null };
    duracaoMs: number;
}>;
