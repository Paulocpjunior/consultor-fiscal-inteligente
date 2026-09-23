/**
 * Regra pura e compartilhada entre navegador e webhook.
 * Fora do backend para o Vite não empacotar crypto/Buffer do Node.
 */
export function saiuPorOutraPlataforma(mensagem) {
    if (!mensagem || typeof mensagem !== 'object') return false;
    if ((mensagem.direcao || 'saida') !== 'saida') return false;
    if (mensagem.enviadoPor) return false;
    return !mensagem.texto && !mensagem.midia;
}
