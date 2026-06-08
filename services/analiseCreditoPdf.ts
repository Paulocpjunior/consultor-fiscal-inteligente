/**
 * services/analiseCreditoPdf.ts
 *
 * Geracao dos 2 PDFs da analise de creditos PIS/COFINS:
 *   1) PDF da analise e-fiscal completa (resumo + KPIs + categorias + NFs)
 *   2) PDF do extrato conciliado (lancamentos por categoria)
 *
 * Extraidos de components/AnaliseCreditoExtrato.tsx pra ficar testaveis
 * (mockando jsPDF) e nao engordar o componente. Identidade visual da S&P
 * Contabil mantida (navy #020026 + cards azuis #F0F5FF).
 */

import type { EfiscalPdfParsed } from './efiscalPdfParserService';
import type { CreditoEfiscal } from './efiscalCreditoService';
import type { LancamentoExtrato } from './analiseCreditoExtratoService';

const NAVY: [number, number, number] = [2, 0, 38];
const WHITE: [number, number, number] = [255, 255, 255];
const TEXT_DARK: [number, number, number] = [50, 50, 50];
const TEXT_MUTED: [number, number, number] = [80, 80, 80];
const TEXT_FAINT: [number, number, number] = [150, 150, 150];
const BG_KPI: [number, number, number] = [240, 245, 255];
const BG_HEADER_TBL: [number, number, number] = [245, 245, 245];
const BG_SECTION: [number, number, number] = [225, 235, 255];
const BG_WARN: [number, number, number] = [255, 248, 220];
const WARN_TEXT: [number, number, number] = [140, 100, 0];
const BORDER_LIGHT: [number, number, number] = [200, 200, 200];

const brl = (n: number): string =>
    n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface PaginaCtx {
    pdf: any;
    W: number;
    H: number;
    m: number;
    y: number;
    drawHeader: () => void;
}

function novaPagina(ctx: PaginaCtx, h: number): void {
    if (ctx.y + h > ctx.H - 12) {
        ctx.pdf.addPage();
        ctx.drawHeader();
        ctx.y = 24;
    }
}

/**
 * Gera o PDF da analise e-fiscal completa.
 * Retorna o Blob pronto pra download (sem disparar download automatico).
 *
 * @param efiscal dados parseados do PDF e-fiscal original
 * @param credito resultado de calcularCreditoEfiscal (ou null se nao calculado)
 */
export async function gerarEfiscalPdf(
    efiscal: EfiscalPdfParsed,
    credito: CreditoEfiscal | null,
): Promise<Blob> {
    const { jsPDF } = await import('jspdf');
    const pdf = new (jsPDF as any)({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W: number = pdf.internal.pageSize.getWidth();
    const H: number = pdf.internal.pageSize.getHeight();
    const m = 12;
    const now = new Date().toLocaleDateString('pt-BR');

    const drawHeader = () => {
        pdf.setFillColor(...NAVY); pdf.rect(0, 0, W, 16, 'F');
        pdf.setTextColor(...WHITE); pdf.setFontSize(11); pdf.setFont('helvetica', 'bold');
        pdf.text('SP Contabil - Analise de Creditos PIS/COFINS (Servicos Tomados)', m, 10);
        pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
        pdf.text('Gerado em: ' + now, W - m - 38, 10);
    };
    drawHeader();
    const ctx: PaginaCtx = { pdf, W, H, m, y: 24, drawHeader };

    // ── Dados da empresa ──
    pdf.setFontSize(10); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY);
    pdf.text(`${efiscal.empresaCodigo} - ${efiscal.empresaNome}`, m, ctx.y); ctx.y += 5;
    pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...TEXT_MUTED);
    pdf.text(`CNPJ: ${efiscal.empresaCnpj}   Periodo: ${efiscal.periodo}   NFs: ${efiscal.notas.length}   Fornecedores: ${efiscal.fornecedores.length}`, m, ctx.y);
    ctx.y += 8;

    // ── Card de credito ──
    if (credito) {
        novaPagina(ctx, 28);
        if (credito.geraCredito) {
            pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY);
            pdf.text('CREDITO PIS/COFINS - ' + credito.aliquota.label, m, ctx.y); ctx.y += 5;
            const kpis: Array<[string, string]> = [
                ['Base de Calculo', 'R$ ' + brl(credito.baseTotal)],
                [`Credito PIS (${(credito.aliquota.pis * 100).toFixed(2)}%)`, 'R$ ' + brl(credito.creditoPis)],
                [`Credito COFINS (${(credito.aliquota.cofins * 100).toFixed(2)}%)`, 'R$ ' + brl(credito.creditoCofins)],
                ['Credito Total', 'R$ ' + brl(credito.creditoTotal)],
            ];
            const kW = (W - m * 2) / 4;
            kpis.forEach((k, i) => {
                const x = m + i * kW;
                pdf.setFillColor(...BG_KPI); pdf.rect(x, ctx.y - 4, kW - 2, 14, 'F');
                pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...TEXT_MUTED);
                pdf.text(k[0], x + 2, ctx.y + 1);
                pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY);
                pdf.text(k[1], x + 2, ctx.y + 7);
            });
            ctx.y += 20;
        } else {
            pdf.setFillColor(...BG_WARN); pdf.rect(m, ctx.y - 4, W - m * 2, 16, 'F');
            pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...WARN_TEXT);
            pdf.text('Empresa optante pelo Simples Nacional', m + 3, ctx.y + 2);
            pdf.setFontSize(7); pdf.setFont('helvetica', 'normal');
            pdf.text('Nao gera credito de PIS/COFINS sobre servicos tomados - recolhimento ocorre no DAS.', m + 3, ctx.y + 8);
            ctx.y += 20;
        }
    }

    // ── Distribuicao por categoria (resumo) ──
    if (credito && credito.categorias.length > 0) {
        novaPagina(ctx, 14);
        pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY);
        pdf.text('DISTRIBUICAO POR CATEGORIA', m, ctx.y); ctx.y += 2;
        pdf.setDrawColor(...BORDER_LIGHT); pdf.line(m, ctx.y, W - m, ctx.y); ctx.y += 5;

        pdf.setFillColor(...BG_HEADER_TBL); pdf.rect(m, ctx.y - 3, W - m * 2, 6, 'F');
        pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...TEXT_MUTED);
        pdf.text('CATEGORIA', m + 2, ctx.y + 1);
        pdf.text('FORNEC.', m + 80, ctx.y + 1);
        pdf.text('NFs', m + 105, ctx.y + 1);
        pdf.text('BASE DE CALCULO', W - m - 40, ctx.y + 1);
        ctx.y += 6;
        for (const cat of credito.categorias) {
            novaPagina(ctx, 6);
            const label = cat.categoria === 'SEM_CATEGORIA' ? 'Sem categoria' : String(cat.categoria);
            pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...TEXT_DARK); pdf.setFontSize(7);
            pdf.text(label, m + 2, ctx.y);
            pdf.text(String(cat.qtdFornecedores), m + 80, ctx.y);
            pdf.text(String(cat.qtdNotas), m + 105, ctx.y);
            pdf.text('R$ ' + brl(cat.somaBaseCalculo), W - m - 40, ctx.y);
            ctx.y += 5;
        }
        ctx.y += 4;
    }

    // ── NFs detalhadas por grupo ──
    if (credito && credito.categorias.length > 0) {
        for (const cat of credito.categorias) {
            if (cat.notas.length === 0) continue;
            novaPagina(ctx, 16);
            const label = cat.categoria === 'SEM_CATEGORIA' ? 'Sem categoria' : String(cat.categoria);
            pdf.setFillColor(...BG_SECTION); pdf.rect(m, ctx.y - 4, W - m * 2, 9, 'F');
            pdf.setFontSize(8); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY);
            pdf.text(label + '  (' + cat.notas.length + ' NFs)', m + 2, ctx.y + 1);
            pdf.setTextColor(...TEXT_MUTED);
            pdf.text('Base: R$ ' + brl(cat.somaBaseCalculo), W - m - 45, ctx.y + 1);
            ctx.y += 11;

            novaPagina(ctx, 7);
            pdf.setFillColor(...BG_HEADER_TBL); pdf.rect(m + 2, ctx.y - 3, W - m * 2 - 4, 5, 'F');
            pdf.setFontSize(6); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...TEXT_MUTED);
            pdf.text('EMISSAO', m + 4, ctx.y);
            pdf.text('NUMERO', m + 22, ctx.y);
            pdf.text('CNPJ/CPF', m + 42, ctx.y);
            pdf.text('RAZAO SOCIAL', m + 78, ctx.y);
            pdf.text('VALOR NF', W - m - 48, ctx.y);
            pdf.text('BASE CALC.', W - m - 24, ctx.y);
            ctx.y += 5;
            for (const nf of cat.notas) {
                novaPagina(ctx, 5);
                pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...TEXT_DARK); pdf.setFontSize(6);
                pdf.text(String(nf.emissao || '-'), m + 4, ctx.y);
                pdf.text(String(nf.numero || '-').slice(0, 12), m + 22, ctx.y);
                pdf.text(String(nf.cnpjCpf || '-'), m + 42, ctx.y);
                pdf.text(String(nf.razaoSocial || '-').slice(0, 30), m + 78, ctx.y);
                pdf.text('R$ ' + brl(nf.valorNf), W - m - 48, ctx.y);
                pdf.text('R$ ' + brl(nf.baseCalculo), W - m - 24, ctx.y);
                ctx.y += 4;
            }
            ctx.y += 4;
        }
    }

    // ── Rodape ──
    const totalPaginas = pdf.getNumberOfPages();
    for (let p = 1; p <= totalPaginas; p++) {
        pdf.setPage(p);
        pdf.setFontSize(6); pdf.setTextColor(...TEXT_FAINT);
        pdf.text('Classificacao automatica por categoria - revise antes de enviar ao cliente.', m, H - 4);
        pdf.text(`Pagina ${p}/${totalPaginas}`, W - m - 16, H - 4);
    }

    return pdf.output('blob') as Blob;
}

/**
 * Gera o PDF do extrato conciliado (lancamentos por categoria).
 * Retorna o Blob pronto pra download.
 */
export async function gerarExtratoPdf(opts: {
    lancamentos: LancamentoExtrato[];
    categoriasCredito: readonly string[];
    baseCreditos: number;
    creditoPis: number;
    creditoCofins: number;
    creditoTotal: number;
}): Promise<Blob> {
    const { lancamentos, categoriasCredito, baseCreditos, creditoPis, creditoCofins, creditoTotal } = opts;
    const { jsPDF } = await import('jspdf');
    const pdf = new (jsPDF as any)({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W: number = pdf.internal.pageSize.getWidth();
    const H: number = pdf.internal.pageSize.getHeight();
    const m = 12;
    const now = new Date().toLocaleDateString('pt-BR');

    const drawHeader = () => {
        pdf.setFillColor(...NAVY); pdf.rect(0, 0, W, 16, 'F');
        pdf.setTextColor(...WHITE); pdf.setFontSize(11); pdf.setFont('helvetica', 'bold');
        pdf.text('SP Contabil - Credito PIS/COFINS (Extrato de Conciliacao)', m, 10);
        pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
        pdf.text('Gerado em: ' + now, W - m - 40, 10);
    };
    drawHeader();
    const ctx: PaginaCtx = { pdf, W, H, m, y: 24, drawHeader };

    pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY);
    pdf.text('RESUMO DE CREDITOS PIS/COFINS', m, ctx.y); ctx.y += 6;
    const kpis: Array<[string, string]> = [
        ['Base de Credito', 'R$ ' + brl(baseCreditos)],
        ['Credito PIS (1,65%)', 'R$ ' + brl(creditoPis)],
        ['Credito COFINS (7,60%)', 'R$ ' + brl(creditoCofins)],
        ['Credito Total', 'R$ ' + brl(creditoTotal)],
    ];
    const kW = (W - m * 2) / 4;
    kpis.forEach((k, i) => {
        const x = m + i * kW;
        pdf.setFillColor(...BG_KPI); pdf.rect(x, ctx.y - 4, kW - 2, 14, 'F');
        pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...TEXT_MUTED);
        pdf.text(k[0], x + 2, ctx.y + 1);
        pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY);
        pdf.text(k[1], x + 2, ctx.y + 7);
    });
    ctx.y += 20;

    novaPagina(ctx, 10);
    pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY);
    pdf.text('DETALHAMENTO POR CATEGORIA E FORNECEDOR', m, ctx.y); ctx.y += 2;
    pdf.setDrawColor(...BORDER_LIGHT); pdf.line(m, ctx.y, W - m, ctx.y); ctx.y += 5;

    const porCategoria: Record<string, LancamentoExtrato[]> = {};
    for (const l of lancamentos) {
        if (l.categoriaSugerida === null) continue;
        (porCategoria[l.categoriaSugerida] ??= []).push(l);
    }

    for (const cat of categoriasCredito) {
        const itens = porCategoria[cat];
        if (!itens || itens.length === 0) continue;
        const subtotal = itens.reduce((s, i) => s + i.valor, 0);

        novaPagina(ctx, 16);
        pdf.setFillColor(...BG_SECTION); pdf.rect(m, ctx.y - 4, W - m * 2, 12, 'F');
        pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY);
        pdf.text(cat, m + 2, ctx.y + 1);
        pdf.setTextColor(...TEXT_MUTED);
        pdf.text('Total: R$ ' + brl(subtotal) + '  (' + itens.length + ' lanc.)', W - m - 60, ctx.y + 1);
        ctx.y += 14;

        novaPagina(ctx, 8);
        pdf.setFillColor(...BG_HEADER_TBL); pdf.rect(m + 2, ctx.y - 3, W - m * 2 - 4, 6, 'F');
        pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...TEXT_MUTED);
        pdf.text('DATA', m + 4, ctx.y + 1);
        pdf.text('FORNECEDOR', m + 22, ctx.y + 1);
        pdf.text('DESCRICAO', m + 80, ctx.y + 1);
        pdf.text('VALOR', W - m - 22, ctx.y + 1);
        ctx.y += 6;

        for (const it of itens) {
            novaPagina(ctx, 6);
            pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...TEXT_DARK); pdf.setFontSize(7);
            pdf.text(String(it.data || '-').substring(0, 10), m + 4, ctx.y);
            pdf.text(String(it.favorecido || '-').substring(0, 35), m + 22, ctx.y);
            pdf.text(String(it.descricao || '-').substring(0, 42), m + 80, ctx.y);
            pdf.text('R$ ' + brl(it.valor), W - m - 22, ctx.y);
            ctx.y += 5;
        }
        ctx.y += 3;
        pdf.setDrawColor(230, 230, 230); pdf.line(m, ctx.y, W - m, ctx.y); ctx.y += 4;
    }

    novaPagina(ctx, 14);
    pdf.setFillColor(...NAVY); pdf.rect(m, ctx.y - 3, W - m * 2, 10, 'F');
    pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...WHITE);
    pdf.text('TOTAL GERAL - BASE DE CREDITO', m + 2, ctx.y + 3);
    pdf.text('R$ ' + brl(baseCreditos), W - m - 40, ctx.y + 3);
    ctx.y += 14;

    pdf.setFontSize(6); pdf.setTextColor(...TEXT_FAINT);
    pdf.text('Classificacao automatica com base em regras. Revise antes de enviar ao cliente.', m, H - 4);

    return pdf.output('blob') as Blob;
}

/**
 * Helper que dispara download de um Blob como arquivo. Centralizado pra
 * facilitar testes (mockando document.createElement).
 */
export function baixarBlob(blob: Blob, filename: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
