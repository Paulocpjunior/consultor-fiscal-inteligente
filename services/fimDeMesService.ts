/**
 * 🔒 DAR FIM DE MÊS — porta do frontend.
 *
 * Paulo, 26/08: *"o fechamento do fim do mês no CFI exige (DAR FIM DE MÊS);
 * essa função é que deve ser usada como régua para nos nortear, usar como base
 * p impostos, livros, ficha financeira, exatamente o que o CCI deve usar como
 * base para importação do contábil"*.
 *
 * ⚠️ **AQUI NÃO MORA REGRA NENHUMA.** A pré-condição (etapa aberta BLOQUEIA), a
 * versão e o direito de reabrir vivem no backend, em `fim-de-mes.js`. Uma cópia
 * da régua na tela seria contornável — e pior, divergiria: a tela diria "pode
 * fechar" e o botão recusaria. A tela só EXIBE o que o backend respondeu.
 */
import { getAuth } from 'firebase/auth';

export interface BloqueioFimDeMes {
    id: string;
    ordem: number;
    nome: string;
    status: string;
    resumo: string | null;
    acao: string | null;
    onde: string | null;
    /**
     * Declarar um envio feito por fora resolve ESTE bloqueio? É false quando o
     * app JÁ enviou a guia e o que falta é o rito (a cópia na pasta) — ali
     * declarar outro envio não fecha nada e convida a declarar o que o app fez.
     * `null` em bloqueio que não é de guia.
     */
    podeDeclararEnvio?: boolean | null;
    /**
     * Declarar a entrega por fora resolve ESTE bloqueio? Só é true quando o que
     * trava é obrigação que o catálogo admite não cobrir (o INSS patronal da
     * MANTOAN, que depende da folha e vive no módulo de DP). Regime indefinido,
     * prazo de outra UF e UF ausente TÊM conserto — ali a porta não aparece.
     */
    podeDeclararCobertura?: boolean | null;
    /** As obrigações fora do catálogo, NOMEADAS — é o que a declaração cobre. */
    propostas?: string[] | null;
    /**
     * As causas do rito, nomeadas pelo dono do painel de envios ("Empresa sem
     * pasta do SharePoint", "Sem obrigação correspondente na aba Vencimentos").
     * `null` fora da etapa 5.
     */
    causas?: string[] | null;
}

export interface FechamentoCompetencia {
    empresaId: string;
    competencia: string;
    estado: 'fechada' | 'reaberta';
    versao: number;
    fechadoEm: string;
    fechadoPor: { uid: string | null; email: string | null; nome: string | null } | null;
    corte: {
        instante: string;
        ultNSU: number | null;
        maxNSU: number | null;
        documentos: { entradas: number; saidas: number; total: number };
    } | null;
    apurado: Record<string, number | null>;
    lastro: { situacao: string; cor: string; mensagem: string; acao: string | null } | null;
    reaberturas: Array<{ em: string; por: string | null; motivo: string; versaoReaberta: number }>;
}

export interface SituacaoFimDeMes {
    ok: boolean;
    erro?: string;
    competencia?: string;
    precondicao?: { pode: boolean; bloqueios: BloqueioFimDeMes[]; motivo: string | null };
    fechamento?: FechamentoCompetencia | null;
    descricao?: { estado: 'aberta' | 'fechada' | 'reaberta'; texto: string };
}

async function chamar(caminho: string, init?: RequestInit): Promise<any> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, erro: 'Sessão expirada — entre novamente.' };
    const token = await u.getIdToken();
    const res = await fetch(`/api/admin/fim-de-mes${caminho}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init?.headers || {}),
        },
    });
    const data = await res.json().catch(() => ({}));
    // A recusa do backend vem COM os bloqueios nomeados — repassar só o texto
    // faria a tela perder justamente o que diz onde resolver.
    if (!res.ok) return { ok: false, erro: data.erro || `HTTP ${res.status}`, bloqueios: data.bloqueios || [] };
    return data;
}

export const situacaoFimDeMes = (empresaId: string, competencia: string): Promise<SituacaoFimDeMes> =>
    chamar(`/situacao?empresaId=${encodeURIComponent(empresaId)}&competencia=${encodeURIComponent(competencia)}`);

export const darFimDeMes = (empresaId: string, competencia: string) =>
    chamar('/fechar', { method: 'POST', body: JSON.stringify({ empresaId, competencia }) });

/** Só admin — a régua está no backend; aqui é a chamada. */
export const reabrirCompetencia = (empresaId: string, competencia: string, motivo: string) =>
    chamar('/reabrir', { method: 'POST', body: JSON.stringify({ empresaId, competencia, motivo }) });
