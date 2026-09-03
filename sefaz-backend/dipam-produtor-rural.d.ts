export interface AliquotasFunrural {
    desde: string;
    inss: number;
    gilrat: number;
    senar: number;
    fonte: string;
    revisar: boolean;
}

export interface NaturezaFornecedor {
    ehProdutorRuralPF: boolean;
    confianca: 'confirmada' | 'alta' | 'media' | 'indefinida';
    sinais: string[];
    motivo: string;
}

export interface PendenciaDipam {
    codigo: string;
    mensagem: string;
    acao: string;
}

export interface CalculoFunrural {
    base: number;
    aliquotas: { inss: number; gilrat: number; senar: number };
    percentualTotal: number;
    inss: number;
    gilrat: number;
    senar: number;
    total: number;
    fonte: string;
    revisar: boolean;
}

export const CODIGOS_DIPAM: Record<string, string>;
export const UF_DIPAM: string;
export const CFOPS_COMPRA: Set<string>;
export const CFOPS_DEVOLUCAO: Set<string>;
export const CFOPS_NAO_LANCAR: Record<string, string>;
export const ALIQUOTAS_FUNRURAL_PF: AliquotasFunrural[];
export const ALIQUOTAS_FUNRURAL_SEGURADO_ESPECIAL: AliquotasFunrural[];
export function tabelaDoProdutor(cadastro: any, tabelaPadrao?: AliquotasFunrural[]): AliquotasFunrural[];

export function ehIeProdutorRuralSP(ie: unknown): boolean;
export function ehNcmAgropecuario(ncm: unknown): boolean;
export function ehMunicipioPaulista(codMunIBGE: unknown): boolean;
export function aliquotasFunruralVigentes(competencia: string, tabela?: AliquotasFunrural[]): AliquotasFunrural;
export function parseValorLivre(txt: unknown): number | null;
export function extrairFunruralDeclarado(infAdic: unknown): { percentual: number | null; valor: number | null; trecho: string } | null;
export function calcularFunrural(base: unknown, competencia: string, tabela?: AliquotasFunrural[]): CalculoFunrural;
export function identificarNaturezaFornecedor(participante: any, cadastro?: any): NaturezaFornecedor;
/** Normaliza a FORMA do doc: monta emitente/destinatario a partir dos campos
 *  chatos (cnpjEmit/cnpjDest/ieDest/…) do importer principal quando o aninhado
 *  não veio. Idempotente. */
export function normalizarParticipantesDoc(doc: any): any;
export function classificarNota(doc: any, opts?: { cadastro?: any; empresa?: any; tabelaFunrural?: AliquotasFunrural[] }): any;
export function montarDipamCompetencia(p: {
    documentos?: any[];
    competencia: string;
    empresa?: any;
    fornecedores?: Record<string, any>;
    tabelaFunrural?: AliquotasFunrural[];
}): any;
export function farolDipam(p: { total: number; notas: number; bloqueantes: number; pendencias: number; funruralNotas: number }):
    { cor: 'ok' | 'atencao' | 'falha' | 'neutro'; resumo: string };
export function montarRegistro1400(municipios?: Array<{ codMunIBGE: string; valor: number; registro1400?: string }>):
    Array<{ registro: string; codItemIpm: string; mun: string; valor: number; linha: string }>;

/**
 * Dedup do art. 136: a compra de produtor rural tem DUAS notas da mesma
 * entrada (a NF-e do produtor e a nota própria de entrada do adquirente), e só
 * a segunda se escritura — RICMS/SP art. 136, I, "a"; RC 33068/2025.
 *
 * A NF-e do produtor só sai quando EXISTE a nota de entrada que a cobre:
 * produtor sem par fica intacto, porque a dedup desfaz duplicidade, não impõe
 * processo.
 */
export function dedupNotaProdutorComEntrada(notas: any[]): any[];

/**
 * Produtores tirados da sub-rogação por DECISÃO gravada no cadastro, com o
 * quanto voltaria ao total se ela for desfeita.
 */
export function agruparTiradosPorDecisao(
    notas: any[],
    competencia: string,
    tabelaFunrural?: AliquotasFunrural[],
): Array<{
    doc: string | null;
    fornecedor: string | null;
    decisao: 'nao_aplica' | 'folha';
    rotulo: string;
    reversivelNaLinha: boolean;
    notas: number;
    valor: number;
    funruralPotencial: number;
}>;

/**
 * O documento É de serviço? Reconhece pelo que ele É (tipo nfse/cte, modelo
 * 57/67, blocos prestador/tomador, código de serviço municipal) — NUNCA pelo
 * `modeloDoDoc`, que cai em '55' quando o campo não foi gravado e faria a
 * NFS-e passar por NF-e. Serviço nunca é produção rural (FUNRURAL).
 */
export function ehDocumentoDeServico(d: any): boolean;

/**
 * Esta NOTA foi tirada do FUNRURAL por decisão gravada?
 *
 * É a decisão da NOTA, não do produtor — quem responde pelo produtor inteiro
 * continua sendo `cadastro.funrural`. Sem chave devolve false: documento sem
 * chave legível não pode ser casado com decisão nenhuma.
 */
export function notaForaDoFunruralPorDecisao(
    cadastro: unknown,
    chave: string | null | undefined,
): boolean;

// 03/09 (auditoria): exportações que o .js já entregava e o .d.ts não declarava —
// importador TypeScript não enxergava o símbolo (erro de compilação).
export function ehCfopCompraProducao(cfop: unknown): boolean;
export function percentualFunruralVigente(competencia: string, opts?: any): any;
export function tipoSocietarioNoNome(nome: unknown): string | null;
