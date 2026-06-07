/**
 * sageReportPdf.ts
 *
 * Gera o relatorio FINAL pro cliente da analise SAGE em PDF Big4. Cliente
 * recebe, nao manipula (XLSX permitia editar — gap apontado pelo Paulo).
 * Filtros/opcoes sao escolhidos pelo colaborador na tela; o sistema gera
 * o relatorio fechado.
 *
 * Estrutura:
 *  - Capa institucional (services/reportTemplate.ts)
 *  - Sumario Executivo: KPIs + alertas criticos + recomendacao
 *  - Quebra por sentido (entrada/saida)
 *  - Quebra por status (canceladas/denegadas/inutilizadas)
 *  - Gaps de numeracao (tabela com top 20 + agregado restante)
 *  - Disclaimer
 *
 * O XLSX continua existindo em `exportarAnalise()` pra trabalho interno
 * (NAO e entregue ao cliente).
 */
import type { SageAnalise, SageNota, GapNumeracao } from './sageReportService';
import { setupReport, SP_COLORS, brl, type ReportMeta } from './reportTemplate';

interface PdfOpts {
    analise: SageAnalise;
    cliente?: string;
    clienteCnpj?: string;
    periodo?: string;
}

/** Gera o PDF e devolve o Blob. */
export async function gerarPdfAnaliseSage(opts: PdfOpts): Promise<Blob> {
    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const meta: ReportMeta = {
        titulo: 'Analise Relatorio SAGE',
        subtitulo: 'Conferencia de notas fiscais por status e numeracao',
        cliente: opts.cliente,
        clienteCnpj: opts.clienteCnpj,
        periodo: opts.periodo,
    };
    const r = setupReport(pdf, meta);
    const { W, M } = r;
    const { analise } = opts;

    // ─── CAPA ──────────────────────────────────────────────────────────────
    r.drawCover();

    // ─── SUMARIO EXECUTIVO ─────────────────────────────────────────────────
    let y = r.newPage();
    y = r.sectionTitle('Sumario Executivo', y);

    // Determina severidade global
    const taxaCancelamento = analise.totalNotas > 0
        ? analise.resumo.canceladas / analise.totalNotas : 0;
    const temGapsRelevantes = analise.resumo.notasFaltantes > 10;
    const severo = taxaCancelamento > 0.05 || temGapsRelevantes || analise.resumo.denegadas > 0;
    const corDestaque = severo ? SP_COLORS.danger : (taxaCancelamento > 0.02 ? SP_COLORS.warning : SP_COLORS.success);

    // Banner de status
    pdf.setFillColor(...corDestaque);
    pdf.rect(M, y, W - 2 * M, 16, 'F');
    pdf.setTextColor(...SP_COLORS.white);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text(
        severo ? 'ATENCAO — INCONSISTENCIAS RELEVANTES IDENTIFICADAS' :
        taxaCancelamento > 0.02 ? 'PONTOS DE ATENCAO — RECOMENDA-SE REVISAO' :
        'BASE DE NOTAS CONSISTENTE',
        M + 4, y + 6,
    );
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(
        `${analise.totalNotas} nota(s) analisada(s) · ${analise.resumo.canceladas} cancelada(s) · ${analise.resumo.gapsTotal} faixa(s) com gap · ${analise.resumo.notasFaltantes} numero(s) faltante(s).`,
        M + 4, y + 12,
    );
    y += 20;

    // 6 KPI cards em 2 linhas de 3
    const kpiW = (W - 2 * M - 6) / 3;
    const linha1 = [
        { label: 'TOTAL DE NOTAS', valor: String(analise.totalNotas), sub: `${analise.tabsLidas.length} aba(s) lida(s)`, cor: SP_COLORS.navy },
        { label: 'ENTRADAS', valor: String(analise.porSentido.entrada.length), sub: `${analise.porSentido.saida.length} saidas`, cor: SP_COLORS.navy },
        { label: 'REGULARES', valor: String(analise.resumo.regulares), sub: `${analise.totalNotas > 0 ? Math.round(analise.resumo.regulares / analise.totalNotas * 100) : 0}% do total`, cor: SP_COLORS.success },
    ];
    const linha2 = [
        { label: 'CANCELADAS', valor: String(analise.resumo.canceladas), sub: `${(taxaCancelamento * 100).toFixed(1)}% do total`, cor: taxaCancelamento > 0.05 ? SP_COLORS.danger : SP_COLORS.warning },
        { label: 'DENEGADAS', valor: String(analise.resumo.denegadas), sub: analise.resumo.denegadas > 0 ? 'requer auditoria' : '—', cor: analise.resumo.denegadas > 0 ? SP_COLORS.danger : SP_COLORS.slate600 },
        { label: 'GAPS DE NUMERACAO', valor: String(analise.resumo.gapsTotal), sub: `${analise.resumo.notasFaltantes} nota(s) faltante(s)`, cor: temGapsRelevantes ? SP_COLORS.danger : SP_COLORS.slate600 },
    ];

    const renderKpiRow = (linha: typeof linha1, yRow: number) => {
        linha.forEach((k, i) => {
            const x = M + i * (kpiW + 3);
            pdf.setDrawColor(...SP_COLORS.slate200);
            pdf.setFillColor(...SP_COLORS.slate100);
            pdf.roundedRect(x, yRow, kpiW, 22, 1.5, 1.5, 'FD');
            pdf.setTextColor(...SP_COLORS.slate600);
            pdf.setFontSize(7);
            pdf.setFont('helvetica', 'bold');
            pdf.text(k.label, x + 3, yRow + 5);
            pdf.setTextColor(...k.cor);
            pdf.setFontSize(14);
            pdf.text(k.valor, x + 3, yRow + 13);
            pdf.setTextColor(...SP_COLORS.slate400);
            pdf.setFontSize(7);
            pdf.setFont('helvetica', 'normal');
            pdf.text(k.sub, x + 3, yRow + 18);
        });
    };
    renderKpiRow(linha1, y);
    y += 25;
    renderKpiRow(linha2, y);
    y += 28;

    // Insights
    y = r.sectionTitle('Pontos de Atencao', y);
    const insights: string[] = [];
    if (analise.resumo.canceladas > 0) {
        insights.push(
            `${analise.resumo.canceladas} nota(s) cancelada(s) identificada(s) (${(taxaCancelamento * 100).toFixed(1)}% do total). ${taxaCancelamento > 0.05 ? 'Taxa elevada — recomenda-se investigar causas operacionais (re-emissao, divergencia cadastral) antes do fechamento.' : 'Dentro de patamar aceitavel para operacoes regulares.'}`,
        );
    }
    if (analise.resumo.denegadas > 0) {
        insights.push(
            `${analise.resumo.denegadas} nota(s) denegada(s) pela SEFAZ. Denegacao indica problema cadastral grave (CNPJ irregular, IE invalida). Requer revisao caso a caso.`,
        );
    }
    if (analise.resumo.inutilizadas > 0) {
        insights.push(
            `${analise.resumo.inutilizadas} nota(s) inutilizada(s). Verificar se ha justificativa cadastrada na SEFAZ para cada inutilizacao.`,
        );
    }
    if (analise.resumo.gapsTotal > 0) {
        insights.push(
            `${analise.resumo.gapsTotal} faixa(s) de numeracao com falha de sequencia, totalizando ${analise.resumo.notasFaltantes} numero(s) faltante(s). Pode indicar nota emitida sem importacao no SAGE ou registro incompleto.`,
        );
    }
    if (insights.length === 0) {
        insights.push('Base de notas integra. Sem cancelamentos, denegacoes ou gaps de numeracao relevantes no periodo.');
    }
    if (analise.avisos.length > 0) {
        insights.push(`Avisos de processamento: ${analise.avisos.slice(0, 2).join(' · ')}`);
    }
    insights.forEach((ins) => {
        pdf.setFillColor(...SP_COLORS.gold);
        pdf.circle(M + 1.5, y - 1, 0.8, 'F');
        y = r.paragraph(ins, y, { size: 8 });
        y += 1;
    });

    // ─── GAPS DE NUMERACAO ─────────────────────────────────────────────────
    if (analise.gaps.length > 0) {
        if (y > 200) y = r.newPage();
        y = r.sectionTitle('Gaps de Numeracao', y, SP_COLORS.danger);
        y = r.paragraph(
            'Faixas de numeracao com numero(s) intermediario(s) ausente(s). Cada linha representa um intervalo continuo nao localizado na base SAGE para determinado CNPJ+serie+sentido.',
            y, { size: 8 },
        );
        y += 3;
        y = renderTabela(pdf, [
            { titulo: 'Sentido', w: 18, align: 'left' },
            { titulo: 'CNPJ / Razao Social', w: 90, align: 'left' },
            { titulo: 'Serie', w: 14, align: 'center' },
            { titulo: 'De', w: 18, align: 'right' },
            { titulo: 'Ate', w: 18, align: 'right' },
            { titulo: 'Qtd', w: 16, align: 'right' },
        ],
        analise.gaps.slice(0, 25).map((g: GapNumeracao) => [
            g.sentido,
            `${g.cnpj} · ${truncate(g.razaoSocial, 32)}`,
            g.serie || '—',
            String(g.de),
            String(g.ate),
            String(g.quantidade),
        ]),
        y, M, W, r);
        if (analise.gaps.length > 25) {
            y = r.paragraph(`+ ${analise.gaps.length - 25} faixa(s) adicional(is) nao listadas neste resumo.`, y + 1, { size: 7, color: SP_COLORS.slate400 });
        }
        y += 5;
    }

    // ─── CANCELADAS / DENEGADAS / INUTILIZADAS ─────────────────────────────
    const grupos: Array<{ titulo: string; cor: any; lista: SageNota[] }> = [
        { titulo: 'Notas Canceladas', cor: SP_COLORS.warning, lista: analise.porStatus.cancelada },
        { titulo: 'Notas Denegadas', cor: SP_COLORS.danger, lista: analise.porStatus.denegada },
        { titulo: 'Notas Inutilizadas', cor: SP_COLORS.warning, lista: analise.porStatus.inutilizada },
    ];

    for (const grupo of grupos) {
        if (grupo.lista.length === 0) continue;
        if (y > 220) y = r.newPage();
        y = r.sectionTitle(`${grupo.titulo} (${grupo.lista.length})`, y, grupo.cor);
        y = renderTabela(pdf, [
            { titulo: 'NF', w: 22, align: 'left' },
            { titulo: 'Serie', w: 14, align: 'center' },
            { titulo: 'Emissao', w: 22, align: 'center' },
            { titulo: 'CNPJ / Razao Social', w: 78, align: 'left' },
            { titulo: 'CFOP', w: 14, align: 'center' },
            { titulo: 'Valor', w: 24, align: 'right' },
        ],
        grupo.lista.slice(0, 30).map((n: SageNota) => [
            n.numeroRaw || '—',
            n.serie || '—',
            n.dataEmissao || '—',
            `${n.cnpj} · ${truncate(n.razaoSocial, 28)}`,
            n.cfop || '—',
            brl(n.valor || 0),
        ]),
        y, M, W, r);
        if (grupo.lista.length > 30) {
            y = r.paragraph(`+ ${grupo.lista.length - 30} nota(s) adicional(is) nao listadas neste resumo.`, y + 1, { size: 7, color: SP_COLORS.slate400 });
        }
        y += 5;
    }

    // ─── DISCLAIMER ────────────────────────────────────────────────────────
    if (y > 235) y = r.newPage();
    y = r.disclaimer(y);

    // FOOTER em todas as paginas internas
    const totalPages = (pdf as any).internal.getNumberOfPages();
    for (let p = 2; p <= totalPages; p++) {
        pdf.setPage(p);
        (r as any).pageNum = p;
        r.drawFooter(totalPages + 1);
    }

    return pdf.output('blob');
}

// ─── helpers ───────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
    if (!s) return '—';
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

interface Col { titulo: string; w: number; align: 'left' | 'right' | 'center'; }

function renderTabela(pdf: any, cols: Col[], rows: string[][], y: number, M: number, W: number, _r: any): number {
    const tableW = cols.reduce((s, c) => s + c.w, 0);
    const tableX = M;
    const rowH = 5;

    pdf.setFillColor(...SP_COLORS.navy);
    pdf.rect(tableX, y, tableW, 6, 'F');
    pdf.setTextColor(...SP_COLORS.white);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    let cx = tableX + 2;
    cols.forEach(c => {
        const tx = c.align === 'right' ? cx + c.w - 2 : c.align === 'center' ? cx + c.w / 2 : cx;
        pdf.text(c.titulo.toUpperCase(), tx, y + 4, { align: c.align });
        cx += c.w;
    });
    y += 6;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    rows.forEach((row, i) => {
        if (i % 2 === 1) {
            pdf.setFillColor(...SP_COLORS.slate100);
            pdf.rect(tableX, y, tableW, rowH, 'F');
        }
        pdf.setTextColor(...SP_COLORS.slate900);
        cx = tableX + 2;
        row.forEach((cel, ci) => {
            const c = cols[ci];
            const tx = c.align === 'right' ? cx + c.w - 2 : c.align === 'center' ? cx + c.w / 2 : cx;
            pdf.text(cel, tx, y + 3.5, { align: c.align });
            cx += c.w;
        });
        y += rowH;
    });
    return y;
}
