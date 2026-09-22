// Tipos do recorte "só o CFI" da auditoria do dono — o dono é o .js.
export const DEPARTAMENTO_CFI: string;
export const PROJETOS_CFI: Set<string>;
export interface ClassificacaoUsuario { ehCfi: boolean; motivo: string }
export interface ConjuntoCfi {
    emails: Set<string>; uids: Set<string>;
    porEmail: Map<string, ClassificacaoUsuario>; porUid: Map<string, ClassificacaoUsuario>;
}
export interface ForaDoEscopo { eventos: number; autores: Array<{ quem: string; quantidade: number; motivo: string | null }> }
export function classificarUsuarioCfi(usuario: any): ClassificacaoUsuario;
export function motivoWhatsappForaDoCfi(dados?: any): string | null;
export function motivoInclusaoCfi(quem: unknown, conjunto: ConjuntoCfi | null | undefined, trilha?: { compartilhada?: boolean }): string;
export function conjuntoCfi(p?: { usuarios?: any[]; vinculos?: any[] }): ConjuntoCfi;
export function classificarEscopoCfi(
    ev: { quem?: string | null; projetoOrigem?: string | null; motivoForaDoCfi?: string | null } | null | undefined,
    conjunto: ConjuntoCfi | null | undefined,
    trilha?: { compartilhada?: boolean },
): { dentro: boolean; motivo: string | null };
export function filtrarEscopoCfi<T extends { quem?: string | null; projetoOrigem?: string | null }>(
    eventos: T[], conjunto: ConjuntoCfi | null | undefined, trilhaDe?: (ev: T) => { compartilhada?: boolean } | undefined,
): { dentro: T[]; foraDoEscopo: ForaDoEscopo };
export function ressalvaEscopoCfi(fora: ForaDoEscopo | null | undefined, opts?: { maxNomes?: number; rotuloEvento?: string }): string;
