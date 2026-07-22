export function extrairChaves(texto: unknown): string[];
export function modeloDaChaveAcesso(chave: unknown): string | null;

export interface ItemConferenciaChave {
    chave: string;
    modelo: string | null;
    status: 'presente-completa' | 'presente-resumo' | 'ausente';
    direcao?: string | null;
    empresaCnpj?: string | null;
}

export function classificarChaves(
    chaves: string[],
    presentes: Map<string, { schema?: string; tipoDoc?: string; direcao?: string; empresaCnpj?: string }>,
): {
    itens: ItemConferenciaChave[];
    resumo: { total: number; presentesCompletas: number; presentesResumo: number; ausentes: number };
};
