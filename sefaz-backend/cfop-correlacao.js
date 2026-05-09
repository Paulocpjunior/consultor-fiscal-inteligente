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
 * Tabela default: para cada natureza, sufixo desejado por categoria de CFOP.
 * Categorias agrupam CFOPs com semântica similar (compra produto, devolução,
 * remessa, ativo, energia, etc).
 *
 * Quando o sufixo do XML cai em uma categoria, aplica-se o sufixo da natureza.
 * Quando cai fora de qualquer categoria conhecida, mantém-se o sufixo original
 * (conversão mecânica do primeiro dígito).
 */

// CFOPs de COMPRA DE PRODUTO/MERCADORIA (excluindo ST, devolução, etc).
// Sufixos do emitente: 101, 102, 116 etc -> destinatário define se é
// industrialização (101) ou comercialização (102).
const SUFIXOS_COMPRA_PRODUTO = ['101', '102', '116', '117', '118', '120', '122'];

// CFOPs de SUBSTITUIÇÃO TRIBUTÁRIA — emitente 401-411 -> destinatário 401-411
// (sufixo "se preserva", só inverte o primeiro dígito).
const SUFIXOS_ST = ['401', '403', '405', '406', '407', '408', '409', '410', '411'];

// DEVOLUÇÃO de venda (910-918) -> entrada como devolução
const SUFIXOS_DEVOLUCAO = ['910', '911', '912', '913', '918', '919'];

// ATIVO IMOBILIZADO
const SUFIXOS_ATIVO = ['551', '552', '553', '554', '555'];

// USO E CONSUMO
const SUFIXOS_USO_CONSUMO = ['556', '557'];

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

    // 2. Categorias que SEMPRE preservam sufixo (só inverte o primeiro dígito)
    if (
        SUFIXOS_ST.includes(sufixo) ||
        SUFIXOS_DEVOLUCAO.includes(sufixo) ||
        SUFIXOS_ATIVO.includes(sufixo) ||
        SUFIXOS_USO_CONSUMO.includes(sufixo)
    ) {
        return inverterPrimeiroDigito(c);
    }

    // 3. Compra de produto: aplica sufixo da natureza
    if (SUFIXOS_COMPRA_PRODUTO.includes(sufixo)) {
        const sufNatureza = sufixoCompraPorNatureza(ctx.naturezaAtividade);
        if (sufNatureza) {
            return primeiroDestino + sufNatureza;
        }
        // Sem natureza definida ou misto -> conversão mecânica
        return inverterPrimeiroDigito(c);
    }

    // 4. Default: conversão mecânica
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
