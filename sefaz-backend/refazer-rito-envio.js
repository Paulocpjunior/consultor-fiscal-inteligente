// ============================================================================
// sefaz-backend/refazer-rito-envio.js  (PURO — testável)
// ----------------------------------------------------------------------------
// ♻️ REFAZER O RITO DE UM ENVIO JÁ REGISTRADO.
//
// ═══ POR QUE ELE PRECISOU NASCER ════════════════════════════════════════════
//
// 28/08, Paulo, na VINCENZO GUERRA: *"Já criei a pasta e continua assim, o que
// eu faço?"*.
//
// O status do rito é um **CARIMBO HISTÓRICO**: `sharePoint: {status}` e
// `baixa: {status}` são gravados no INSTANTE do envio e nunca mais mudam.
// Consertar a causa depois — cadastrar a pasta, gerar a tarefa que faltava,
// corrigir o tenant do proxy — **não move o carimbo**. Ou seja: o mês que
// travou hoje continuaria travado para sempre, e a única saída oferecida era
// reenviar a guia ao cliente, que duplica a cobrança.
//
// 🚨 **ISTO NÃO É "MARCAR COMO FEITO".** Nada aqui carimba nada à mão: o
// módulo decide o que PODE ser tentado de novo, e quem responde continua sendo
// o SharePoint (o upload de verdade) e a coleção `tarefas` (a baixa de
// verdade). Se falhar outra vez, o registro passa a dizer o novo motivo — que
// é mais informativo que o antigo, e não menos.
//
// ═══ O QUE NÃO SE REFAZ, E POR QUÊ ══════════════════════════════════════════
//
//  · `arquivado` / `baixada` / `ja-baixada` — já fecharam. Tentar de novo
//    subiria o mesmo arquivo duas vezes, ou procuraria tarefa que já concluiu.
//  · `sem-pdf` — desfecho LEGÍTIMO (envio sem anexo, como o aviso de guia já
//    paga). Não há o que arquivar, e "refazer" ali é prometer o que não existe.
//
// ⚠️ E o PDF **não fica guardado no registro do envio** (`anexouPdf` é só um
// booleano). Sem ele o arquivamento não se refaz — quem tem o arquivo é a
// coleção da guia. Isso NÃO vira silêncio: o resultado diz que o PDF não foi
// recuperado, e a baixa é refeita mesmo assim, porque ela não depende dele.
// ============================================================================

/** Status de SharePoint que já fecharam ou não pedem arquivo. */
const SHAREPOINT_FECHADO = new Set(['arquivado', 'sem-pdf']);
/** Status de baixa que já fecharam. */
const BAIXA_FECHADA = new Set(['baixada', 'ja-baixada']);

/**
 * O que dá para tentar de novo neste envio?
 *
 * @param {object} envio doc de `impostos_enviados`
 * @returns {{sharePoint: boolean, baixa: boolean, nada: boolean, motivos: string[]}}
 */
export function oQueRefazer(envio) {
    const sp = String(envio?.sharePoint?.status || '');
    const bx = String(envio?.baixa?.status || '');
    const motivos = [];

    // ⚠️ SEM REGISTRO é diferente de FECHADO: auditoria anterior ao rito #293
    // não guarda o resultado, e ali refazer é justamente o que descobre o
    // estado real. Por isso `!sp` entra como refazível.
    const sharePoint = !SHAREPOINT_FECHADO.has(sp);
    const baixa = !BAIXA_FECHADA.has(bx);

    if (!sharePoint) {
        motivos.push(sp === 'arquivado'
            ? 'A cópia já está na pasta IMPOSTOS — não há o que refazer.'
            : 'Envio sem anexo (não há arquivo para arquivar) — desfecho legítimo.');
    }
    if (!baixa) {
        motivos.push(bx === 'baixada'
            ? 'A obrigação já foi baixada.'
            : 'A obrigação já estava concluída quando o envio foi registrado.');
    }

    return { sharePoint, baixa, nada: !sharePoint && !baixa, motivos };
}

/**
 * O registro atualizado depois de uma tentativa — **com HISTÓRICO**.
 *
 * 🚨 O estado ANTERIOR não se perde. Sem ele, "por que este envio dizia
 * `sem-config` e agora diz `arquivado`?" não tem resposta daqui a três meses —
 * e é justamente a pergunta que alguém vai fazer ao conferir a competência.
 *
 * @param {object} p
 * @param {object} p.envio       como está hoje
 * @param {object|null} p.sharePoint  novo resultado, ou null se não foi tentado
 * @param {object|null} p.baixa       idem
 * @param {string} p.quem
 * @param {string} p.agoraIso
 */
export function patchDoRefazer({ envio, sharePoint, baixa, quem, agoraIso }) {
    const patch = {};
    const antes = {};
    const depois = {};

    if (sharePoint) {
        antes.sharePoint = envio?.sharePoint || null;
        depois.sharePoint = sharePoint;
        patch.sharePoint = sharePoint;
    }
    if (baixa) {
        antes.baixa = envio?.baixa || null;
        depois.baixa = baixa;
        patch.baixa = baixa;
    }
    if (!sharePoint && !baixa) return null;

    const historico = Array.isArray(envio?.ritoRefeito) ? envio.ritoRefeito : [];
    patch.ritoRefeito = [
        ...historico.slice(-9),   // guarda as 10 últimas — log não vira arquivo
        { em: agoraIso, por: quem || null, antes, depois },
    ];
    return patch;
}

/**
 * A frase do resultado, para a tela e para o log.
 *
 * ⚠️ Ela DIZ o que não deu, nunca só o que deu — "1 refeito" sobre uma rodada
 * em que o arquivamento falhou de novo seria a meia-verdade de sempre.
 */
export function textoDoRefazer(r) {
    const partes = [];
    if (r?.sharePoint) {
        partes.push(r.sharePoint.status === 'arquivado'
            ? '✓ cópia gravada na pasta IMPOSTOS'
            : `✗ arquivamento ainda falha (${r.sharePoint.status}${r.sharePoint.motivo ? `: ${r.sharePoint.motivo}` : ''})`);
    }
    if (r?.baixa) {
        partes.push(['baixada', 'ja-baixada'].includes(r.baixa.status)
            ? '✓ obrigação baixada'
            : `✗ baixa ainda falha (${r.baixa.status}${r.baixa.motivo ? `: ${r.baixa.motivo}` : ''})`);
    }
    if (r?.pdfIndisponivel) {
        partes.push('⚠ o PDF da guia não foi recuperado — o arquivamento não pôde ser tentado. '
            + 'O registro do envio não guarda o arquivo; reenviar a guia pelo app refaz o rito inteiro.');
    }
    if (!partes.length) return 'Nada a refazer neste envio.';
    return partes.join(' · ');
}
