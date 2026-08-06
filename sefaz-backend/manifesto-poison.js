// ============================================================================
// sefaz-backend/manifesto-poison.js  (PURO — testável)
// ----------------------------------------------------------------------------
// A chave que falhou 8× sai do lote PRA SEMPRE (poison). Isso é certo enquanto
// a causa existe — insistir só queima requisição na SEFAZ. Mas quando a causa é
// CORRIGIDA (certificado renovado, cadastro arrumado, procuração assinada), não
// havia nenhum caminho de volta: o documento ficava fora do lote para sempre e
// o colaborador via "6× Desistimos após 8 falhas" sem nada a fazer (caso KJM,
// 05/08).
//
// Regra que manda aqui: liberar NÃO é "limpar tudo". Erro de INFRA já se
// autolimpa (resetarFalhasInfraManifestacao); o que esta liberação trata é o
// poison de causa HUMANA/CADASTRAL, e ela só faz sentido DEPOIS de corrigida a
// causa — por isso a resposta devolve os motivos liberados, para a tela dizer
// o que exatamente volta a ser tentado em vez de prometer conserto.
// ============================================================================

/** Mesmo teto do listarElegiveis (reexportado lá, pra não duplicar valor). */
export const MAX_FALHAS_MANIFESTACAO = 8;

/**
 * Falha de AMBIENTE (TLS/rede) — não é recusa da SEFAZ e não pode envenenar a
 * chave (caso 24/07: host errado gerou 486× "unable to get local issuer
 * certificate" e tirou do lote chaves perfeitamente manifestáveis).
 *
 * Mora aqui, no módulo puro, porque o orquestrador carrega firebase-admin: quem
 * define o predicado é o lado testável, e o orquestrador reexporta.
 */
export function ehErroInfra(motivo) {
    return /unable to (get|verify) (local )?issuer|self.signed|certificate|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|timeout|network/i
        .test(String(motivo || ''));
}

const motivoDe = (doc) => String(doc?.ultimaFalhaManifestacaoMotivo || '').trim() || 'motivo não registrado';

/**
 * O documento está envenenado (fora do lote) e pode voltar?
 *
 * Só entra quem BATEU no teto. Documento com 3 falhas continua no lote sozinho
 * — liberar ali não adianta nada e mascara o cooldown, que existe de propósito.
 */
export function estaEnvenenado(doc, max = MAX_FALHAS_MANIFESTACAO) {
    return Number(doc?.manifestacaoFalhas || 0) >= max;
}

/**
 * Quais chaves voltam ao lote, e por qual motivo estavam fora.
 *
 * @param {Array} docs   documentos da empresa (ou do escopo pedido)
 * @param {{max?: number}} [opts]
 */
export function planejarLiberacao(docs, opts = {}) {
    const max = Number(opts.max) || MAX_FALHAS_MANIFESTACAO;
    const liberar = [];
    const porMotivo = {};
    let infra = 0;

    for (const d of docs || []) {
        if (!estaEnvenenado(d, max)) continue;
        const motivo = motivoDe(d);
        // Erro de infra tem trilho próprio (reset automático) — contar à parte
        // evita a leitura errada de que "a rede estava ruim" é causa corrigida
        // por alguém.
        if (ehErroInfra(motivo)) infra++;
        porMotivo[motivo] = (porMotivo[motivo] || 0) + 1;
        liberar.push(d);
    }

    return { liberar, total: liberar.length, porMotivo, infra };
}

/**
 * Frase honesta do resultado. Nunca promete que vai dar certo: o que a
 * liberação faz é devolver a chave ao lote — quem decide é a SEFAZ, na próxima
 * janela do cron.
 */
export function resumirLiberacao(plano) {
    if (!plano || !plano.total) {
        return 'Nenhuma chave envenenada nesta empresa — não há o que liberar. '
            + 'Se ainda falta nota, o motivo é outro (cooldown, idade ou já manifestada).';
    }
    const motivos = Object.entries(plano.porMotivo)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([m, q]) => `${q}× ${m}`);
    const infra = plano.infra
        ? ` ${plano.infra} delas falharam por REDE/TLS e voltariam sozinhas.`
        : '';
    return `${plano.total} chave(s) voltaram ao lote (estavam fora por: ${motivos.join(' · ')}).${infra}`
        + ' A próxima rodada do cron tenta de novo — se a causa não foi corrigida, elas falham igual.';
}
