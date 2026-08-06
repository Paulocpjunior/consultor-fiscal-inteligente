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
    /** Por que NADA foi manifestado — motivo → quantidade (só quando total=0). */
    diagnostico?: {
        /** Onde a chave parou: poison, cooldown, idade, já manifestada. */
        porMotivo?: Record<string, number>;
        /** O QUE a SEFAZ (ou o certificado) respondeu — motivo técnico. */
        porMotivoFalha?: Record<string, number>;
        ultimaFalha?: string | null;
        documentos?: number;
    };
}

/**
 * Frase honesta pro toast. "0 manifestadas" sem motivo é o tipo de resposta
 * que faz o colaborador clicar de novo achando que foi lentidão.
 */
export function resumoManifestacao(r: ManifestarPendentesResult): string {
    if (r.erro) return `Falha ao manifestar: ${r.erro}`;
    if (r.total) {
        return `Ciência manifestada: ${r.sucessos || 0} de ${r.total} resumo(s).`
            + (r.falhas ? ` ${r.falhas} falharam.` : '')
            + ' O XML completo (com os produtos) chega na PRÓXIMA captura — depois, clique em Reconferir.';
    }
    const motivos = Object.entries(r.diagnostico?.porMotivo || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([m, q]) => `${q}× ${m}`);
    if (!motivos.length) return 'Nenhum documento pendente de manifestação nesta empresa.';
    // O motivo TÉCNICO é o que resolve: "Rejeição 573" e "certificado vencido"
    // pedem ações diferentes, e nenhuma delas é clicar de novo.
    const falhas = Object.entries(r.diagnostico?.porMotivoFalha || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([m, q]) => `${q}× ${m}`);
    const causa = falhas.length
        ? ` Motivo da recusa: ${falhas.join(' · ')}.`
        : (r.diagnostico?.ultimaFalha ? ` Última falha: ${r.diagnostico.ultimaFalha}` : '');
    // Poison sem saída é o pior dos mundos: o motivo aparece e não há o que
    // fazer. Depois de corrigida a causa existe o "Tentar de novo" — a frase
    // precisa dizer isso, senão o botão continua invisível na prática.
    const saida = temChaveEnvenenada(r)
        ? ' Corrigiu a causa? Use "🔓 Tentar de novo" para devolver essas chaves ao lote.'
        : '';
    return `Nada a manifestar agora — ${motivos.join(' · ')}.${causa}${saida}`;
}

/**
 * Há chave envenenada (fora do lote depois de 8 falhas) neste diagnóstico?
 *
 * É o gatilho do "Tentar de novo": enquanto o motivo for cooldown ou idade,
 * clicar não adianta — só o poison precisa de alguém pra reabrir a porta.
 */
export function temChaveEnvenenada(r: ManifestarPendentesResult): boolean {
    return Object.keys(r.diagnostico?.porMotivo || {}).some(m => /desistimos após/i.test(m));
}

export interface LiberacaoPoisonResult {
    ok?: boolean;
    total?: number;
    porMotivo?: Record<string, number>;
    infra?: number;
    erro?: string;
}

/** Frase honesta: liberar devolve ao lote, não conserta a causa. */
export function resumoLiberacaoPoison(r: LiberacaoPoisonResult): string {
    if (r.erro) return `Falha ao liberar: ${r.erro}`;
    if (!r.total) {
        return 'Nenhuma chave envenenada nesta empresa — não há o que liberar. '
            + 'Se ainda falta nota, o motivo é outro (cooldown, idade ou já manifestada).';
    }
    const motivos = Object.entries(r.porMotivo || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([m, q]) => `${q}× ${m}`);
    return `${r.total} chave(s) voltaram ao lote (estavam fora por: ${motivos.join(' · ')}). `
        + 'A próxima rodada do cron tenta de novo — se a causa não foi corrigida, elas falham igual.';
}

export async function liberarPoisonManifestacao(empresaId: string): Promise<LiberacaoPoisonResult> {
    const token = await getToken();
    const res = await fetch('/api/admin/sefaz/manifest-liberar-poison', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId }),
    });
    const data = await res.json();
    if (!res.ok) return { erro: data.error || data.erro || `HTTP ${res.status}` };
    return data;
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
