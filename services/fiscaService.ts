import { auth } from './firebaseConfig';

export interface FiscaMensagem { role: 'user' | 'assistant'; text: string }
export interface FiscaResposta {
    texto: string;
    fontes: { titulo: string; url: string }[];
    contexto: {
        empresa: { id: string; nome: string; cnpj: string; uf: string; origem: string } | null;
        competencia: string | null;
        consultadoEm: string;
        fonteCadastro: string | null;
        acervo: {
            registrosConsultados: number; limitado: boolean; limite: number;
            status: Record<string, number>; semDirecao: string[]; retirados: string[];
            possiveisRepeticoes: string[][]; escopo: string;
        } | null;
    };
}
export async function consultarFisca(pedido: {
    mensagem: string; empresaId?: string; fonte?: 'simples' | 'lucro';
    competencia?: string; analisarAcervo: boolean; historico: FiscaMensagem[];
}, signal: AbortSignal): Promise<FiscaResposta> {
    const token = await auth?.currentUser?.getIdToken();
    if (!token) throw new Error('Sua sessão expirou. Entre novamente para conversar com a Físca.');
    const response = await fetch('/api/fiscal/fisca', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(pedido),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || 'Não foi possível consultar a Físca. Tente novamente.');
    if (!data || typeof data.texto !== 'string' || !data.contexto || !Array.isArray(data.fontes)) throw new Error('A resposta da Físca veio incompleta. Tente novamente.');
    return data as FiscaResposta;
}
