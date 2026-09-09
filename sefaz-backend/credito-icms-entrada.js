/**
 * credito-icms-entrada — "esta ENTRADA gera crédito de ICMS para quem
 * escritura?" e "o CST informado NA NOTA muda a coluna do livro?"
 *
 * ═══ O CASO ═════════════════════════════════════════════════════════════════
 *
 * Paulo, 09/09, fechando a MV LIDER (comércio, **SIMPLES**, 08/2026):
 * *"Como faço para editar esses CFOPs que sobem com base e ICMS destacados?
 * Poderia ter uma opção igual essa das retenções, senão a escrituração fica
 * errada"* — com o print da NF 634934 (FERA ATAC) circulando **BC ICMS 112,25
 * e ICMS 20,21**, e o Livro de Entradas totalizando **Base 14.773,62 · ICMS
 * 2.623,17** numa optante.
 *
 * ═══ A CAUSA É A MESMA DE SEMPRE: O DOCUMENTO É DO FORNECEDOR ═══════════════
 *
 * Naquela nota, três itens são CFOP 5405 / CST 60 (ST já recolhida) e UM é
 * 5102 / CST 00 com ICMS 20,21 destacado. O destaque é da operação de QUEM
 * VENDEU — e `alocarTributacaoIcms` creditava sempre que o item trazia
 * `vICMS > 0`, sem olhar quem escritura.
 *
 * **Optante do Simples NÃO se credita de ICMS** — LC 123/2006, art. 23:
 * *"As microempresas e as empresas de pequeno porte optantes pelo Simples
 * Nacional não farão jus à apropriação nem transferirão créditos relativos a
 * impostos ou contribuições abrangidos pelo Simples Nacional."* No Livro de
 * Entradas dela aquele valor é **Outras** (operação sem crédito do imposto),
 * nunca base + imposto creditado.
 *
 * É a TERCEIRA instância da mesma classe, e as duas anteriores já custaram
 * rodada de PVA: o CST de PIS/COFINS da entrada (20/08, PWR — *"na entrada
 * quem decide é o REGIME de quem escritura"*) e o CST do ICMS 00→90 do caso
 * KALUNGA (18/08). Aqui é a COLUNA do livro.
 *
 * ═══ O QUE ESTA RÉGUA NÃO FAZ ══════════════════════════════════════════════
 *
 * Não decide o CFOP (é `cfopDoLancamento`) nem o CST do SPED (é
 * `cstDoLancamento`). Ela responde só sobre o CRÉDITO e sobre a COLUNA.
 *
 * ⚠️ E ela **não alcança a SAÍDA**: ali o ICMS destacado é o DÉBITO da própria
 * empresa, outro fato. Optante do Simples também não debita ICMS por fora, mas
 * o Livro de Saídas é lido para conferir o que foi emitido — mexer nele por
 * analogia seria inventar régua sem caso.
 */

/**
 * ═══ E O IPI E O ICMS ST VINHAM PELO MESMO BURACO ═══════════════════════════
 *
 * Paulo, no mesmo dia, com o livro já sem a base e o ICMS: *"deu certo, excluiu
 * a BASE e o ICMS, mas está puxando esses valores de IPI"*, e a pergunta que
 * nomeia a incoerência: *"**Se é só para questão de informativo porque ele puxa
 * IPI e não puxa ICMS ST?** Estamos pensando no CONTÁBIL, porque eles vão ver
 * esses valores lá, **vão achar que é crédito**. Antigamente no Folhamatic esses
 * 2 impostos entravam direto como **custo** (pq a empresa não se credita)"*. E,
 * ao ser perguntado se a empresa de fato tem IPI: *"Tem sim, para o SIMPLES
 * mesmo esquema do ICMS"*.
 *
 * 📖 A MEDIÇÃO ESTAVA NO PRINT: MV LIDER · 08/2026 · **IPI 705,80** na coluna
 * do Livro de Entradas, com a NF 21.040 da SW MATERIAIS ELETRICOS trazendo
 * **IPI 700,14** e **ICMS ST 132,40**.
 *
 * 🔴 SÃO DOIS DEFEITOS DIFERENTES, e a pergunta dele separa os dois:
 *   · **o IPI tinha COLUNA** — e coluna de IPI no Livro de Entradas é IPI
 *     CREDITADO. Numa optante aquilo é a MESMA afirmação falsa que a base e o
 *     ICMS faziam até de manhã: **o Simples não se credita de IPI** (LC
 *     123/2006 art. 13, II põe o IPI dentro do recolhimento único, e o art. 23
 *     veda a apropriação). Ele é CUSTO.
 *   · **o ICMS ST não tinha coluna nenhuma** — e ele **nunca é crédito, em
 *     regime nenhum**: é imposto já recolhido nas etapas seguintes, custo da
 *     mercadoria. Não aparecer não é neutro: é a pergunta *"cadê?"* que o dono
 *     fez, e o valor fica invisível dentro de Outras sem ninguém saber.
 *
 * ⚠️ E OS DOIS JÁ ESTAVAM EM **OUTRAS**: o valor contábil da nota inclui IPI e
 * ST, e a alocação joga o resto em Outras. Ou seja **nenhum número muda de
 * total** — o que muda é o livro parar de AFIRMAR crédito de IPI e passar a
 * NOMEAR os dois como custo. Foi exatamente isso que o Folhamatic fazia.
 *
 * ⚠️ **FORA DO SIMPLES NADA MUDA NO IPI, e isso é decisão**: quem se credita de
 * IPI é o contribuinte do imposto (RIPI, Dec. 7.212/2010), e ligar essa régua
 * sem caso real mudaria o livro de todo comércio do Lucro por analogia. O caso
 * real é o Simples, e é só ele que entra.
 */

/** Regimes em que a entrada NÃO dá direito a crédito de ICMS. */
const SEM_CREDITO_ICMS = new Set(['SIMPLES']);

/**
 * CST (tributação, 2 dígitos da Tabela B) por efeito na coluna do livro.
 *
 * ⚠️ São TRÊS baldes porque as colunas são três — e `isentas` × `outras` não é
 * detalhe de estilo: o livro as soma em campos diferentes.
 */
const CST_ISENTAS = new Set(['40', '41', '50']);
const CST_SEM_CREDITO = new Set(['30', '51', '60', '90']);
const CST_COM_CREDITO = new Set(['00', '10', '20', '70']);

/**
 * Responde se a ENTRADA gera crédito de ICMS para quem escritura.
 *
 * @param {{regime?: string, direcao?: string}} ctx
 *   `regime` no vocabulário de `regime-tributario.js` (SIMPLES ·
 *   LUCRO_PRESUMIDO · LUCRO_REAL · IMUNE · ISENTA · INDEFINIDO).
 * @returns {{credita: boolean, motivo: string|null, baseLegal: string|null}}
 */
export function entradaGeraCreditoIcms({ regime, direcao } = {}) {
    // Saída não passa por aqui: o destaque dela é débito, não crédito.
    if (String(direcao || '') === 'saida') {
        return { credita: true, motivo: null, baseLegal: null };
    }
    const r = String(regime || '').trim().toUpperCase();
    // ⚠️ AUSÊNCIA NÃO É PROVA. Regime desconhecido mantém o comportamento
    // antigo: tirar crédito de quem talvez tenha direito é o erro caro, e o
    // farol de cadastro é quem cobra o regime em branco.
    if (!r) return { credita: true, motivo: null, baseLegal: null };
    if (SEM_CREDITO_ICMS.has(r)) {
        return {
            credita: false,
            motivo: 'optante do Simples Nacional não se credita de ICMS — '
                + 'o valor entra na coluna Outras (operação sem crédito do imposto)',
            baseLegal: 'LC 123/2006, art. 23',
        };
    }
    return { credita: true, motivo: null, baseLegal: null };
}

/**
 * Responde se a ENTRADA gera crédito de IPI para quem escritura.
 *
 * Mesma forma da irmã do ICMS, e de propósito: as duas respondem sobre a MESMA
 * nota, e um `if` de tela para uma delas seria a divergência de sempre.
 *
 * ⚠️ Só o SIMPLES entra. Fora dele, quem se credita de IPI é o contribuinte do
 * imposto — régua que existe no cadastro (`contribuinteIpi`) e que decide o
 * E500/E520 do SPED. Ligá-la aqui sem caso real mudaria o livro de todo
 * comércio do Lucro por analogia, que é o que esta casa não faz.
 *
 * @param {{regime?: string, direcao?: string}} ctx
 * @returns {{credita: boolean, motivo: string|null, baseLegal: string|null}}
 */
export function entradaGeraCreditoIpi({ regime, direcao } = {}) {
    if (String(direcao || '') === 'saida') {
        return { credita: true, motivo: null, baseLegal: null };
    }
    const r = String(regime || '').trim().toUpperCase();
    // AUSÊNCIA NÃO É PROVA — mesma política da irmã.
    if (!r) return { credita: true, motivo: null, baseLegal: null };
    if (SEM_CREDITO_ICMS.has(r)) {
        return {
            credita: false,
            motivo: 'optante do Simples Nacional não se credita de IPI — '
                + 'ele é CUSTO da mercadoria e já está dentro da coluna Outras',
            baseLegal: 'LC 123/2006, art. 13, II e art. 23',
        };
    }
    return { credita: true, motivo: null, baseLegal: null };
}

/**
 * O ICMS-ST retido pelo fornecedor NUNCA é crédito de quem recebe.
 *
 * Não há parâmetro de regime porque não há exceção: o ST é imposto já recolhido
 * por substituição, e para o adquirente ele é CUSTO da mercadoria em qualquer
 * regime. Ela existe para o livro poder DIZER isso — a pergunta do Paulo
 * (*"por que puxa IPI e não puxa ICMS ST?"*) é sobre o valor estar invisível,
 * não sobre ele ser creditável.
 *
 * (Ressarcimento de ST em venda interestadual existe, mas é pedido PRÓPRIO, com
 * trilho próprio — nunca crédito no livro de entradas.)
 */
export function ICMS_ST_NAO_E_CREDITO() {
    return {
        credita: false,
        motivo: 'o ICMS-ST retido pelo fornecedor não é crédito de quem recebe — '
            + 'é imposto já recolhido por substituição, e entra como CUSTO da mercadoria',
        baseLegal: 'RICMS/SP, art. 268 e seguintes',
    };
}

/**
 * O que o CST informado NA NOTA (`cstEscriturado`) faz com a coluna.
 *
 * O campo existe desde 19/08 e chegava só ao SPED (C170/C190) — o LIVRO nunca
 * o leu, então informar o CST não tirava o crédito da tela em que o Paulo
 * estava olhando. É a família do cérebro do CFOP que só chegava a uma aba
 * (07/09): a régua existe e falta quem a ALIMENTE.
 *
 * @param {string|null|undefined} cst Tributação informada (2 dígitos).
 * @returns {'isentas'|'outras'|'tributada'|null} null = nada informado.
 */
export function colunaDoCstInformado(cst) {
    const t = String(cst == null ? '' : cst).replace(/\D/g, '');
    if (!t) return null;
    // A ORIGEM mora no 1º dígito quando vêm 3: o campo é a TRIBUTAÇÃO.
    const trib = t.length >= 3 ? t.slice(-2) : t.padStart(2, '0');
    if (CST_ISENTAS.has(trib)) return 'isentas';
    if (CST_SEM_CREDITO.has(trib)) return 'outras';
    if (CST_COM_CREDITO.has(trib)) return 'tributada';
    // Código fora da Tabela B não vira balde inventado — quem recusa a
    // digitação é `validarCstEscriturado`; aqui ele apenas não manda.
    return null;
}

export default { entradaGeraCreditoIcms, entradaGeraCreditoIpi, ICMS_ST_NAO_E_CREDITO, colunaDoCstInformado };
