/**
 * carteiraObservacoesService.ts — o recado do colaborador sobre um cliente.
 *
 * Vai pelo BACKEND de propósito: as subcoleções de empresa liberam escrita
 * pelo `createdBy` da empresa, e o colaborador que recebeu o cliente na
 * carteira quase nunca é quem cadastrou — ele ficaria sem escrever justamente
 * na tela que é o norte dele. A rota aplica o guard de carteira
 * (`podeAcessarEmpresaId`), o mesmo que protege a Rotina do mês.
 */
import { getAuth } from 'firebase/auth';

export interface ObservacaoCliente {
    texto: string;
    autorNome: string | null;
    atualizadoEm: string | null;
}

async function token(): Promise<string | null> {
    const u = getAuth().currentUser;
    return u ? u.getIdToken() : null;
}

/** Todas as observações da competência que o usuário pode ver. */
export async function carregarObservacoes(competencia: string): Promise<Record<string, ObservacaoCliente>> {
    const t = await token();
    if (!t) return {};
    const res = await fetch(`/api/admin/carteira/observacoes?competencia=${encodeURIComponent(competencia)}`, {
        headers: { Authorization: `Bearer ${t}` },
    });
    const data = await res.json().catch(() => ({}));
    // Falhar em ler observação NÃO pode derrubar o guia do mês: ela é um
    // complemento, e o resto da tela continua verdadeiro sem ela.
    if (!res.ok || !data.ok) return {};
    return data.observacoes || {};
}

/** Grava (ou APAGA, quando o texto vem vazio). */
export async function salvarObservacao(
    empresaId: string, competencia: string, texto: string,
): Promise<{ ok: boolean; error?: string; apagada?: boolean }> {
    const t = await token();
    if (!t) return { ok: false, error: 'Sessão expirada — entre novamente.' };
    const res = await fetch('/api/admin/carteira/observacoes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId, competencia, texto }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, apagada: !!data.apagada };
}
