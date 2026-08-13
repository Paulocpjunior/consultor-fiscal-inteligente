// ============================================================================
// nome-arquivo-guia.js  (PURO — sem Express, sem Firebase, sem rede)
// ----------------------------------------------------------------------------
// O NOME DO ARQUIVO É A ÚNICA MARCA NOSSA QUE O CLIENTE VÊ NO WHATSAPP.
//
// Paulo, 13/08, com o primeiro envio pelo template aprovado na tela: *"de alguma
// forma conseguimos alterar o papel de parede para o nosso?"*. O papel de parede
// não — ele é ajuste do aparelho de QUEM RECEBE, e nenhuma API muda isso. Mas
// acima do ícone do PDF o WhatsApp mostra o NOME DO ARQUIVO, e ali saía
// `das_63787066000193_2026-07.pdf`: nome de máquina, com o CNPJ cru na cara do
// cliente.
//
// ═══ POR QUE UM MÓDULO, E NÃO UM TEMPLATE STRING NO LUGAR ═══════════════════
//
// Porque o nome já estava escrito TRÊS vezes — duas no `envio-imposto-routes.js`
// (anexo do e-mail e documento do WhatsApp) e uma no `CobrancaModal`. Três
// cópias do mesmo formato é a doença que este projeto já pagou caro em régua
// fiscal: mudar uma e esquecer as outras faz o mesmo cliente receber a MESMA
// guia com dois nomes diferentes, por dois canais, no mesmo dia.
//
// ═══ ASCII DE PROPÓSITO ═════════════════════════════════════════════════════
//
// Acento em nome de anexo atravessa Graph, WhatsApp, Windows e o SharePoint —
// e em algum desses pontos vira `Contbil` ou `Cont%C3%A1bil`. O nome é curto e
// aparece grande na tela do cliente: não é lugar de arriscar mojibake.
// ============================================================================

/** Remove acento e o que não pode viver em nome de arquivo. */
function ascii(s) {
    return String(s ?? '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')    // acento fora
        .replace(/[\\/:*?"<>|]/g, ' ')                       // proibidos no Windows
        .replace(/\s+/g, ' ')
        .trim();
}

/** 'AAAA-MM' → 'MM-AAAA' (o cliente lê mês/ano, não ano/mês). */
export function competenciaNoNome(competencia) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(competencia ?? '').trim());
    return m ? `${m[2]}-${m[1]}` : ascii(competencia);
}

/**
 * O nome do arquivo da guia como o CLIENTE vê.
 *
 * `DAS 07-2026 - SP Assessoria Contabil.pdf`
 *
 * O que NÃO entra: o CNPJ. Ele não ajuda quem recebe (o cliente sabe de quem é
 * a guia) e expõe o número num arquivo que vai ser reencaminhado.
 *
 * @param {object} p
 * @param {string} p.tipo          DAS · DARF · DARE · …
 * @param {string} p.competencia   'AAAA-MM'
 * @param {string} [p.assinatura]  quem manda (padrão: o escritório)
 */
export function nomeArquivoGuia({ tipo, competencia, assinatura } = {}) {
    const t = ascii(tipo).toUpperCase() || 'GUIA';
    const c = competenciaNoNome(competencia);
    const quem = ascii(assinatura) || 'SP Assessoria Contabil';
    return `${[t, c].filter(Boolean).join(' ')} - ${quem}.pdf`;
}
