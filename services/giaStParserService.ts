/**
 * services/giaStParserService.ts
 *
 * Parser do relatório "Livro de ICMS Substituto (Operações Interestaduais)"
 * do Office Fiscal (IOB/SAGE). É a fonte de dados da GIA-ST: traz, por UF,
 * Valor Contábil / Base de Cálculo / Valor do ICMS / BC (ICMS Retido) /
 * ICMS Retido Fonte, em duas seções: B (Entradas) e C (Saídas).
 *
 * Extração em duas camadas (mesmo desenho do nfsePdfParserService):
 *   - parseGiaStLinhas(): função PURA sobre linhas de tokens — testável em
 *     jsdom sem pdfjs;
 *   - parseGiaStPdf(): wrapper browser-only que extrai as linhas via pdfjs.
 */

import * as pdfjsLib from 'pdfjs-dist';

if (typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

export interface GiaStLinhaUf {
    uf: string;
    nomeUf: string;
    valorContabil: number;
    baseCalculo: number;
    valorIcms: number;
    bcIcmsRetido: number;
    icmsRetidoFonte: number;
}

export interface GiaStSecao {
    linhas: GiaStLinhaUf[];
    /** Linha "Totais" impressa no relatório (validação centavo a centavo). */
    totaisImpressos: Omit<GiaStLinhaUf, 'uf' | 'nomeUf'> | null;
}

export interface GiaStRelatorioParsed {
    empresaNome: string;
    empresaCnpj: string;
    inscricaoEstadual: string;
    /** Competência no formato AAAA-MM (do campo "Mês de Referência/Ano: 06/2026"). */
    competencia: string;
    entradas: GiaStSecao;
    saidas: GiaStSecao;
    validacao: { ok: boolean; divergencias: string[] };
}

export class GiaStParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GiaStParseError';
    }
}

const VALOR_RE = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
const UF_ROW_RE = /^\(([A-Z]{2})\)$|^\(([A-Z]{2})\)\s+(.*)$/;

function parseValor(s: string): number {
    const t = (s || '').trim();
    if (!VALOR_RE.test(t)) return NaN;
    const n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
}

/** Uma linha do PDF já agrupada por Y: lista de tokens em ordem de X. */
export interface LinhaTokens {
    pagina: number;
    tokens: string[];
}

function centavosIguais(a: number, b: number): boolean {
    return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * Parser puro. Recebe as linhas tokenizadas do PDF (ou de um teste) e monta
 * o relatório estruturado. Regras:
 *  - cabeçalho: "Empresa:", "I.E.:", "CGC/CNPJ:", "Mês de Referência/Ano:";
 *  - marcador de seção: "Entradas de Mercadorias..." → entradas,
 *    "Saídas de Mercadorias..." → saídas;
 *  - linha de UF: começa com "(XX)"; os 5 últimos tokens numéricos são
 *    valorContabil, baseCalculo, valorIcms, bcIcmsRetido, icmsRetidoFonte.
 *    Linhas com menos de 5 números (ex: "NULL") são ignoradas;
 *  - "Totais": guarda os totais impressos pra validação.
 */
export function parseGiaStLinhas(linhas: LinhaTokens[]): GiaStRelatorioParsed {
    let empresaNome = '';
    let empresaCnpj = '';
    let inscricaoEstadual = '';
    let competencia = '';
    const entradas: GiaStSecao = { linhas: [], totaisImpressos: null };
    const saidas: GiaStSecao = { linhas: [], totaisImpressos: null };
    let secaoAtual: GiaStSecao | null = null;

    for (const linha of linhas) {
        const texto = linha.tokens.join(' ').trim();
        if (!texto) continue;

        if (!empresaNome) {
            const m = texto.match(/Empresa:\s*(.+)/i);
            if (m) { empresaNome = m[1].trim(); continue; }
        }
        if (!inscricaoEstadual) {
            // "I.E.: 734.041.267.115   CGC/CNPJ: 96.312.889/0001-11" pode vir na mesma linha
            const m = texto.match(/I\.?E\.?\s*:?\s*([\d./-]+)/i);
            if (m) inscricaoEstadual = m[1].trim();
        }
        if (!empresaCnpj) {
            const m = texto.match(/(?:CGC\/?CNPJ|CNPJ)\s*:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/i);
            if (m) empresaCnpj = m[1].replace(/\D/g, '');
        }
        if (!competencia) {
            const m = texto.match(/Referência\/?Ano\s*:?\s*(\d{2})\/(\d{4})/i);
            if (m) competencia = `${m[2]}-${m[1]}`;
        }

        if (/Entradas de Mercadorias/i.test(texto)) { secaoAtual = entradas; continue; }
        if (/Sa[íi]das de Mercadorias/i.test(texto)) { secaoAtual = saidas; continue; }

        if (!secaoAtual) continue;

        const numeros = linha.tokens.map(parseValor).filter(n => Number.isFinite(n));

        if (/^Totais\b/i.test(texto)) {
            if (numeros.length >= 5) {
                const [valorContabil, baseCalculo, valorIcms, bcIcmsRetido, icmsRetidoFonte] = numeros.slice(-5);
                secaoAtual.totaisImpressos = { valorContabil, baseCalculo, valorIcms, bcIcmsRetido, icmsRetidoFonte };
            }
            continue;
        }

        const mUf = linha.tokens[0]?.trim().match(UF_ROW_RE);
        if (!mUf) continue;
        const uf = (mUf[1] || mUf[2] || '').toUpperCase();
        if (numeros.length < 5) continue; // linha truncada/decorativa
        const [valorContabil, baseCalculo, valorIcms, bcIcmsRetido, icmsRetidoFonte] = numeros.slice(-5);
        // Nome da UF = tudo entre o "(XX)" e o primeiro token numérico
        const idxPrimeiroNum = linha.tokens.findIndex(t => Number.isFinite(parseValor(t)));
        const nomeUf = linha.tokens
            .slice(1, idxPrimeiroNum > 0 ? idxPrimeiroNum : undefined)
            .join(' ')
            .trim() || (mUf[3] || '').trim();
        secaoAtual.linhas.push({ uf, nomeUf, valorContabil, baseCalculo, valorIcms, bcIcmsRetido, icmsRetidoFonte });
    }

    if (!empresaCnpj || !competencia) {
        throw new GiaStParseError(
            'Este PDF não parece ser o "Livro de ICMS Substituto (Operações Interestaduais)" do Office Fiscal — '
            + `não encontrei ${!empresaCnpj ? 'CNPJ' : ''}${!empresaCnpj && !competencia ? ' nem ' : ''}${!competencia ? 'Mês de Referência/Ano' : ''}.`,
        );
    }
    if (entradas.linhas.length === 0 && saidas.linhas.length === 0) {
        throw new GiaStParseError('Nenhuma linha de UF encontrada nas seções de Entradas/Saídas.');
    }

    // Validação: soma calculada × Totais impressos
    const divergencias: string[] = [];
    for (const [nome, secao] of [['Entradas', entradas], ['Saídas', saidas]] as const) {
        if (!secao.totaisImpressos) continue;
        const soma = secao.linhas.reduce((acc, l) => ({
            valorContabil: acc.valorContabil + l.valorContabil,
            baseCalculo: acc.baseCalculo + l.baseCalculo,
            valorIcms: acc.valorIcms + l.valorIcms,
            bcIcmsRetido: acc.bcIcmsRetido + l.bcIcmsRetido,
            icmsRetidoFonte: acc.icmsRetidoFonte + l.icmsRetidoFonte,
        }), { valorContabil: 0, baseCalculo: 0, valorIcms: 0, bcIcmsRetido: 0, icmsRetidoFonte: 0 });
        for (const campo of ['valorContabil', 'baseCalculo', 'valorIcms', 'bcIcmsRetido', 'icmsRetidoFonte'] as const) {
            if (!centavosIguais(soma[campo], secao.totaisImpressos[campo])) {
                divergencias.push(
                    `${nome}/${campo}: soma das UFs = ${soma[campo].toFixed(2)} ≠ total impresso ${secao.totaisImpressos[campo].toFixed(2)}`,
                );
            }
        }
    }

    return {
        empresaNome, empresaCnpj, inscricaoEstadual, competencia,
        entradas, saidas,
        validacao: { ok: divergencias.length === 0, divergencias },
    };
}

/**
 * Extrai as linhas tokenizadas do PDF (agrupamento por Y, ordem por X) e
 * delega ao parser puro. Browser-only (pdfjs).
 */
export async function parseGiaStPdf(file: File): Promise<GiaStRelatorioParsed> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const linhas: LinhaTokens[] = [];

    for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const porY = new Map<number, { x: number; str: string }[]>();
        for (const item of content.items as any[]) {
            const str = ('str' in item ? item.str : '').trim();
            if (!str) continue;
            // Tolerância de 2pt no Y: o Office Fiscal desalinha levemente os
            // tokens da mesma linha visual.
            const yRaw = item.transform[5];
            let y = Math.round(yRaw);
            for (const yExistente of porY.keys()) {
                if (Math.abs(yExistente - yRaw) <= 2) { y = yExistente; break; }
            }
            if (!porY.has(y)) porY.set(y, []);
            porY.get(y)!.push({ x: item.transform[4], str });
        }
        const ys = Array.from(porY.keys()).sort((a, b) => b - a); // topo → base
        for (const y of ys) {
            const tokens = porY.get(y)!.sort((a, b) => a.x - b.x).map(t => t.str);
            linhas.push({ pagina: p, tokens });
        }
    }

    return parseGiaStLinhas(linhas);
}
