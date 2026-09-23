/**
 * retencaoAjusteService — porta do AJUSTE de retenção declarado.
 *
 * ═══ O CASO ════════════════════════════════════════════════════════════════
 *
 * Paulo, 04/09, FRONTINI ENGENHEIROS (NFS-e EMITIDAS, 08/2026): *"ele esqueceu
 * de informar as retenções de 2 notas, já informei que tem que fazer a carta de
 * correção, como eu faço agora no consultor? incluir um campo para informar
 * manual?"*
 *
 * As notas **já estão capturadas** do portal, com retenção ZERO — não é caso de
 * digitar a nota de novo, é de acrescentar um número a um documento que existe.
 * E corrigir no portal não resolve o lado do CFI: a captura já trouxe o zero.
 *
 * 🚨 **NADA AQUI É RÉGUA NOVA.** O ajuste declarado existe desde 31/08
 * (`retencao-pj-ajuste.js`, caso ATLAS), com autor, motivo escrito e origem
 * carimbada — e a rota que grava é a MESMA do R-4020. O que faltava era a
 * PORTA para a nota EMITIDA: aquela tela lista serviços TOMADOS, e a FRONTINI é
 * a prestadora. Uma segunda coleção aqui faria o SPED e o REINF lerem ajustes
 * diferentes sobre a mesma nota.
 *
 * ⚠️ A rota exige **admin do CFI** (ou o túnel do Contábil) — é a autorização
 * que ela já tinha, e afrouxá-la mudaria quem pode alterar valor de declaração
 * fiscal. Isso é decisão do dono, não efeito colateral desta porta.
 */

import { getAuth } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebaseConfig';
import { idAjustesDaCompetencia } from '../sefaz-backend/retencao-pj-ajuste.js';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada — saia e entre de novo.');
    return { Authorization: `Bearer ${await u.getIdToken()}`, 'Content-Type': 'application/json' };
}

export interface AjusteRetencaoInput {
    /** CNPJ da EMPRESA (a do CFI) — é por ele que o ajuste é agrupado. */
    cnpj: string;
    /** Competência AAAA-MM. */
    competencia: string;
    /** Chave da nota, ou `prestadorCnpj-numero` quando não há chave. */
    chave: string;
    base?: number | string | null;
    ir?: number | string | null;
    pis?: number | string | null;
    cofins?: number | string | null;
    csll?: number | string | null;
    inss?: number | string | null;
    /** Obrigatório, com piso de 15 caracteres — quem lê daqui a 3 meses precisa. */
    motivo: string;
}

/** Declara a retenção de UMA nota. Incremental: não mexe nas outras. */
export async function gravarAjusteRetencao(i: AjusteRetencaoInput): Promise<void> {
    const r = await fetch('/api/admin/reinf/retencoes-pj/ajuste', {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify(i),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) {
        throw new Error(j?.error || `Falha ao gravar o ajuste (HTTP ${r.status}).`);
    }
}

/**
 * ↩ Desfaz: a nota volta ao que o DOCUMENTO diz.
 *
 * Existe porque decisão que muda valor de declaração precisa de caminho de
 * volta — a lição do ✕ do FUNRURAL (14/08), em que o botão tirava do total e
 * levava junto o único jeito de reverter.
 */
export async function removerAjusteRetencao(
    i: Pick<AjusteRetencaoInput, 'cnpj' | 'competencia' | 'chave'>,
): Promise<void> {
    const r = await fetch('/api/admin/reinf/retencoes-pj/ajuste', {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({ ...i, remover: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) {
        throw new Error(j?.error || `Falha ao desfazer o ajuste (HTTP ${r.status}).`);
    }
}

/**
 * 🚨 O QUE FOI INFORMADO NESTA COMPETÊNCIA — a leitura que faltava.
 *
 * O CASO (04/09, FRONTINI ENGENHEIROS, notas 794 e 795): o painel da nota só
 * GRAVAVA. Quem informava a retenção reabria a nota, via os campos vazios e o
 * Relatório de Retenções mostrando o zero do documento — e concluía, com toda
 * razão, que *"não ficou salvo"*. O ajuste ESTAVA gravado; o que não existia
 * era quem o lesse de volta.
 *
 * É a família do `saldoCredorIpiAnterior` (19/08) — régua que só escreve, ou
 * campo que um lado grava e nenhum lado lê.
 *
 * ⚠️ **FALHA DE LEITURA NÃO VIRA "NÃO HÁ AJUSTE"**: devolver `{}` mostraria o
 * valor do DOCUMENTO — justamente o número errado que o ajuste corrigiu. Ela
 * LANÇA, e quem chama tem de dizer isso na tela. É a mesma régua que o
 * orquestrador do F600 já aplica.
 */
export async function lerAjustesDaCompetencia(
    cnpj: string,
    competencia: string,
): Promise<Record<string, any>> {
    const id = idAjustesDaCompetencia(cnpj, competencia);
    if (!/^\d{14}_\d{6}$/.test(id)) return {};
    try {
        const snap = await getDoc(doc(db, 'reinf_retencoes_ajustadas', id));
        return snap.exists() ? ((snap.data() as any)?.ajustes || {}) : {};
    } catch (e: any) {
        throw new Error('Não consegui ler as retenções informadas desta competência. '
            + 'Sem elas a lista mostraria o valor do documento, que pode ser o errado — '
            + 'recarregue antes de conferir ou transmitir.');
    }
}
