// ============================================================================
// sefaz-backend/cfop-correlacao.js
// Correlação inteligente de CFOP do emitente -> CFOP do destinatário.
//
// Problema:
//   Quando uma NF-e de entrada chega, o XML traz o CFOP da PERSPECTIVA do
//   emitente (5xxx/6xxx/7xxx). Pra escriturar no SPED Fiscal precisamos do
//   CFOP da perspectiva do DESTINATÁRIO (1xxx/2xxx/3xxx).
//
//   Conversão mecânica (5→1, 6→2, 7→3) inverte o primeiro dígito mas mantém
//   o sufixo, o que está errado quando emitente e destinatário têm naturezas
//   diferentes:
//
//   Ex: Emitente (indústria) emite 6101 (Venda de produção pra industrialização).
//       Destinatário (comércio) recebe — o CFOP correto é 2102 (Compra pra
//       comercialização), NÃO 2101.
//
// Solução híbrida (Opção C):
//   1. Default por natureza da atividade do destinatário:
//      - comercio  → tudo vai pra ?102 (compra pra comercialização)
//      - industria → tudo vai pra ?101 (compra pra industrialização)
//      - servicos  → tudo vai pra ?556 (uso/consumo)
//      - misto     → mantém conversão mecânica (5→1, 6→2, 7→3)
//   2. Override manual por empresa (cfopOverrides salvo no Firestore):
//      mapa { '6101': '2102', '6102': '2102', ... }
//      Override sempre vence o default.
// ============================================================================

/**
 * Apenas os CFOPs de COMPRA DE PRODUTO/MERCADORIA exigem heurística de
 * natureza (porque o sufixo do destinatário DIFERE do sufixo do emitente:
 * 5102→1101 quando indústria, 5102→1102 quando comércio). Todos os
 * demais CFOPs preservam o sufixo (só inverte o primeiro dígito: 5→1,
 * 6→2, 7→3) — o que é o comportamento DEFAULT.
 *
 * Sufixos cobertos: 101 (venda produção), 102 (venda mercadoria revenda),
 * 116/117 (venda originada de encomenda), 118/120/122 (venda à ordem /
 * por conta e ordem / por outro estabelecimento).
 */
const SUFIXOS_COMPRA_PRODUTO = ['101', '102', '116', '117', '118', '120', '122'];

export { SUFIXOS_ST_VENDA };

/**
 * VENDA com substituição tributária — a família em que a inversão mecânica
 * INVENTA CFOP.
 *
 * Caso real (Paulo, 05/08): nota de saída 5405 (venda de mercadoria de
 * terceiros com ST, na condição de contribuinte SUBSTITUÍDO) virava 1405 na
 * entrada — e 1405 NÃO EXISTE. Na entrada a família ST só tem 401
 * (industrialização), 403 (comercialização), 406 (ativo), 407 (uso/consumo),
 * 408/409 (transferência) e 410/411 (devolução). Não há 402, 404 nem 405.
 *
 * A razão é conceitual, não uma falha da tabela: os sufixos 402/405 descrevem
 * a POSIÇÃO DO VENDEDOR na substituição (substituto entre substitutos,
 * substituído) — coisa que não existe do lado de quem compra. Para o
 * comprador o que importa é o DESTINO da mercadoria, exatamente como na
 * compra normal. Por isso a família ST passa a seguir a natureza da
 * atividade, igual aos sufixos de compra.
 */
const SUFIXOS_ST_VENDA = ['401', '402', '403', '404', '405'];

/** Sufixo de ENTRADA com ST conforme o destino que o comprador dá. */
function sufixoStPorNatureza(naturezaAtividade) {
    switch (naturezaAtividade) {
        case 'comercio':  return '403';  // Compra para comercialização com ST
        case 'industria': return '401';  // Compra para industrialização com ST
        case 'servicos':  return '407';  // Uso/consumo de mercadoria com ST
        // Misto ou não declarado: 403 é o caso geral (revenda). NÃO cai na
        // conversão mecânica porque ela produziria 1402/1404/1405, que não
        // existem — e CFOP inexistente é recusa certa no E-Fiscal e no PVA.
        default:          return '403';
    }
}

/*
 * Histórico (removido em refactor): havia arrays SUFIXOS_ST, _DEVOLUCAO,
 * _ATIVO, _USO_CONSUMO listando 401/403.../910.../551.../556. Eles só
 * forçavam o "preserva sufixo + inverte primeiro digito" — que JÁ É
 * o comportamento default. Tinham apenas valor documental e davam
 * falsa sensação de tratamento especial. Removidos pra evitar que
 * leitor futuro confie em tratamento dedicado que não existe.
 *
 * CFOPs ST (401-411), devolução (910-919), ativo (551-555), uso/consumo
 * (556-557) continuam funcionando perfeitamente via conversão mecânica:
 *   5401→1401, 5910→1910, 5551→1551, 5556→1556 (e variantes 6→2, 7→3).
 */

/**
 * Para uma natureza de atividade, qual sufixo usar quando o XML traz um
 * CFOP de compra de produto/mercadoria.
 */
function sufixoCompraPorNatureza(naturezaAtividade) {
    switch (naturezaAtividade) {
        case 'comercio':  return '102';  // Compra pra comercialização
        case 'industria': return '101';  // Compra pra industrialização
        case 'servicos':  return '556';  // Uso e consumo
        case 'misto':     return null;   // Não força — mantém sufixo original
        default:          return null;
    }
}

function inverterPrimeiroDigito(c) {
    const map = { '5': '1', '6': '2', '7': '3' };
    const novo = map[c[0]];
    return novo ? novo + c.slice(1) : c;
}

/**
 * Correlação principal.
 *
 * @param {string} cfopOrigem - CFOP do XML (emitente). Ex: '6101'.
 * @param {'entrada'|'saida'} direcao - direção da nota pra essa empresa.
 * @param {object} ctx
 * @param {string} [ctx.naturezaAtividade] - 'comercio'|'industria'|'servicos'|'misto'
 * @param {Record<string,string>} [ctx.cfopOverrides] - mapa override manual
 * @returns {string} CFOP final pra escriturar
 */
export function correlacionarCfop(cfopOrigem, direcao, ctx = {}) {
    const c = String(cfopOrigem || '0000');
    if (c.length !== 4) return c;

    // Saída: sempre mantém o CFOP original (vem da empresa, já é o correto)
    if (direcao !== 'entrada') return c;

    // 1. Override manual sempre vence
    if (ctx.cfopOverrides && ctx.cfopOverrides[c]) {
        return ctx.cfopOverrides[c];
    }

    // Só aceita 5xxx/6xxx/7xxx pra converter
    if (!['5', '6', '7'].includes(c[0])) return c;

    const sufixo = c.slice(1);  // 3 últimos dígitos
    const primeiroDestino = { '5': '1', '6': '2', '7': '3' }[c[0]];

    // Compra de produto: aplica sufixo da natureza (única categoria com
    // tratamento diferente da inversão mecânica).
    if (SUFIXOS_COMPRA_PRODUTO.includes(sufixo)) {
        const sufNatureza = sufixoCompraPorNatureza(ctx.naturezaAtividade);
        if (sufNatureza) return primeiroDestino + sufNatureza;
        // Sem natureza definida ou misto -> conversão mecânica
    }

    // Venda com ST: o sufixo do vendedor não tem par na entrada (ver
    // SUFIXOS_ST_VENDA) — decide pelo destino da mercadoria.
    if (SUFIXOS_ST_VENDA.includes(sufixo)) {
        return primeiroDestino + sufixoStPorNatureza(ctx.naturezaAtividade);
    }

    // Default: devolução (9xx), transferência com ST (408/409), ativo (55x),
    // uso/consumo (55x) e qualquer outro CFOP — nesses o sufixo do emitente
    // TEM par na entrada, então preserva sufixo e só inverte o 1º dígito.
    return inverterPrimeiroDigito(c);
}

/**
 * Deriva naturezaAtividade a partir do indAtividade quando não declarada.
 *   industrial -> industria
 *   outras     -> comercio (assumido como mais comum em "outras")
 *
 * Quando empresa.naturezaAtividade existe, vence sobre essa derivação.
 */
export function derivarNaturezaAtividade(empresa) {
    const df = empresa?.dadosFiscais || {};
    if (df.naturezaAtividade) return df.naturezaAtividade;
    if (df.indAtividade === 'industrial') return 'industria';
    return 'comercio';  // default conservador (revenda)
}
