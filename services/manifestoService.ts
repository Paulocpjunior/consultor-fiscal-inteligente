/**
 * manifestoService.ts
 *
 * Cliente do endpoint /api/admin/sefaz/manifest-pending — dispara
 * Manifestacao do Destinatario (Ciencia 210210 por padrao) em lote pra
 * todos os resNFe pendentes na base.
 *
 * Caso de uso: NFes capturadas via DistDFe SEFAZ vem como RESUMO. Pra ter
 * o XML completo (procNFe com itens/totais), precisa manifestar. Esse
 * endpoint roda em lote — usuario admin clica uma vez e a base e atualizada.
 */

import { getAuth } from 'firebase/auth';

export type TipoManifestacao = 'ciencia' | 'confirmacao' | 'desconhecimento' | 'nao_realizada';

export interface ManifestarPendentesResult {
    total?: number;
    sucessos?: number;
    falhas?: number;
    puladas?: number;
    detalhes?: Array<{ chave: string; tipo: string; status: string; motivo?: string }>;
    dryRun?: boolean;
    erro?: string;
}

async function getToken(): Promise<string> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return u.getIdToken();
}

export async function manifestarPendentes({
    tipo = 'ciencia',
    limit = 100,
    dryRun = false,
    empresaId,
}: {
    tipo?: TipoManifestacao;
    limit?: number;
    dryRun?: boolean;
    empresaId?: string | null;
} = {}): Promise<ManifestarPendentesResult> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/manifest-pending', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, limit, dryRun, empresaId: empresaId || null }),
    });
    const data = await res.json();
    if (!res.ok) {
        return { erro: data.error || data.erro || `HTTP ${res.status}` };
    }
    return data;
}
