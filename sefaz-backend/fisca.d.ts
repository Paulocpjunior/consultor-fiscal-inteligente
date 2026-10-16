export const FISCA_LIMITE_DOCUMENTOS: number;
export const FISCA_SYSTEM: string;
export function validarPedidoFisca(body: unknown): Record<string, unknown>;
export function resumirAcervoFisca(documentos: Array<{ id: string; chave?: string; chaveAcesso?: string; direcao?: string; status?: string; cStat?: string; eventos?: unknown[]; cancelamentoDeclarado?: unknown; _deleted?: boolean; _merged_into?: string }>): {
    registrosConsultados: number; limitado: boolean; limite: number; status: Record<string, number>;
    semDirecao: string[]; retirados: string[]; possiveisRepeticoes: string[][]; escopo: string;
};
export function fontesFisca(candidates?: Array<{ groundingMetadata?: { groundingChunks?: Array<{ web?: { uri: string; title?: string } }> } }>): Array<{ titulo: string; url: string }>;
export function criarFiscaHandler(deps: {
    autorizar: (user: unknown, empresaId: string) => Promise<{ ok: boolean; status?: number; error?: string }>;
    lerEmpresa: (fonte: string, id: string) => Promise<Record<string, unknown> | null>;
    lerDocumentos: (empresaId: string, competencia: string, limite: number) => Promise<Array<{ id: string }>>;
    gerar: (input: { systemInstruction: string; prompt: string }) => Promise<{ text?: string; candidates?: unknown[] }>;
}): (req: { user?: { uid?: string; role?: string }; body: unknown }, res: { status: (code: number) => unknown; json: (body: unknown) => unknown }) => Promise<unknown>;
