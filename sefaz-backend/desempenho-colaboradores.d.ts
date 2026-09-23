export interface TipoAto {
    id: string; rotulo: string; grupo: string; colecao: string;
    filtroIgual?: Record<string, string>;
    campoData: string[]; campoQuem: string[];
    desde: string | null; carimbaQuem: boolean; leituraPorRange: boolean; tipoData?: 'timestamp' | 'iso';
    compartilhada?: boolean;
}
export declare const TIPOS_ATO: readonly TipoAto[];
export declare const ROTULOS_TIPO: Record<string, string>;
export declare const TIPOS_DERIVADOS: readonly Array<{ id: string; rotulo: string; grupo: string; base: string; apos: string }>;
export declare const RAJADA_MINIMO_POR_MINUTO: number;
export declare function tipoBaseDe(id: string): TipoAto | null;
export declare function tiposParaTela(): Array<{ id: string; rotulo: string; grupo: string; desde: string | null; carimbaQuem: boolean }>;
export interface Ato {
    id: string; tipo: string; em: string | null; quem: string | null;
    empresaId: string | null; empresaNome: string | null; empresaCnpj: string | null;
    competencia: string | null; detalhe: string | null; projetoOrigem: string | null;
}
export declare function paraIso(v: unknown): string | null;
export declare function normalizarAto(tipo: TipoAto, id: string, dados?: any): Ato;
export declare function resolverColaborador(quem: unknown, usuarios?: any[]): {
    chave: string; nome: string; email: string | null; uid: string | null; pessoa: boolean;
};
export interface EmpresaDesempenho {
    empresaId: string; empresaNome: string; total: number; porTipo: Record<string, number>;
    ultimoEm: string | null; naCarteira: boolean;
}
export interface ColaboradorDesempenho {
    chave: string; nome: string; email: string | null; pessoa: boolean;
    porque: string | null; emLote: Record<string, number>;
    total: number; porTipo: Record<string, number>;
    empresasComAto: number; empresasDaCarteira: number;
    empresasDaCarteiraSemAto: Array<{ empresaId: string; empresaNome: string; papel: string | null }>;
    empresas: EmpresaDesempenho[];
}
export interface Desempenho {
    periodo: { de: string | null; ate: string | null };
    totalAtos: number; semData: number;
    totaisPorTipo: Record<string, number>;
    colaboradores: ColaboradorDesempenho[];
    naoLidas: Array<{ tipo: string; rotulo: string; motivo: string }>;
    foraDoEscopo: { eventos: number; autores: Array<{ quem: string; quantidade: number; motivo: string | null }> };
    ressalvas: string[];
}
export declare function montarDesempenho(p: {
    atos?: Ato[]; usuarios?: any[]; vinculos?: any[];
    naoLidas?: Array<{ tipo: string; rotulo: string; motivo: string }>;
    de?: string | null; ate?: string | null;
}): Desempenho;
export declare function ressalvasDoDesempenho(p: { de?: string | null; naoLidas?: any[]; semData?: number; atos?: Ato[]; foraDoEscopo?: any; colaboradores?: any[] }): string[];
export declare function periodoPadrao(meses?: number, agora?: Date): { de: string; ate: string };
