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
export const SUFIXOS_COMPRA_PRODUTO = ['101', '102', '116', '117', '118', '120', '122'];

/**
 * TRANSFERÊNCIA RECEBIDA — a MESMA assimetria de 101/102, e ela estava fora.
 *
 * Paulo, 17/08, com o livro de Entradas da NOVA ERA (comércio de frutas) do
 * E-Fiscal ao lado do Resumo por CFOP do CFI: lá aparece **1.152**, aqui saía
 * **1151**. Não é preferência de um sistema ou de outro — é a tabela:
 *
 *   SAÍDA (descreve a ORIGEM de quem envia)
 *     5151  transferência de PRODUÇÃO do estabelecimento
 *     5152  transferência de mercadoria adquirida de TERCEIROS
 *   ENTRADA (descreve o DESTINO de quem recebe)
 *     1151  transferência para INDUSTRIALIZAÇÃO
 *     1152  transferência para COMERCIALIZAÇÃO
 *     1154  transferência para utilização na PRESTAÇÃO DE SERVIÇO
 *
 * Ou seja: o sufixo muda de SIGNIFICADO ao atravessar a operação, exatamente
 * como 101/102. Preservá-lo escritura "recebi para industrializar" num comércio
 * que vai revender — que é o que estava acontecendo.
 *
 * ⚠️ **153 fica FORA**: transferência de energia elétrica para distribuição é
 * família própria, e mandá-la para 152 porque o cliente é comércio seria
 * inventar operação.
 */
export const SUFIXOS_TRANSFERENCIA_RECEBIDA = ['151', '152', '154'];

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

/**
 * Sufixo da TRANSFERÊNCIA recebida, pelo destino que o recebedor dá.
 * Mesma régua da compra — e por isso mora ao lado dela, não numa cópia.
 */
function sufixoTransferenciaPorNatureza(naturezaAtividade) {
    switch (naturezaAtividade) {
        case 'comercio':  return '152';  // Transferência para comercialização
        case 'industria': return '151';  // Transferência para industrialização
        case 'servicos':  return '154';  // Utilização na prestação de serviço
        // Misto/indefinido NÃO força: aqui a conversão mecânica produz CFOP que
        // EXISTE (1151/1152/1154), então preservar o sufixo é uma escolha
        // plausível — ao contrário da família ST, onde ela inventa código.
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

    // Transferência recebida: o sufixo muda de significado ao atravessar a
    // operação (origem de quem envia × destino de quem recebe), igual a 101/102.
    if (SUFIXOS_TRANSFERENCIA_RECEBIDA.includes(sufixo)) {
        const sufTransf = sufixoTransferenciaPorNatureza(ctx.naturezaAtividade);
        if (sufTransf) return primeiroDestino + sufTransf;
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
 * ═══ O CFOP QUE VAI PARA O LANÇAMENTO — a régua COM o documento na mão ═══════
 *
 * Paulo, 17/08, comparando o Resumo por CFOP do CFI com o livro do E-Fiscal:
 * *"é necessário incluir um campo para lançamento das notas escrituradas, a fim
 * de corrigir esses detalhes e facilitar a conferência"*. E, quando perguntei se
 * o campo era por NOTA ou por ITEM: **"é por NF"**.
 *
 * Precedência — o MAIS ESPECÍFICO vence, igual ao cadastro de NCM:
 *
 *   1. `doc.cfopEscriturado`  — decisão humana NAQUELA nota
 *   2. `ctx.cfopOverrides`    — mapa CFOP→CFOP da EMPRESA (modal 🔗)
 *   3. `correlacionarCfop`    — a régua automática
 *
 * ⚠️ **A decisão por NF vale para TODOS OS ITENS da nota** — foi o que o dono
 * pediu, e a consequência tem que ser DITA por quem oferece o campo: nota com
 * itens de CFOPs diferentes (compra + ST, por exemplo) passa a sair com um só.
 * Quem informa é `cfopsDistintosDaNota`, para a tela avisar ANTES do clique em
 * vez de o número mudar sozinho depois.
 *
 * @param {object} doc            o documento (é dele que sai o override por NF)
 * @param {string} cfopDoItem     CFOP cru do item, como veio no XML
 * @param {'entrada'|'saida'} direcao
 * @param {object} [ctx]          { naturezaAtividade, cfopOverrides }
 */
export function cfopDoLancamento(doc, cfopDoItem, direcao, ctx = {}) {
    const daNota = String(doc?.cfopEscriturado || '').replace(/\D/g, '');
    if (daNota.length === 4) return daNota;
    return correlacionarCfop(cfopDoItem, direcao, ctx);
}

/** De onde veio o CFOP do lançamento — número sem origem não se confere. */
export function origemDoCfopLancamento(doc, cfopDoItem, direcao, ctx = {}) {
    const daNota = String(doc?.cfopEscriturado || '').replace(/\D/g, '');
    if (daNota.length === 4) {
        return {
            origem: 'nota',
            rotulo: 'informado nesta NF',
            por: doc?.cfopEscrituradoPor || null,
            em: doc?.cfopEscrituradoEm || null,
        };
    }
    const c = String(cfopDoItem || '');
    if (ctx.cfopOverrides && ctx.cfopOverrides[c]) {
        return { origem: 'empresa', rotulo: 'override da empresa', por: null, em: null };
    }
    return { origem: 'regra', rotulo: 'correlação automática', por: null, em: null };
}

/**
 * Os CFOPs DISTINTOS que a nota teria sem o override — é o que a tela precisa
 * dizer antes de alguém carimbar um CFOP só na NF inteira.
 */
export function cfopsDistintosDaNota(doc, direcao, ctx = {}) {
    const fora = new Set();
    for (const item of (doc?.itens || [])) {
        const cru = String(item?.cfop || '').replace(/\D/g, '');
        if (cru.length !== 4) continue;
        fora.add(String(correlacionarCfop(cru, direcao, ctx) || cru));
    }
    return Array.from(fora).sort();
}

/**
 * O CFOP informado à mão é válido para a DIREÇÃO da nota?
 *
 * Entrada se escritura com 1/2/3 e saída com 5/6/7. Aceitar o contrário deixaria
 * alguém gravar 5102 numa entrada — a mesma classe do 1405, que é CFOP que não
 * existe: campo fiscal digitado sem trava vira dado torto que só a fiscalização
 * encontra.
 */
export function validarCfopEscriturado(cfop, direcao) {
    const c = String(cfop || '').replace(/\D/g, '');
    if (c === '') return { ok: true, cfop: '', motivo: 'em branco devolve a nota à régua automática' };
    if (c.length !== 4) {
        return { ok: false, motivo: `CFOP tem 4 dígitos — "${cfop}" tem ${c.length}.` };
    }
    // ⚠️ Testado por REGEX de propósito. A varredura da régua única acusou a
    // versão anterior (um includes sobre a lista dos dígitos de entrada) como
    // cópia de `ehNotaPropriaDeEntrada` — e ela estava certa em perguntar. Aqui
    // a pergunta é OUTRA: a FAIXA do CFOP digitado, não a natureza da nota. A
    // forma tem que dizer isso, igual ao `status` que virou `situacao` em 17/08.
    const faixaEntrada = /^[123]/.test(c);
    const faixaSaida = /^[567]/.test(c);
    if (direcao === 'entrada' && !faixaEntrada) {
        return { ok: false, motivo: `Esta nota é de ENTRADA: o CFOP tem que começar com 1, 2 ou 3 — "${c}" não serve.` };
    }
    if (direcao === 'saida' && !faixaSaida) {
        return { ok: false, motivo: `Esta nota é de SAÍDA: o CFOP tem que começar com 5, 6 ou 7 — "${c}" não serve.` };
    }
    if (!faixaEntrada && !faixaSaida) {
        return { ok: false, motivo: `"${c}" não começa com um dígito de CFOP (1,2,3,5,6,7).` };
    }
    return { ok: true, cfop: c };
}

/**
 * Deriva naturezaAtividade a partir do indAtividade quando não declarada.
 *   industrial -> industria
 *   outras     -> comercio (assumido como mais comum em "outras")
 *
 * Quando empresa.naturezaAtividade existe, vence sobre essa derivação.
 */
export function derivarNaturezaAtividade(empresa) {
    return resolverNaturezaAtividade(empresa?.dadosFiscais || {}).natureza;
}

/**
 * Mesma derivação, dizendo DE ONDE veio o valor.
 *
 * Paulo, 05/08: *"você se parametrizar de acordo com o cadastro da empresa,
 * a empresa em questão é optante do simples nacional"*. O SPED já derivava do
 * cadastro; o Exportar SAGE lia SÓ `naturezaAtividade` e, com o campo em
 * branco — comum em empresa do Simples, que não preenche os campos de SPED —,
 * ficava sem parâmetro nenhum e caía no default sem dizer.
 *
 * A origem importa mais que o valor: "comércio porque está no cadastro" e
 * "comércio porque é o nosso padrão" levam a decisões diferentes de quem
 * confere. Por isso a tela mostra as duas coisas.
 *
 * @returns {{natureza: string, origem: 'cadastro'|'indicador'|'padrao'}}
 */
export function resolverNaturezaAtividade(dadosFiscais) {
    const df = dadosFiscais || {};
    if (df.naturezaAtividade) return { natureza: df.naturezaAtividade, origem: 'cadastro' };
    if (df.indAtividade === 'industrial') return { natureza: 'industria', origem: 'indicador' };
    if (df.indAtividade === 'outras') return { natureza: 'comercio', origem: 'indicador' };
    // Sem nada declarado: revenda é o caso mais comum da carteira. NÃO é
    // chute silencioso — a tela diz que veio do padrão e pede o cadastro.
    return { natureza: 'comercio', origem: 'padrao' };
}
