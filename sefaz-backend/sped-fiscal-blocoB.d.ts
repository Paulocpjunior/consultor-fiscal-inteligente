/**
 * Bloco B do EFD ICMS/IPI — apuração do ISS, exclusivo do Distrito Federal.
 * Nasceu com o `.d.ts` (a armadilha das duas formas do tipo, 20/08).
 */
export const UF_BLOCO_B: 'DF';
export const CAMPOS_B470: string[];

export interface ValoresB470 {
    vlCont: number; vlMatTerc: number; vlMatProp: number; vlSub: number; vlIsnt: number;
    vlDedBc: number; vlBcIss: number; vlBcIssRt: number; vlIss: number; vlIssRt: number;
    vlDed: number; vlIssRec: number; vlIssSt: number; vlIssRecUni: number;
}

export interface ApuracaoBlocoB {
    prestadas: number;
    tomadasComRetencao: number;
    semValor: number;
    valores: ValoresB470;
}

export function blocoBAplicaNaUf(uf: unknown): boolean;
export function baseIssDoDocumento(doc: Record<string, unknown> | null | undefined): number;
export function apurarIssBlocoB(p?: { notas?: Array<Record<string, unknown>> | null; empresaCnpj?: string | null }): ApuracaoBlocoB;
export function avisosDoBlocoB(p?: { uf?: unknown; apuracao?: ApuracaoBlocoB | null }): string[];
export function buildBlocoB(dados?: Record<string, any>): string[];
