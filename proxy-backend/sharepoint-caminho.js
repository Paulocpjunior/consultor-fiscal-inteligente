// ============================================================================
// proxy-backend/sharepoint-caminho.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🚨 O CAMPO PEDIA "CAMINHO" E A PESSOA COLA O LINK — que é o gesto natural.
//
// 02/09. Colado o link que o próprio SharePoint dá ao clicar em "Copiar link",
// o app respondeu:
//
//   Failed to list folder (400): {"error":{"code":"BadRequest","message":
//   "Resource not found for the segment 'root:'"...
//
// Porque o proxy monta `/drive/root:/{caminho}:/children`, e uma URL inteira
// no lugar do caminho produz uma rota que não existe. **Mensagem de órgão
// despejada na tela não é informação**: ela não diz o que fazer.
//
// 📌 E o link não é "o jeito errado": ele é MELHOR que o caminho, porque
// carrega o site, a biblioteca e a pasta de uma vez — enquanto o caminho
// digitado depende de o proxy estar apontando para o site certo, que é
// justamente o que quebrou aqui (o proxy resolve `/sites/ClientesSP2` e o
// link é de `/sites/GRUPOFISCAL`).
//
// ✂️ O Graph resolve link de compartilhamento em `/shares/{id}/driveItem`, e
// o `{id}` é a URL em base64url com o prefixo `u!` — é o que este módulo faz.
// ============================================================================

/** Uma entrada é link quando ela é uma URL http(s) — nunca um caminho de pasta. */
export function ehLinkDeCompartilhamento(entrada) {
    return /^https?:\/\//i.test(String(entrada || '').trim());
}

/**
 * O id que o Graph usa em `/shares/{id}/driveItem`.
 *
 * Formato documentado: `u!` + base64 da URL, com `+`→`-`, `/`→`_` e sem o
 * `=` de preenchimento.
 */
export function idDeCompartilhamento(url) {
    const limpa = String(url || '').trim();
    if (!ehLinkDeCompartilhamento(limpa)) return null;
    const b64 = Buffer.from(limpa, 'utf8').toString('base64');
    return `u!${b64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
}

/**
 * O que a pessoa digitou: um LINK (que o Graph resolve sozinho) ou um CAMINHO
 * relativo à raiz da biblioteca.
 *
 * ⚠️ Caminho com barra no começo é normalizado: `/Empresas/X` e `Empresas/X`
 * são a mesma pasta, e a barra sobrando produzia um segmento VAZIO na rota do
 * Graph — outro 400 com cara de "pasta não existe".
 */
export function recorteDoCaminho(entrada) {
    const bruto = String(entrada || '').trim();
    if (!bruto) return { tipo: 'vazio', valor: '', shareId: null };
    if (ehLinkDeCompartilhamento(bruto)) {
        return { tipo: 'link', valor: bruto, shareId: idDeCompartilhamento(bruto) };
    }
    return { tipo: 'caminho', valor: bruto.replace(/^\/+/, '').replace(/\/+$/, ''), shareId: null };
}
