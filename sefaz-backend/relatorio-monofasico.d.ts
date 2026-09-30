export type ClasseReceita = 'tributada' | 'monofasica' | 'nao-tributada' | 'outras';

export interface LinhaMonofasico {
    tipo: 'saida' | 'devolucao';
    numero: string; chave: string; emissao: string;
    cnpjParticipante: string; nomeParticipante: string; ufParticipante: string;
    cfop: string; codigo: string; descricao: string; ncm: string;
    quantidade: number; valorItem: number; desconto: number; liquido: number; icms: number;
    cstPis: string; cstCofins: string; base: number; pis: number; cofins: number;
    classe?: ClasseReceita | null;
    pendencia?: 'ambigua' | 'sem-venda';
    origemClasse?: string;
}

export interface TotalClasse { itens: number; valor: number; base: number; pis: number; cofins: number }

export interface RelatorioMonofasico {
    linhas: LinhaMonofasico[];
    receitas: Record<ClasseReceita, TotalClasse>;
    devolucoes: Record<Exclude<ClasseReceita, 'outras'>, TotalClasse>;
    pendentes: TotalClasse;
    porNcm: Array<{ ncm: string; classes: string[]; saidas: number; devolucoes: number; itens: number; descricao: string }>;
    receitaLiquidaTributada: number;
    receitaLiquidaMonofasica: number;
    ajusteReducao: { base: number; pis: number; cofins: number };
    apurado: { pis: number; cofins: number };
    aRecolher: { pis: number; cofins: number };
    aliquotas: { pis: number; cofins: number };
    avisos: string[];
}

export const CLASSES_RECEITA: Readonly<Record<ClasseReceita, string>>;
export const PENDENCIAS_DEVOLUCAO: Readonly<Record<'ambigua' | 'sem-venda', string>>;
export function classeDoCstDeSaida(cst: unknown): ClasseReceita;
export function ehCfopDevolucaoDeVenda(cfop: unknown): boolean;
export function linhasDoPeriodo(dados: any): LinhaMonofasico[];
export function montarRelatorioMonofasico(
    linhas: LinhaMonofasico[],
    opts?: { aliquotas?: { pis: number; cofins: number } },
): RelatorioMonofasico;
export function csvDoRelatorio(rel: { linhas: LinhaMonofasico[] }): string;
