export type UsoPlanoContas = 'receita-vendas' | 'receita-servicos' | 'compras' | 'servicos-tomados' | 'receita-financeira';
export interface ContaPlanoSped { codigo: string; nome: string; nivel: string; natureza?: string; uso: UsoPlanoContas }
export const USOS_PLANO_CONTAS: Readonly<Record<UsoPlanoContas, { rotulo: string; onde: string; naturezaPadrao: string }>>;
export const NATUREZAS_CONTA: Readonly<Record<string, string>>;
export function conferirPlanoContasSped(lista: unknown): { ok: boolean; erros: string[]; contas: Array<Required<ContaPlanoSped>> };
export function contaDoUso(plano: unknown, uso: UsoPlanoContas): Required<ContaPlanoSped> | null;
export function contas0500DoPlano(args: { plano?: unknown; ano?: string; legadoReceitaFinanceira?: { codigo?: string; nome?: string; nivel?: string } | null }): Array<{ dtAlt: string; codNatCc: string; indCta: 'A'; nivel: string; codCta: string; nomeCta: string; uso: string }>;
export function criarSeletorDeConta(plano: unknown): { codCta(uso: UsoPlanoContas): string; aviso(): string | null; porUso: Record<string, number> };
export function criarContagemSemConta(): { registrar(uso: string): void; aviso(): string | null; porUso: Record<string, number> };
