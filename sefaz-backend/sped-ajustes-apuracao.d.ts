export const TIPOS_AJUSTE: Record<number, { campo: string; rotulo: string }>;

export function validarCodigoAjuste(codigo: string, ufEmpresa?: string): { ok: boolean; tipo?: number; erro?: string };

export interface AjusteApuracao {
    codigo: string;
    descricao?: string;
    valor: number;
}

export interface AjustesClassificados {
    outrosDebitos: number;
    estornosCredito: number;
    outrosCreditos: number;
    estornosDebito: number;
    deducoes: number;
    debitosEspeciais: number;
    validos: Array<AjusteApuracao & { tipo: number }>;
    erros: string[];
}

export function classificarAjustes(
    ajustes: AjusteApuracao[] | null | undefined,
    ufEmpresa?: string,
    /** 'proprio' = E111 (padrão) · 'st' = E220. Ajuste da outra apuração é ignorado em silêncio. */
    apuracaoAlvo?: 'proprio' | 'st',
): AjustesClassificados;

export function aplicarAjustesApuracao(
    base: { vlTotDebitos?: number; vlTotCreditos?: number; vlSldCredorAnt?: number },
    cls?: AjustesClassificados,
): {
    vlTotDebitos: number; vlTotAjDebitos: number; vlEstornosCred: number;
    vlTotCreditos: number; vlTotAjCreditos: number; vlEstornosDeb: number;
    vlSldCredorAnt: number; vlSldApurado: number; vlTotDed: number;
    vlIcmsRecolher: number; vlSldCredorTransportar: number; vlDebEsp: number;
    deducaoExcedente: number;
};

export function montarLinhasE111(validos: Array<AjusteApuracao & { tipo: number }>): Array<(string | number)[]>;
