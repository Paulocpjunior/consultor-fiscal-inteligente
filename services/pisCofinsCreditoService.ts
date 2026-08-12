/**
 * pisCofinsCreditoService — porta do front para a base de crédito de
 * PIS/COFINS derivada dos DOCUMENTOS.
 *
 * A conta NÃO mora aqui. Ela é do núcleo `sefaz-backend/pis-cofins-credito.js`,
 * que é quem sabe ler o CST de cada item. Este arquivo só chama e tipa — painel
 * com conta própria diverge sozinho (lição do card 4).
 */
import { getAuth } from 'firebase/auth';

export interface MotivoCredito {
    veredito: 'credita' | 'nao-credita' | 'presumido' | 'indefinido';
    motivo: string;
    prova: 'documento' | 'indicio';
    valor: number;
    itens: number;
}

export interface CreditoForaDoDocumento {
    item: string;
    baseLegal: string;
    porque: string;
}

export interface ComparacaoBase {
    baseUsada: number;
    baseConfirmada: number;
    baseIndefinida: number;
    diferenca: number;
    creditoUsado: number;
    creditoConfirmado: number;
    diferencaCredito: number;
    leitura: 'bate' | 'a-maior' | 'a-maior-com-duvida' | 'a-menor';
    acao: string;
}

export interface BaseCreditoResposta {
    ok: boolean;
    empresaId: string;
    competencia: string;
    /** true quando NÃO há entrada capturada — não é "crédito zero". */
    semDados?: boolean;
    aviso?: string;
    documentos?: number;
    documentosCancelados?: number;
    documentosSemItens?: number;
    baseConfirmada?: number;
    baseNaoCredita?: number;
    basePresumido?: number;
    baseIndefinida?: number;
    totalEntradas?: number;
    totalItens?: number;
    itensSemCst?: number;
    porMotivo?: MotivoCredito[];
    confiavel?: boolean;
    /** O que a derivação NÃO cobre — obrigatório mostrar junto do número. */
    naoIncluido?: CreditoForaDoDocumento[];
    creditoPis?: number;
    creditoCofins?: number;
    creditoTotal?: number;
    comparacao?: ComparacaoBase | null;
}

export interface BackfillResposta {
    ok: boolean;
    examinados: number;
    atualizados: number;
    camposPreenchidos: number;
    jaCompletos: number;
    semItens: number;
    semStoragePath: number;
    xmlNaoLido: number;
    naoReprocessados: number;
    erros: string[];
}

async function authHeaders(): Promise<HeadersInit> {
    const user = getAuth().currentUser;
    if (!user) throw new Error('Sessão expirada — entre novamente.');
    return { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' };
}

async function parse<T>(r: Response): Promise<T> {
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((json as any)?.erro || `Falha (${r.status})`);
    return json as T;
}

/**
 * Base de crédito derivada das entradas capturadas.
 * `baseUsada` é opcional: com ela, a resposta traz a comparação.
 */
export async function consultarBaseCredito(
    empresaId: string,
    competencia: string,
    baseUsada?: number,
): Promise<BaseCreditoResposta> {
    const q = new URLSearchParams({ empresaId, competencia });
    if (baseUsada !== undefined && Number.isFinite(baseUsada)) q.set('baseUsada', String(baseUsada));
    const r = await fetch(`/api/admin/pis-cofins/base-credito?${q}`, { headers: await authHeaders() });
    return parse<BaseCreditoResposta>(r);
}

/**
 * Reprocessa os XMLs do Storage para completar o CST dos itens.
 * Idempotente e sem contato com a SEFAZ.
 */
export async function reprocessarCst(
    empresaId: string,
    competencias: string[],
): Promise<BackfillResposta> {
    const r = await fetch('/api/admin/pis-cofins/backfill-cst', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ empresaId, competencias }),
    });
    return parse<BackfillResposta>(r);
}
