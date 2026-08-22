/**
 * services/valorDigitado.ts — O DONO DA PERGUNTA "que número a pessoa digitou?"
 *
 * ═══ POR QUE ELE MUDOU DE CASA ══════════════════════════════════════════════
 *
 * A régua nasceu em 21/08 dentro de `declaracaoFaturamento.ts`, no caso APATEL:
 * a colaboradora colou "3.241.688,71" e o documento ASSINADO saiu com
 * **324.168.871,00** — cem vezes o faturamento.
 *
 * Só que a pergunta nunca foi da Declaração. Ela é de TODO campo em que uma
 * pessoa digita dinheiro — e o nome do arquivo é o que faz a próxima pessoa
 * escrever a quarta cópia em vez de importar esta. Foi exatamente o que
 * aconteceu no ✍️ Lançar nota sem XML, que tinha DUAS cópias locais e já
 * divergia: `num()` apagava TODO ponto, então a forma JS com ponto decimal
 * ("3241688.71" — como sai de export de sistema) virava **324.168.871** no
 * VALOR TOTAL DA NOTA, que alimenta livro, SPED, DIPAM e relatórios.
 *
 * ⚠️ A implementação continua UMA. `declaracaoFaturamento.ts` re-exporta, então
 * quem já importava de lá não muda — mesmo desenho de `decidirGravacaoNFe` e
 * de `valorDoDocumento` quando mudaram de dono.
 *
 * ═══ E A METADE QUE NÃO É DESTA FUNÇÃO ══════════════════════════════════════
 *
 * ⚠️ **ELE NÃO ENTRA EM `REGUAS_VIGIADAS`, e isso é decisão, não esquecimento.**
 * A assinatura da conversão pt-BR (`replace(/\./g,'').replace(',','.')`) casa
 * com ~37 arquivos que fazem OUTRA pergunta — converter texto de ARQUIVO (linha
 * de SPED, CSV do portal de NFS-e, PDF do e-Fiscal), onde a forma é fixa e
 * conhecida. Régua única é o dono da MESMA pergunta, não o dono mais próximo
 * (a lição do `ufDoDestinatarioDoc`). Quem fecha esta classe é
 * `valorDigitadoNaTela.test.ts`, varrendo o defeito de verdade.
 *
 * O defeito do APATEL **não era o parse** — era o INPUT CONTROLADO. O campo
 * exibia `String(número)` e re-parseava o próprio texto exibido: na tecla da
 * vírgula o parse devolvia o inteiro, o render apagava a vírgula da tela e os
 * dígitos seguintes grudavam. **O campo guarda TEXTO; o número é derivado.**
 * Quem trava isso é `valorDigitadoNaTela.test.ts`, por varredura.
 */

/**
 * Interpreta o que a pessoa digitou/colou num campo de dinheiro.
 *
 * Aceita as formas que chegam de verdade: pt-BR colado do e-Fiscal
 * ("3.241.688,71"), digitado sem milhar ("3241688,71") e a forma JS com ponto
 * decimal ("3241688.71"). Devolve **null** para o ilegível — campo de valor
 * nunca recebe número inventado nem zero de conveniência.
 */
export function parseValorMoeda(texto: string): number | null {
    const t = String(texto ?? '').trim().replace(/^R\$\s*/i, '');
    if (!t) return null;
    if (!/^[\d.,\s]+$/.test(t)) return null;
    const s = t.replace(/\s/g, '');

    let normalizado: string;
    if (s.includes(',')) {
        // Vírgula presente ⇒ forma pt-BR: pontos são milhar, vírgula é decimal.
        normalizado = s.replace(/\./g, '').replace(',', '.');
    } else {
        const pontos = (s.match(/\./g) || []).length;
        const m = /^(\d+)\.(\d{1,2})$/.exec(s);
        if (pontos === 1 && m) {
            // Um ponto com 1-2 casas no fim ⇒ decimal JS ("3241688.71").
            normalizado = s;
        } else {
            // "1.234" / "1.234.567" ⇒ pontos de milhar (a forma que o e-Fiscal
            // imprime quando o valor é redondo).
            normalizado = s.replace(/\./g, '');
        }
    }
    const n = Number(normalizado);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
}

/**
 * O que o app ENTENDEU, para aparecer AO LADO do campo antes de gravar.
 *
 * Num campo que vira documento fiscal, a interpretação se mostra ANTES — é a
 * outra metade da correção do APATEL. Texto vazio não vira aviso (campo em
 * branco tem causa própria); texto ilegível DIZ que não foi entendido, em vez
 * de virar zero.
 */
export function ecoDoValorDigitado(texto: string): { ok: boolean; texto: string } | null {
    const cru = String(texto ?? '').trim();
    if (!cru) return null;
    const n = parseValorMoeda(cru);
    if (n === null) {
        return { ok: false, texto: 'não entendi este valor — use 1234,56' };
    }
    return { ok: true, texto: `= ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` };
}
