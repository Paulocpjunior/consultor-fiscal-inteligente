export function precisaReleituraIssRetido(doc: any): boolean;
export function patchDaReleituraIssRetido(xml: string, agoraIso: string): {
    nacional: boolean;
    issRetido?: boolean | null;
    patch: Record<string, unknown>;
};
export function impactoDaCorrecao(c: { direcao?: string; antes?: boolean; depois?: boolean }): string | null;
export interface GrupoCorrecao {
    empresaId: string | null; empresaNome: string | null; empresaCnpj: string | null; competencia: string | null;
    saidas: number; entradas: number; impactos: string[];
    notas: Array<{ numero: string | null; direcao: string | null; antes: boolean; depois: boolean }>;
}
export function agruparCorrecoes(corrigidas: any[]): GrupoCorrecao[];
export function ehEnvioDeIss(envio: any): boolean;
