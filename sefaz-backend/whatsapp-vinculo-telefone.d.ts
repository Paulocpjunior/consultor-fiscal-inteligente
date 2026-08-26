// Tipos do cruzamento número ↔ cadastro. O `.js` é o dono; este arquivo anda
// junto no MESMO PR (regra de 20/08 — tipo e implementação são duas
// declarações do mesmo fato e divergem em silêncio se andarem separadas).
export function formasDoNumero(bruto: unknown): string[];

export interface TelefoneDaEmpresa {
    /** Qual campo do cadastro trouxe o número — vai carimbado na sugestão. */
    campo: 'whatsappCliente' | 'telefone';
    forma: string;
}
export function telefonesDaEmpresa(empresa?: Record<string, any>): TelefoneDaEmpresa[];

export interface ConversaParaCruzar {
    numero: string;
    nome?: string | null;
    fila?: string | null;
    canal?: string | null;
}
export interface EmpresaParaCruzar {
    id: string;
    nome?: string | null;
    razaoSocial?: string | null;
    dadosFiscais?: Record<string, any> | null;
    [k: string]: any;
}
export interface Sugestao {
    numero: string;
    /** Nome do CONTATO (quem escreveu) — nunca o do cliente. */
    nome: string | null;
    fila: string | null;
    empresaId: string;
    /** Nome do cliente no cadastro. */
    nomeEmpresa: string;
    campo: 'whatsappCliente' | 'telefone';
}
export interface CruzamentoVinculo {
    total: number;
    empresasComNumero: number;
    sugestoes: Sugestao[];
    ambiguos: { numero: string; nome: string | null; fila: string | null; candidatos: { empresaId: string; nomeEmpresa: string; campo: string }[] }[];
    semCadastro: { numero: string; nome: string | null; fila: string | null }[];
    /** Sem telefone legível — DM do Instagram, por exemplo. Não é lacuna de vínculo. */
    semNumeroLegivel: { numero: string; nome: string | null; canal: string | null }[];
}

export function cruzarNumerosComCadastro(p?: {
    conversas?: ConversaParaCruzar[];
    empresas?: EmpresaParaCruzar[];
}): CruzamentoVinculo;

export function sugestaoParaNumero(
    numero: string,
    empresas?: EmpresaParaCruzar[],
): { situacao: 'sugerida'; empresaId: string; nomeEmpresa: string; campo: string; numero: string; nome: string | null; fila: string | null }
    | { situacao: 'ambigua'; candidatos: { empresaId: string; nomeEmpresa: string; campo: string }[] }
    | { situacao: 'sem-cadastro' };
