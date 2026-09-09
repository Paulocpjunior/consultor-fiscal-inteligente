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

export default { entradaGeraCreditoIcms, colunaDoCstInformado };
