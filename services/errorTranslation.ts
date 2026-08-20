/**
 * services/errorTranslation.ts
 *
 * Traduz mensagens cripticas das APIs (Gemini, fetch, Firebase) em
 * mensagens amigaveis pro usuario. Antes vivia inline em App.tsx como
 * `getFriendlyErrorMessage`.
 *
 * Pura, testavel, reusavel em qualquer ponto que chama Gemini.
 */

export function getFriendlyErrorMessage(error: unknown): string {
    const message = (error instanceof Error ? error.message : '') || String((error as { message?: string } | null | undefined)?.message ?? '');

    // ANTES do 429: crédito esgotado também volta como 429, e mandar
    // "aguarde alguns instantes" é conselho ERRADO — esperar não recarrega
    // saldo. Caso real de 20/08 (Contratos IA da Legalização).
    if (message.includes('prepayment') || message.includes('credits are depleted') || message.includes('billing')) {
        return 'Os créditos da IA acabaram — esperar não resolve. É preciso recarregar o saldo do projeto no Google AI Studio (ai.studio/projects → Billing). Seus dados NÃO foram perdidos: refaça a consulta depois da recarga.';
    }
    // Chave de API irrestrita deixou de ser aceita pela API Gemini (19/06/2026):
    // sem restringir a chave, o acesso fica bloqueado.
    if (message.includes('API key not valid') || message.includes('API_KEY_INVALID')
        || message.includes('restricted') || message.includes('unrestricted')) {
        return 'A chave da IA foi recusada (chave inválida ou sem as restrições exigidas pelo Google). Avise o administrador para conferir a chave em aistudio.google.com/apikey — desde 19/06/2026 a API Gemini não aceita chave irrestrita.';
    }
    if (message.includes('429') || message.includes('Quota exceeded')) {
        return 'Limite de consultas excedido (Erro 429). A IA está sobrecarregada ou sua cota acabou. Por favor, aguarde alguns instantes antes de tentar novamente.';
    }
    if (message.includes('503') || message.includes('Service Unavailable')) {
        return 'O serviço de IA está temporariamente indisponível (Erro 503). Isso geralmente é passageiro. Tente novamente em alguns minutos.';
    }
    if (message.includes('400') || message.includes('Invalid argument')) {
        return 'A consulta parece inválida ou incompleta (Erro 400). Verifique os dados digitados e tente novamente.';
    }
    if (message.includes('405') || message.includes('Not Allowed')) {
        return 'Erro de comunicação com o serviço de IA (Erro 405). O modelo pode não estar disponível. Tente novamente em alguns instantes.';
    }
    if (message.includes('500')) {
        return 'Erro interno no servidor da IA (Erro 500). Por favor, tente novamente.';
    }
    if (message.includes('Failed to fetch')) {
        return 'Erro de conexão. Verifique sua internet e tente novamente.';
    }
    if (message.includes('pattern') || message.includes('DOMException')) {
        return 'Erro ao conectar com a API. Verifique se a chave da API (VITE_GEMINI_API_KEY) está configurada corretamente no arquivo .env.';
    }
    if (message.includes('invalid characters') || message.includes('API Key contains')) {
        return 'A chave da API contém caracteres inválidos. Verifique o valor de VITE_GEMINI_API_KEY no arquivo .env.';
    }
    if (message.includes('process is not defined') || message.includes('GEMINI_API_KEY') || message.includes('API Key must be set')) {
        return 'A chave da API do Gemini não foi configurada. Por favor, configure a variável VITE_GEMINI_API_KEY no arquivo .env.';
    }
    if (message.includes('filtro de segurança') || message.includes('SAFETY')) {
        return 'A consulta foi bloqueada pelo filtro de segurança da IA. Tente reformular sua pergunta.';
    }

    // Erro sem tradução conhecida: preserva o motivo cru (é o que ajuda a
    // diagnosticar) mas SEMPRE enquadrado como falha e com a ação — senão
    // volta uma frase neutra que o toast pinta de verde.
    if (message) {
        return `Não foi possível concluir a operação: ${message}. Tente novamente; se repetir, avise o administrador.`;
    }
    return 'Ocorreu um erro inesperado ao comunicar com a API. Tente novamente; se repetir, avise o administrador.';
}
