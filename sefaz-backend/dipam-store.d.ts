export declare const COLECAO_PRODUTORES: string;
export declare const NATUREZAS: string[];
export declare const REGIMES_FUNRURAL: string[];

/**
 * Só os campos INFORMADOS entram no objeto — presença no payload é o sinal.
 * Campo ausente é preservado no Firestore pelo `{ merge: true }`; campo
 * presente e vazio APAGA (lição do CCM-SP).
 */
export function montarRegistroProdutor(
    id: string,
    dados?: Record<string, unknown>,
    usuario?: { email?: string; uid?: string } | null,
): Record<string, unknown>;

export function salvarProdutorRural(
    doc: string,
    dados: Record<string, unknown>,
    usuario?: { email?: string; uid?: string } | null,
): Promise<Record<string, unknown>>;

export function carregarProdutoresRurais(docs?: string[]): Promise<Map<string, any>>;
export function lerCondicaoRural(empresa: unknown): Record<string, unknown>;
export function documentosDaContraparte(notas?: unknown[]): string[];

/**
 * Recusa marcar como Produtor Rural (PF) um CNPJ cuja razão social carrega tipo
 * societário (LTDA/S.A./EIRELI) — sociedade é pessoa jurídica e não há
 * sub-rogação. Lança com `code: 'NATUREZA_CONTRADITORIA'`.
 */
export function assertNaturezaCoerente(id: string, dados?: { nome?: string; natureza?: string }): void;
