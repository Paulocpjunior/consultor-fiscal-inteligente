// Tipos das etiquetas (flags) do contato — o dono é o .js.
export interface Etiqueta {
    id: string;
    rotulo: string;
    cor: string;
    ordem: number;
    finalidade: string;
    baseLegal: string;
    ativa?: boolean;
    origem?: 'padrao' | 'padrao-editado' | 'cadastro';
}

export interface ContatoComEtiquetas {
    numero: string;
    nomePerfil?: string | null;
    nome?: string | null;
    empresaNome?: string | null;
    empresaNomeSugerido?: string | null;
    etiquetas?: string[];
    consentimentos?: Record<string, { em?: string | null; como?: string | null; por?: string | null; revogadoEm?: string | null }>;
}

export interface PendenciaLgpd {
    etiqueta: string;
    tipo: 'etiqueta-desconhecida' | 'sem-consentimento' | 'consentimento-revogado';
    motivo: string;
    acao: string;
}

export const BASES_LEGAIS: Record<string, { rotulo: string; artigo: string; pedeConsentimento: boolean }>;
export const ETIQUETAS_PADRAO: Etiqueta[];
export const CORES_ETIQUETA: string[];

export function baseLegalValida(id: unknown): boolean;
export function normalizarIdEtiqueta(v: unknown): string;
export function validarEtiqueta(d?: Partial<Etiqueta>): { ok: true; etiqueta: Etiqueta } | { ok: false; erro: string };
export function montarCatalogoEtiquetas(cadastradas?: Partial<Etiqueta>[]): Etiqueta[];
export function validarEtiquetasDoContato(ids: unknown, catalogo: Etiqueta[], opts?: { exigirCategoria?: boolean }):
    { ok: true; etiquetas: string[] } | { ok: false; erro: string; desconhecidas?: string[] };
export function pendenciasLgpdDoContato(contato?: ContatoComEtiquetas, catalogo?: Etiqueta[]): PendenciaLgpd[];
export function podeEnviarPorEtiqueta(contato: ContatoComEtiquetas, etiquetaId: string, catalogo: Etiqueta[]):
    { pode: boolean; motivo?: string; acao?: string };
export function filtrarContatos<T extends ContatoComEtiquetas>(
    contatos: T[], p?: { busca?: string; etiqueta?: string; semEtiqueta?: boolean }): T[];
