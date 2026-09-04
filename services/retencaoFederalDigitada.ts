/**
 * Retenção federal DIGITADA — o campo que a terceira porta nunca teve.
 *
 * ═══ O CASO QUE FEZ ISTO NASCER ════════════════════════════════════════════
 *
 * Paulo, 04/09, J.P. PISSATO LOTERIAS: *"essa empresa tem uma particularidade
 * na nota de retenção, ela não é formato 55, 65 e sim 67 DACTE-OS, com isso o
 * cliente só envia o PDF da mesma… quando gero o relatório de retenções ela
 * puxa a NF porém os campos que deveriam estar informados, que é o IR, não
 * está."*
 *
 * O documento (CT-e OS 114.924, PROTEGE PROTEÇÃO E TRANSPORTE DE VALORES →
 * JP PISSATO) DIZ a retenção em Observações, por extenso:
 *
 *   > "SUJEITO A RETENÇÃO DE 1,0% IRRF, ARTIGO 55, LEI 7713 DE 22/12/1988 —
 *   >  R$ 39,02"
 *
 * …e o total da prestação é 3.901,37 com "valor a receber" 3.862,35. A conta
 * fecha ao centavo: 3.901,37 − 39,02 = 3.862,35.
 *
 * 🚨 **1% DE 3.901,37 DÁ 39,01, E O DOCUMENTO DIZ 39,02.** O emitente arredondou
 * para cima, e quem fecha o líquido é o 39,02. Por isso este módulo **NÃO
 * CALCULA**: ele recebe o que a pessoa leu no documento. Recalcular declararia
 * um centavo a menos — é a régua do R-2055 (*"a ressalva PROÍBE recalcular do
 * outro lado"*): dois números para o mesmo fato é o pior defeito de um arquivo
 * fiscal. O cálculo existe só como SUGESTÃO, e mora no parâmetro.
 *
 * ═══ AUSENTE ≠ ZERO, E AQUI ISSO É A REGRA INTEIRA ═════════════════════════
 *
 * `relatoriosAgregacoes` decide se a coluna sai com número ou com **"?"** por
 * `fed.ir !== undefined || fed.inss !== undefined || fed.csllOuTotal !==
 * undefined`. E a gravação transforma `undefined` em **`null`**, que PASSA
 * nesse teste — a nota apareceria com **0,00**, que é a AFIRMAÇÃO de que não
 * houve retenção (a lição de 01/09, no leiaute nacional).
 *
 * Então campo não preenchido fica **FORA DO OBJETO**, nunca com `undefined`
 * dentro dele. É a mesma forma que o `xml-importer` usa para o CFOP de
 * cabeçalho: `...(meta.cfopCabecalho ? { cfop: meta.cfopCabecalho } : {})`.
 *
 * ⚠️ **ZERO DIGITADO É RESPOSTA, e entra.** "Conferi o documento e não houve
 * IR" é um fato que vale tanto quanto um valor — é a régua de 02/09 (o campo
 * zerado do documento é uma afirmação da fonte). O que não pode é o app
 * inventar esse zero por ninguém.
 *
 * ═══ OS NOMES SÃO OS DOS IMPORTADORES, NUNCA NOVOS ═════════════════════════
 *
 * `valorIr`/`valorInss`/`valorCsll`/`valorPis`/`valorCofins` — a forma ACHATADA
 * que o portal de SP grava e que `lerRetencoesFederaisDoDoc` lê PRIMEIRO. Nome
 * próprio aqui criaria um segundo mundo que nenhum relatório soma, que é
 * exatamente o defeito da colcha que o CFI existe para acabar.
 *
 * ⚠️ E `valorCsll` carrega o nome torto de propósito: no export do portal esse
 * campo é o **TOTAL da CSRF**, e é por isso que o dono o chama de
 * `csllOuTotal`. Quem digita a CSLL individual está preenchendo o mesmo campo —
 * e `conferirRetencaoFederal` continua sendo quem separa os dois pela
 * assinatura de alíquota.
 */

/** O que a pessoa digitou. Campo em branco chega como '' / null / undefined. */
export interface RetencaoFederalDigitadaInput {
    ir?: number | string | null;
    inss?: number | string | null;
    /** CSLL individual — ou o TOTAL da CSRF, que é como o portal grava. */
    csll?: number | string | null;
    pis?: number | string | null;
    cofins?: number | string | null;
}

/** Só as chaves PREENCHIDAS — as demais não existem no objeto. */
export type RetencaoFederalGravavel = Partial<Record<
    'valorIr' | 'valorInss' | 'valorCsll' | 'valorPis' | 'valorCofins', number
>>;

const CAMPOS: Array<[keyof RetencaoFederalDigitadaInput, keyof RetencaoFederalGravavel, string]> = [
    ['ir', 'valorIr', 'IR retido'],
    ['inss', 'valorInss', 'INSS retido'],
    ['csll', 'valorCsll', 'CSLL retida'],
    ['pis', 'valorPis', 'PIS retido'],
    ['cofins', 'valorCofins', 'COFINS retida'],
];

/**
 * Vazio é AUSÊNCIA; `0` é RESPOSTA.
 *
 * ⚠️ `Number('')` é 0 e `Number(null)` é 0 — os dois colapsariam ausência em
 * zero, que é justamente o que este módulo existe para impedir. O teste de
 * vazio vem SEMPRE antes da conversão (o `Number(null)` já mordeu quatro vezes
 * neste projeto).
 */
function lerValor(v: unknown): number | undefined {
    if (v === null || v === undefined) return undefined;
    const t = String(v).trim();
    if (!t) return undefined;
    const n = Number(t.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
}

/** Houve algum campo preenchido? (vazio ≠ zero) */
export function temRetencaoDigitada(i: RetencaoFederalDigitadaInput | null | undefined): boolean {
    if (!i) return false;
    return CAMPOS.some(([de]) => lerValor(i[de]) !== undefined);
}

/**
 * Os campos a GRAVAR — só os preenchidos.
 *
 * 🚨 Chave ausente fica FORA do objeto. Emiti-la com `undefined` a
 * transformaria em `null` na gravação, e `null !== undefined` é **true**: a
 * nota passaria a dizer "0,00 retido" no relatório, sobre um campo que ninguém
 * preencheu. É o defeito de 01/09 com outra roupa.
 */
export function camposDaRetencaoDigitada(
    i: RetencaoFederalDigitadaInput | null | undefined,
): RetencaoFederalGravavel {
    const out: RetencaoFederalGravavel = {};
    if (!i) return out;
    for (const [de, para] of CAMPOS) {
        const n = lerValor(i[de]);
        if (n !== undefined) out[para] = Math.round(n * 100) / 100;
    }
    return out;
}

/**
 * Recusas em português, com a ação.
 *
 * ⚠️ **Retenção maior que a base é recusada**, e o motivo é fiscal: retenção é
 * uma PARCELA do valor pago — maior que ele é erro de digitação (a vírgula no
 * lugar errado), e um número desses vira evento do R-4020 declarando retenção
 * que não houve. Recusa se conserta; declaração aceita e errada só aparece na
 * malha.
 */
export function validarRetencaoDigitada(
    i: RetencaoFederalDigitadaInput | null | undefined,
    base: number | null | undefined,
): string[] {
    const erros: string[] = [];
    if (!i) return erros;
    const b = Number(base);
    for (const [de, , rotulo] of CAMPOS) {
        const n = lerValor(i[de]);
        if (n === undefined) continue;
        if (!Number.isFinite(n)) {
            erros.push(`${rotulo}: valor não numérico. Se não houver retenção deste tributo, deixe VAZIO — vazio é diferente de zero.`);
            continue;
        }
        if (n < 0) {
            erros.push(`${rotulo}: retenção não pode ser negativa.`);
            continue;
        }
        if (Number.isFinite(b) && b > 0 && n > b) {
            erros.push(
                `${rotulo}: R$ ${n.toFixed(2)} é MAIOR que o valor da nota (R$ ${b.toFixed(2)}). `
                + 'Retenção é uma parcela do valor pago — confira a vírgula.',
            );
        }
    }
    return erros;
}

/**
 * A frase do que foi digitado, para a tela ecoar ANTES de gravar.
 *
 * O eco existe pela mesma razão do campo de valor da Declaração de Faturamento
 * (21/08, caso APATEL): quem digita precisa ver o que o app ENTENDEU, senão o
 * erro sai com cara de dado certo. Aqui vale dobrado — isto vira evento da
 * EFD-Reinf.
 */
export function ecoDaRetencaoDigitada(
    i: RetencaoFederalDigitadaInput | null | undefined,
    base: number | null | undefined,
): string | null {
    const campos = camposDaRetencaoDigitada(i);
    const chaves = Object.keys(campos) as Array<keyof RetencaoFederalGravavel>;
    if (!chaves.length) return null;
    const rotulos: Record<string, string> = {
        valorIr: 'IR', valorInss: 'INSS', valorCsll: 'CSLL', valorPis: 'PIS', valorCofins: 'COFINS',
    };
    const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const partes = chaves.map(k => {
        const v = campos[k] as number;
        const b = Number(base);
        // ⚠️ O percentual sai em pt-BR como o valor ao lado. `toFixed` devolve
        // PONTO decimal — "IR R$ 39,02 (1.00%)" mistura as duas formas na mesma
        // frase, e quem lê "1.00" numa tela em português lê MIL.
        const pct = Number.isFinite(b) && b > 0 ? ` (${brl((v / b) * 100)}%)` : '';
        return `${rotulos[k]} R$ ${brl(v)}${pct}`;
    });
    const total = chaves.reduce((s, k) => s + (campos[k] as number), 0);
    return `Vai gravar: ${partes.join(' · ')} — total R$ ${brl(total)}. `
        + 'Os tributos deixados em branco NÃO são gravados como zero: eles ficam como "não informado" no relatório.';
}
