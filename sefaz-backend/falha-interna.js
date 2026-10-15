// ============================================================================
// sefaz-backend/falha-interna.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 "FALHA INTERNA" SEM CAUSA NÃO SE CONSERTA (15/10, Paulo, A CASTELLANO
// 09/2026: "Erro ao gerar SPED — Falha interna"). A rota escondia a exceção e
// só o log do Cloud Run sabia o motivo; de fora do GCP, ninguém o lê — nem a
// equipe, nem quem corrige. A tela passa a dizer O QUE quebrou e ONDE (o
// primeiro ponto do código do CFI na pilha), para o print já ser o
// diagnóstico. Só para rota de ADMIN: é texto técnico, não dado de cliente.
// ============================================================================

/** Primeiro ponto do código do próprio CFI na pilha: 'arquivo.js:linha', ou ''. */
export function ondeQuebrou(stack) {
    for (const linha of String(stack || '').split('\n').slice(1)) {
        if (/node_modules|node:internal/.test(linha)) continue;
        const m = linha.match(/([\w.-]+\.(?:m?js|ts)):(\d+):\d+\)?\s*$/);
        if (m) return `${m[1]}:${m[2]}`;
    }
    return '';
}

/** "Falha interna: <mensagem> (em arquivo.js:linha)". */
export function textoDaFalhaInterna(e) {
    const msg = String(e?.message || e || '').trim().slice(0, 300) || 'erro sem mensagem';
    const onde = ondeQuebrou(e?.stack);
    return `Falha interna: ${msg}${onde ? ` (em ${onde})` : ''}`;
}
