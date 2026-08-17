/**
 * services/efiscalPdfGeometria.ts — a RÉGUA de coordenadas do relatório
 * "Relação de NFs de Serviços Tomados/Prestados" do E-Fiscal / Office Fiscal.
 *
 * ═══ POR QUE ISTO É UM MÓDULO SEPARADO ══════════════════════════════════════
 *
 * O parser importa `pdfjs-dist`, que não carrega no jest (`import.meta` fora de
 * módulo). Enquanto a régua morava lá dentro, ela era **inexercitável por
 * teste** — e foi assim que o defeito de 17/08 (PDF girado) passou. Aqui o
 * núcleo é PURO: recebe números, devolve números, e o teste alcança.
 *
 * A régua mora num lugar SÓ. Reimplementar estas janelas em qualquer outro
 * arquivo é criar a divergência de sempre.
 */

/** Item de texto do pdf.js, no mínimo que este parser precisa. */
export interface ItemTextoPdf { str?: string; width?: number; transform: number[] }

export interface TokenPdf { x0: number; x1: number; y: number; str: string }

/**
 * 🐛 O EIXO ESTAVA ERRADO QUANDO O PDF VEM GIRADO (`/Rotate 90`).
 *
 * Paulo, 17/08 (CLUDE, análise de créditos de 07/2026): o relatório importava
 * **ZERO** notas e ainda acusava divergência com números que não existem no
 * documento — *"Valor da NF: PDF=R$ 5017.50"* quando o rodapé real diz
 * **580.395,26**, em 148 notas. A colaboradora conferiu e o PDF estava certo.
 *
 * A CAUSA: este E-Fiscal sai em **A4 RETRATO (595×842) com `/Rotate 90`** — o
 * relatório é paisagem GIRADO. E `item.transform[4]/[5]` do pdf.js são as
 * coordenadas do espaço do PDF, ANTES da rotação: lendo `transform[4]` como
 * "x", o parser media o eixo VERTICAL do que a pessoa vê. As janelas de coluna
 * (calibradas num PDF de mediabox paisagem, sem rotação) nunca casavam, então
 * nenhuma linha era reconhecida.
 *
 * A CORREÇÃO é compor a matriz do item com a do VIEWPORT, que é quem sabe da
 * rotação — a mesma conta do `pdfjsLib.Util.transform`, feita aqui para o
 * núcleo continuar puro. Conferido no PDF real: as janelas ficam EXATAS, e para
 * `/Rotate 0` a composição devolve o mesmo x de antes.
 *
 * ⚠️ NO ESPAÇO DO VIEWPORT O Y CRESCE PARA BAIXO — quem ordena linhas tem de
 * usar y CRESCENTE. Com a ordem invertida, a linha "Total" (a última do
 * relatório) viraria a primeira e a razão social de duas linhas colaria na nota
 * errada.
 */
export function mapearTokens(items: ItemTextoPdf[], transformDoViewport: number[]): TokenPdf[] {
    const m = transformDoViewport || [];
    const saida: TokenPdf[] = [];
    for (const item of items || []) {
        const str = (item?.str || '').trim();
        if (!str) continue;
        const xu = item.transform?.[4] ?? 0;
        const yu = item.transform?.[5] ?? 0;
        const x = (m[0] ?? 1) * xu + (m[2] ?? 0) * yu + (m[4] ?? 0);
        const y = (m[1] ?? 0) * xu + (m[3] ?? 1) * yu + (m[5] ?? 0);
        saida.push({ x0: x, x1: x + (item.width || 0), str, y: Math.round(y) });
    }
    return saida;
}

/**
 * Borda DIREITA (x1) de cada coluna de valor, no espaço do viewport.
 *
 * Medido no PDF real: Valor da NF 506,1 · Base 599,9 · Alíquota 632,1 ·
 * Valor do ISS 707,1 · Iss Retido 796,4. Os números são de coluna
 * DIREITA-alinhada, por isso a âncora é o x1 e não o x0.
 */
export function colunaPorX(x1: number): string | null {
    if (x1 >= 490 && x1 <= 515) return 'valorNf';
    if (x1 >= 590 && x1 <= 610) return 'baseCalculo';
    if (x1 >= 625 && x1 <= 645) return 'aliquota';
    if (x1 >= 698 && x1 <= 715) return 'valorIss';
    if (x1 >= 788 && x1 <= 802) return 'issRetido';
    return null;
}

/** Faixas de x0 dos campos de identificação (esquerda-alinhados). */
export const FAIXA_NUMERO = { min: 50, max: 110 };
export const FAIXA_SERIE = { min: 135, max: 212 };
export const FAIXA_CNPJ = { min: 205, max: 295 };
export const FAIXA_RAZAO = { min: 290, max: 460 };

export const DATA_RE = /^\d{2}\/\d{2}\/\d{4}$/;
export const CNPJ_CPF_RE = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$|^\d{3}\.\d{3}\.\d{3}-\d{2}$/;
export const VALOR_RE = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;

/**
 * `1.890,00` → 1890. Texto que não é valor devolve 0.
 *
 * ⚠️ Campo com `*` (o E-Fiscal imprime assim a base/alíquota/ISS de nota de
 * optante do Simples, porque o ISS dele vai no DAS) NÃO é zero de verdade — mas
 * aqui zero é a leitura honesta: o documento não traz número. Quem decide o que
 * fazer com isso é a análise, não a régua de coordenada.
 */
export function parseValor(s: string): number {
    if (!s || !VALOR_RE.test(s.trim())) return 0;
    const n = parseFloat(s.trim().replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

/**
 * A linha é o RODAPÉ do relatório?
 *
 * 🚨 Identificada pela palavra "Total", nunca por "ser a última linha com número
 * numa coluna". A régua antiga pegava qualquer linha sem data que tivesse valor
 * numa janela, e a última vencia — foi assim que o caso CLUDE exibiu
 * *"PDF=R$ 5017.50"*, número que não existe no documento, e mandou a
 * colaboradora revisar uma conta que estava certa. **Total que o app INVENTA é
 * pior que total que ele não acha.**
 */
export function ehLinhaDeTotal(tokens: Array<{ str: string }>): boolean {
    // 🐛 `/^totais?$/` casa "totai" e "totais" — NUNCA "Total", que é o que o
    // relatório escreve. Escrevi assim na primeira versão e o teste pegou antes
    // de subir: a correção teria ido ao ar sem achar rodapé NENHUM, trocando um
    // total inventado por um "não conferido" permanente.
    //
    // ÂNCORA no token inteiro, não `includes`: existe fornecedor chamado
    // "TOTAL PASS PARTICIPACOES" na carteira, e ele viraria rodapé.
    return (tokens || []).some(t => /^tota(l|is)$/i.test(String(t?.str || '').replace(/[:.]/g, '')));
}

/** CNPJ/CPF em dígitos — a chave de agrupamento por fornecedor. */
export const onlyDigits = (s: string): string => (s || '').replace(/\D+/g, '');
