export function vencimentoMunicipalDaGuia(p?: {
    cadastros?: any[]; codMunIBGE?: string; competencia?: string; obrigacao?: string;
}): { achou: true; data: string; dataBr: string; baseLegal: string | null; municipio: string | null; ajuste: string }
    | { achou: false; situacao: string; motivo: string };
