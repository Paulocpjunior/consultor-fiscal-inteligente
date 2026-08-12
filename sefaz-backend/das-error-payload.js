import { sanitizeError } from './sanitize-error.js';

const RAW_ERROR_PATTERNS = [
    /"contratante"/i,
    /"autorPedidoDados"/i,
    /"contribuinte"/i,
    /"pedidoDados"/i,
    /\baccess[_-]?token\b/i,
    /\bSecret\b/i,
    /\bprojects\/[\w-]+\/secrets\//i,
    /\/(?:opt|home|root|var|tmp|usr)\/[\w./-]+/i,
];

function safeDasError(err) {
    if (err?.code === 'SERPRO_RETRYABLE_ERROR') {
        return { error: err.serproMessage || err.message || 'SERPRO indisponivel no momento.' };
    }

    // MENSAGEM ESCRITA POR NÓS PRO USUÁRIO PASSA INTEIRA (12/08).
    //
    // O sanitizador existe pra esconder VAZAMENTO — token, caminho de arquivo,
    // payload cru do SERPRO. Ele corta por tamanho (>300) porque mensagem longa
    // costuma ser stack trace ou dump. Só que o app também produz mensagens
    // longas DE PROPÓSITO: a recusa da declaração sem movimento, por exemplo,
    // tem 485 caracteres porque diz o motivo E a ação ("entregue no e-CAC pra
    // não correr a MAED; mande o extrato pra destravar o botão").
    //
    // O que o Paulo viu em 12/08: "Não foi possível declarar: Erro interno
    // (ref d65adb41)". A orientação inteira foi apagada por ser comprida — e o
    // colaborador ficou sem saber que precisa entregar no e-CAC. Sanitizador
    // que engole a AÇÃO é pior que erro nenhum: some a única coisa acionável.
    //
    // `mensagemUsuario` é o carimbo de "isto foi redigido para ser lido".
    // Quem monta o erro é responsável por não pôr segredo aí dentro.
    if (err?.mensagemUsuario) return { error: String(err.mensagemUsuario) };

    const raw = err?.serproMessage || err?.message || 'Falha ao processar DAS';
    const shouldSanitize = raw.length > 300 || RAW_ERROR_PATTERNS.some((pattern) => pattern.test(raw));
    return shouldSanitize ? sanitizeError(err) : { error: raw };
}

export function errorPayload(err) {
    const safe = safeDasError(err);
    const payload = {
        error: safe.error,
        code: err?.code,
    };
    if (safe.requestId) payload.requestId = safe.requestId;
    if (err?.retryable) payload.retryable = true;
    if (Array.isArray(err?.serproMessages) && err.serproMessages.length > 0) {
        payload.serproMessages = err.serproMessages;
        payload.error = err.serproMessage || payload.error;
    }
    if (err?.status) payload.serproStatus = err.status;
    if (err?.valorSerpro != null) payload.valorSerpro = err.valorSerpro;
    if (err?.valorApp != null) payload.valorApp = err.valorApp;
    if (err?.diferenca != null) payload.diferenca = err.diferenca;
    if (err?.dasExistenteId) payload.dasExistenteId = err.dasExistenteId;
    if (err?.dasExistenteTipo) payload.dasExistenteTipo = err.dasExistenteTipo;
    if (err?.dasExistenteStatus) payload.dasExistenteStatus = err.dasExistenteStatus;
    return payload;
}
