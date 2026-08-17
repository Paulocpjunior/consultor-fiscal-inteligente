// Tipos dos direitos do titular (LGPD art. 18) — o dono é o .js.
export interface GuardaObrigatoria { id: string; rotulo: string; motivo: string }
export const GUARDA_OBRIGATORIA: GuardaObrigatoria[];

export interface RelatorioTitular {
    numero: string;
    geradoEm: string | null;
    temCadastro: boolean;
    cadastro: { nome: string | null; empresaVinculada: string | null; origem: string | null; criadoEm: string | null; observacao: string | null } | null;
    etiquetas: { id: string; rotulo: string; finalidade: string; baseLegal: string | null }[];
    consentimentos: { etiqueta: string; registradoEm: string | null; como: string | null; revogadoEm: string | null }[];
    conversa: { fila: string | null; situacao: string | null; ultimaAtualizacao: string | null } | null;
    mensagens: { total: number; itens: { em: string | null; direcao: string | null; tipo: string | null; texto: string | null; temAnexo: boolean }[] };
    enviosDeGuia: { total: number; itens: { tipo: string | null; competencia: string | null; em: string | null; canal: string | null }[] };
    guardaObrigatoria: GuardaObrigatoria[];
}

export interface PlanoEliminacao {
    numero: string;
    remove: { item: string; quantidade: number }[];
    mantem: { item: string; motivo: string }[];
    nadaARemover: boolean;
    aviso: string;
}

export function montarRelatorioTitular(p: {
    numero: string; contato?: any; conversa?: any; mensagens?: any[]; envios?: any[]; catalogoEtiquetas?: any[];
}): RelatorioTitular;

export function planoDeEliminacao(p: {
    numero: string; contato?: any; mensagens?: number; envios?: number;
}): PlanoEliminacao;

export function registroDaSolicitacao(p: {
    numero: string; tipo: 'acesso' | 'eliminacao'; quem: string; em: string;
    plano?: PlanoEliminacao | null; motivoDoTitular?: string | null;
}): { ok: true; registro: Record<string, unknown> } | { ok: false; erro: string };
