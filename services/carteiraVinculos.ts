/**
 * Casca de I/O da leitura da carteira. A régua (o teto, a frase do
 * truncamento) mora no núcleo PURO — aqui só o Firestore.
 *
 * Ver `carteiraVinculosNucleo.ts` para o caso que originou isto (27/08: 21
 * empresas aparecendo como "Sem responsável" por um `fbLimit(500)` mudo).
 */
import { fetchAllDocs, type FetchAllMeta } from './firestorePaginate';
import { isFirebaseConfigured, db } from './firebaseConfig';
import { COLECAO_CARTEIRAS, TETO_VINCULOS, type LeituraDeVinculos } from './carteiraVinculosNucleo';

export { COLECAO_CARTEIRAS, TETO_VINCULOS, avisoDeTruncamento } from './carteiraVinculosNucleo';
export type { LeituraDeVinculos } from './carteiraVinculosNucleo';

/**
 * TODOS os vínculos da carteira — o dono único da leitura.
 *
 * Escrito uma vez de propósito: eram DUAS cópias do mesmo `fbLimit(500)`, e a
 * segunda (o escopo da Central de XMLs) era a cara. Duas leituras do mesmo
 * fato divergem, e esta divergiu do jeito mais silencioso possível.
 */
export async function lerTodosOsVinculos<T = Record<string, unknown>>(
    mapear: (id: string, dados: Record<string, unknown>) => T,
): Promise<LeituraDeVinculos<T>> {
    if (!isFirebaseConfigured || !db) return { vinculos: [], truncado: false, total: 0 };
    // `fetchAllDocs` preenche os três; os valores iniciais existem porque o
    // tipo os exige — e `truncated: false` é o lado SEGURO: se a leitura
    // estourar antes de escrever, ninguém afirma que cortou.
    const meta: FetchAllMeta = { truncated: false, count: 0, maxDocs: TETO_VINCULOS };
    const snaps = await fetchAllDocs(COLECAO_CARTEIRAS, [], { maxDocs: TETO_VINCULOS, meta });
    const vinculos = snaps.map((d) => mapear(d.id, d.data() as Record<string, unknown>));
    return { vinculos, truncado: meta.truncated === true, total: vinculos.length };
}
