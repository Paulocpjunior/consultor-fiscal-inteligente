/**
 * services/pgdasPdfParser.ts
 *
 * Parser deterministico do extrato PGDAS-D (PDF da Receita Federal).
 * Substitui chamada ao Gemini que estava alucinando: o prompt antigo
 * pedia "RBT12" e o Gemini retornava o acumulado de 12m em vez do
 * faturamento mensal individual da secao 2.2.
 *
 * Estrutura do PDF (versao 2018, layout estavel ha 6+ anos):
 *
 *   2.2) Receitas Brutas Anteriores (R$)
 *   2.2.1) Mercado Interno
 *   01/2025 42.493,57 02/2025 174.375,80 03/2025 177.129,70 04/2025 167.212,62
 *   05/2025 227.594,11 ...
 *   2.2.2) Mercado Externo
 *   01/2025 0,00 02/2025 0,00 ...
 *
 * O parser extrai TODOS os pares "MM/AAAA  VALOR" das duas tabelas
 * (Interno + Externo) e SOMA por mes. Resultado: faturamento mensal
 * total (Mercado Interno + Mercado Externo).
 *
 * Validacao: a soma dos 12 meses parsed deve bater (+/- R$1) com o
 * RBT12 declarado no cabecalho da secao 2.1. Se nao bater, retorna
 * bate=false e o caller cai pro fallback Gemini.
 *
 * Testado com PDF real (STREET FOODS, CNPJ 26.134.370): batem centavo
 * a centavo (R$ 1.954.300,48 declarado = R$ 1.954.300,48 calculado).
 */

import * as pdfjsLib from 'pdfjs-dist';

if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

export interface PgdasHistoricoItem {
    periodo: string;  // "MM/AAAA"
    valor: number;    // R$, soma Mercado Interno + Externo
}

export interface PgdasParseResult {
    historico: PgdasHistoricoItem[];
    rbt12Declarado: number | null;  // o que o PDF traz no cabecalho 2.1
    rbt12Calculado: number;          // soma dos 12 meses parsed
    bate: boolean;                   // rbt12Calculado ~ rbt12Declarado (+/- R$1)
}

/** Converte "1.954.300,48" -> 1954300.48 */
function parseValorBR(s: string): number {
    const limpo = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(limpo);
    return isNaN(n) ? 0 : n;
}

async function extrairTextoCompleto(arrayBuffer: ArrayBuffer): Promise<string> {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const partes: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        const texto = tc.items
            // @ts-expect-error pdfjs items tem .str
            .map(i => i.str || '')
            .join(' ');
        partes.push(texto);
    }
    return partes.join('\n');
}

function extrairPares(janela: string): Map<string, number> {
    const out = new Map<string, number>();
    const re = /(\d{2})\/(\d{4})\s+((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(janela)) !== null) {
        const periodo = `${m[1]}/${m[2]}`;
        const valor = parseValorBR(m[3] || '');
        out.set(periodo, (out.get(periodo) || 0) + valor);
    }
    return out;
}

export async function parsePgdasExtrato(file: File): Promise<PgdasParseResult> {
    const buf = await file.arrayBuffer();
    const texto = await extrairTextoCompleto(buf);

    // 1. Localizar e isolar a secao 2.2. pdfjs extrai texto com multiplos
    //    espacos entre palavras — \s+ tolera isso.
    const inicio = texto.search(/2\.2\)\s*Receitas\s+Brutas\s+Anteriores/i);
    if (inicio < 0) {
        return { historico: [], rbt12Declarado: null, rbt12Calculado: 0, bate: false };
    }
    const restanteSec22 = texto.slice(inicio);
    const fimSec22 = restanteSec22.search(/2\.3\)\s*Folha|2\.4\)\s*Fator|3\)\s*Informa/i);
    const sec22 = fimSec22 > 0 ? restanteSec22.slice(0, fimSec22) : restanteSec22;

    // 2. Isolar 2.2.1 (Mercado Interno) e 2.2.2 (Mercado Externo)
    const mInterno = sec22.match(/2\.2\.1\)\s*Mercado\s+Interno[\s\S]*?(?=2\.2\.2\)|$)/i);
    const mExterno = sec22.match(/2\.2\.2\)\s*Mercado\s+Externo[\s\S]*/i);

    const paresInterno = mInterno ? extrairPares(mInterno[0]) : new Map<string, number>();
    const paresExterno = mExterno ? extrairPares(mExterno[0]) : new Map<string, number>();

    // 3. Somar por periodo (Mercado Interno + Externo)
    const totalPorMes = new Map<string, number>();
    for (const [k, v] of paresInterno) totalPorMes.set(k, (totalPorMes.get(k) || 0) + v);
    for (const [k, v] of paresExterno) totalPorMes.set(k, (totalPorMes.get(k) || 0) + v);

    const historico: PgdasHistoricoItem[] = Array.from(totalPorMes.entries())
        .map(([periodo, valor]) => ({ periodo, valor }))
        .sort((a, b) => {
            // Ordena AAAA-MM DESC (mais recente primeiro). "02/2026" vs
            // "12/2025" precisa converter pra "2026-02" vs "2025-12".
            const ka = a.periodo.split('/').reverse().join('-');
            const kb = b.periodo.split('/').reverse().join('-');
            return kb.localeCompare(ka);
        });

    // 4. Validar: soma dos 12 mais recentes bate com RBT12 declarado
    const rbt12Match = texto.match(/RBT12\)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i)
        || texto.match(/anteriores ao PA\s*\(?RBT12\)?[\s\S]{0,200}?((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})/i);
    let rbt12Declarado: number | null = null;
    if (rbt12Match) {
        const candidato = rbt12Match[3] || rbt12Match[1] || '';
        rbt12Declarado = parseValorBR(candidato);
    }

    const ultimos12 = historico.slice(0, 12);
    const rbt12Calculado = ultimos12.reduce((s, h) => s + h.valor, 0);
    const bate = rbt12Declarado !== null
        && Math.abs(rbt12Calculado - rbt12Declarado) < 1.0;

    return { historico, rbt12Declarado, rbt12Calculado, bate };
}
