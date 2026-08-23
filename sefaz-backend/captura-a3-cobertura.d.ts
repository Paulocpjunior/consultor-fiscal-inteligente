/**
 * Cobertura pelo agente local `cfi-a3`. O `.d.ts` entra no MESMO PR que o
 * módulo — lição do deploy 634.
 */
export const FONTE_AGENTE_A3: 'agent-a3';

export interface CoberturaA3 {
    situacao: 'nao-se-aplica' | 'a3-sem-entrega' | 'a3-entregue';
    cor: 'ok' | 'atencao' | 'neutro';
    ehA3: boolean;
    /** Timestamp da última entrega DO AGENTE (null = nunca entregou). */
    entregueEm: number | null;
    diasDesdeEntrega: number | null;
    texto: string | null;
    acao: string | null;
}

export function coberturaAgenteA3(p?: {
    tipoCert?: string | null;
    certUploaded?: boolean;
    /** `sefaz_state.ultimaSync` em ms. */
    ultimaSyncMs?: number | null;
    /** `sefaz_state.ultimaSyncFonte` — só `'agent-a3'` prova o agente. */
    ultimaSyncFonte?: string | null;
    agoraMs?: number;
}): CoberturaA3;

export function resumirCoberturaA3(coberturas: Array<CoberturaA3 | null | undefined>): {
    a3Total: number;
    a3SemEntrega: number;
    a3ComEntrega: number;
};
