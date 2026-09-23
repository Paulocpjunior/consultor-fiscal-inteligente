export interface RestricaoXsd {
    base: string | null;
    patterns: string[];
    enumeracoes: string[];
    minLength: number | null;
    maxLength: number | null;
    minInclusive?: number | null;
    maxInclusive?: number | null;
}
export interface DefinicaoElementoXsd {
    nome?: string;
    ref?: string;
    min: number;
    max: number;
    filhos?: DefinicaoElementoXsd[] | null;
    restricao?: RestricaoXsd | null;
    atributos?: { nome: string; obrigatorio: boolean; restricao: RestricaoXsd | null }[];
    tipo?: string | null;
}
export interface EsquemaXsd { targetNamespace: string | null; raiz: DefinicaoElementoXsd; avisos: string[] }
export interface ConferenciaXsd { ok: boolean; erros: string[]; avisos: string[]; raiz: string | null; namespace: string | null }

export function carregarEsquema(xsdTexto: string): EsquemaXsd;
export function conferirXmlContraXsd(xmlTexto: string, xsdTexto: string, opts?: { ignorarRefs?: string[] }): ConferenciaXsd;
