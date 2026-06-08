/**
 * lucroComparativoPdf.ts
 *
 * Gerador do PDF "Comparativo Presumido × Real" — relatorio executivo que
 * a S&P leva pra reuniao com cliente Lucro Presumido/Real pra mostrar
 * qual regime convem.
 *
 * Roda o motor `calcularLucro` duas vezes (forcando regime Presumido e Real),
 * compara totais por imposto, indica o vencedor e gera o PDF no padrao Big4
 * (capa + sumario executivo + premissas + apuracao por regime + comparativo +
 * recomendacao + disclaimer).
 *
 * Reusa services/reportTemplate.ts (paleta navy + gold + slate, capa formal,
 * header/footer em todas as paginas internas).
 */
import type { LucroInput, LucroResult, DetalheImposto } from '../types';
import { calcularLucro } from './lucroService';
import { setupReport, SP_COLORS, brl, pct, type ReportMeta } from './reportTemplate';

export interface ComparativoLucro {
    presumido: LucroResult;
    real: LucroResult;
    vencedor: 'Presumido' | 'Real' | 'Empate';
    economiaAnual: number;          // diferenca x 12 (ou x 4 se trimestral)
    diferencaPercentual: number;    // (perdedor - vencedor) / perdedor
}

/** Roda os 2 calculos e compara. Puro — sem I/O. */
export function compararRegimes(input: LucroInput): ComparativoLucro {
    const presumido = calcularLucro({ ...input, regimeSelecionado: 'Presumido' });
    const real = calcularLucro({ ...input, regimeSelecionado: 'Real' });

    const tolerancia = 0.01;
    let vencedor: 'Presumido' | 'Real' | 'Empate';
    let perdedor: LucroResult;
    if (Math.abs(presumido.totalImpostos - real.totalImpostos) < tolerancia) {
        vencedor = 'Empate';
        perdedor = real;
    } else if (presumido.totalImpostos < real.totalImpostos) {
        vencedor = 'Presumido';
        perdedor = real;
    } else {
        vencedor = 'Real';
        perdedor = presumido;
    }

    const diferenca = Math.abs(presumido.totalImpostos - real.totalImpostos);
    const periodos = input.periodoApuracao === 'Trimestral' ? 4 : 12;
    return {
        presumido,
        real,
        vencedor,
        economiaAnual: diferenca * periodos,
        diferencaPercentual: perdedor.totalImpostos > 0 ? diferenca / perdedor.totalImpostos : 0,
    };
}

interface PdfOpts {
    input: LucroInput;
    comparativo: ComparativoLucro;
    cliente?: string;
    clienteCnpj?: string;
    periodo?: string;
}

/** Gera o PDF e devolve o Blob pra download. */
export async function gerarPdfComparativoLucro(opts: PdfOpts): Promise<Blob> {
    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const meta: ReportMeta = {
        titulo: 'Comparativo Presumido × Real',
        subtitulo: 'Analise de regime tributario',
        cliente: opts.cliente,
        clienteCnpj: opts.clienteCnpj,
        periodo: opts.periodo,
    };
    const r = setupReport(pdf, meta);
    const { W, M } = r;

    // ─── CAPA ──────────────────────────────────────────────────────────────
    r.drawCover();

    // ─── SUMARIO EXECUTIVO ─────────────────────────────────────────────────
    let y = r.newPage();
    y = r.sectionTitle('Sumario Executivo', y);

    // Box de recomendacao destacado
    const comp = opts.comparativo;
    const ehEmpate = comp.vencedor === 'Empate';
    const corDestaque = ehEmpate ? SP_COLORS.warning : SP_COLORS.success;
    pdf.setFillColor(...corDestaque);
    pdf.rect(M, y, W - 2 * M, 16, 'F');
    pdf.setTextColor(...SP_COLORS.white);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    const recomendacaoTitulo = ehEmpate
        ? 'CARGA TRIBUTARIA EQUIVALENTE NOS DOIS REGIMES'
        : `REGIME RECOMENDADO: LUCRO ${comp.vencedor.toUpperCase()}`;
    pdf.text(recomendacaoTitulo, M + 4, y + 6);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    const recomendacaoSub = ehEmpate
        ? 'Sem ganho tributario direto entre os regimes nas condicoes informadas. Decisao por criterios operacionais.'
        : `Economia projetada de ${brl(comp.economiaAnual)} ao ano (${pct(comp.diferencaPercentual)} menor que o regime alternativo).`;
    pdf.text(recomendacaoSub, M + 4, y + 12);
    y += 20;

    // 4 KPI cards
    const kpiW = (W - 2 * M - 9) / 4;
    const kpis = [
        { label: 'PRESUMIDO', valor: brl(comp.presumido.totalImpostos), sub: `Carga ${pct(comp.presumido.cargaTributaria, 2)}`, cor: SP_COLORS.navy },
        { label: 'REAL', valor: brl(comp.real.totalImpostos), sub: `Carga ${pct(comp.real.cargaTributaria, 2)}`, cor: SP_COLORS.navy },
        { label: 'DIFERENCA', valor: brl(Math.abs(comp.presumido.totalImpostos - comp.real.totalImpostos)), sub: `Por periodo de apuracao`, cor: SP_COLORS.gold },
        { label: ehEmpate ? 'EMPATE' : 'ECONOMIA ANUAL', valor: ehEmpate ? '—' : brl(comp.economiaAnual), sub: ehEmpate ? '—' : `${comp.vencedor} venceu`, cor: ehEmpate ? SP_COLORS.warning : SP_COLORS.success },
    ];
    kpis.forEach((k, i) => {
        const x = M + i * (kpiW + 3);
        pdf.setDrawColor(...SP_COLORS.slate200);
        pdf.setFillColor(...SP_COLORS.slate100);
        pdf.roundedRect(x, y, kpiW, 22, 1.5, 1.5, 'FD');
        pdf.setTextColor(...SP_COLORS.slate600);
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'bold');
        pdf.text(k.label, x + 3, y + 5);
        pdf.setTextColor(...k.cor);
        pdf.setFontSize(13);
        pdf.text(k.valor, x + 3, y + 13);
        pdf.setTextColor(...SP_COLORS.slate400);
        pdf.setFontSize(7);
        pdf.setFont('helvetica', 'normal');
        pdf.text(k.sub, x + 3, y + 18);
    });
    y += 27;

    // Bullets de insight
    y = r.sectionTitle('Insights Principais', y);
    const insights: string[] = [];
    insights.push(
        ehEmpate
            ? 'A carga tributaria projetada e praticamente identica nos dois regimes. A decisao deve considerar custos administrativos (Real exige escrituracao contabil completa) e potencial de creditos PIS/COFINS futuros.'
            : `O regime ${comp.vencedor} apresenta carga tributaria ${pct(comp.diferencaPercentual)} menor neste cenario. Projetando para o ano completo, a economia estimada e de ${brl(comp.economiaAnual)}.`,
    );
    if (comp.presumido.alertaLc224 || comp.real.alertaLc224) {
        insights.push(
            'ATENCAO: Majoracao da LC 224/2025 esta sendo aplicada na simulacao. A vigencia assimetrica (IRPJ desde 1T/2026, CSLL desde 2T/2026) pode impactar a comparacao em trimestres especificos.',
        );
    }
    if (comp.real.saldoResidualPis || comp.real.saldoResidualCofins) {
        insights.push(
            `Lucro Real apresenta saldo residual de creditos PIS (${brl(comp.real.saldoResidualPis || 0)}) e COFINS (${brl(comp.real.saldoResidualCofins || 0)}) compensaveis em apuracoes futuras.`,
        );
    }
    insights.push(
        'A escolha do regime deve considerar projeção anual de receita, margem operacional, perfil de despesas dedutiveis e estrategia de creditos não-cumulativos.',
    );
    insights.forEach((ins) => {
        pdf.setFillColor(...SP_COLORS.gold);
        pdf.circle(M + 1.5, y - 1, 0.8, 'F');
        y = r.paragraph(ins, y, { size: 8 });
        y += 1;
    });

    // ─── PREMISSAS (PAGINA 2) ──────────────────────────────────────────────
    y = r.newPage();
    y = r.sectionTitle('Premissas da Simulacao', y);
    y = r.paragraph(
        'Os calculos abaixo utilizam os dados informados pelo usuario no Dashboard Lucro Presumido/Real. ' +
        `Periodo de apuracao: ${opts.input.periodoApuracao}.`,
        y, { size: 8 },
    );
    y += 4;

    const premissas: Array<[string, string]> = [
        ['Faturamento Comercio', brl(opts.input.faturamentoComercio || 0)],
        ['Faturamento Industria', brl(opts.input.faturamentoIndustria || 0)],
        ['Faturamento Servicos', brl(opts.input.faturamentoServico || 0)],
        ['Receita Financeira', brl(opts.input.receitaFinanceira || 0)],
        ['Faturamento Monofasico', brl(opts.input.faturamentoMonofasico || 0)],
        ['Despesas Operacionais', brl(opts.input.despesasOperacionais || 0)],
        ['Despesas Dedutiveis (PIS/COFINS)', brl(opts.input.despesasDedutiveis || 0)],
        ['Folha de Pagamento', brl(opts.input.folhaPagamento || 0)],
    ];
    y = renderKeyValueTable(pdf, premissas, y, M, W);
    y += 4;

    // ─── APURACAO PRESUMIDO ────────────────────────────────────────────────
    if (y > 230) y = r.newPage();
    y = r.sectionTitle('Apuracao — Lucro Presumido', y, SP_COLORS.navy);
    y = renderApuracao(pdf, comp.presumido, y, M, W);
    y += 6;

    // ─── APURACAO REAL ─────────────────────────────────────────────────────
    if (y > 220) y = r.newPage();
    y = r.sectionTitle('Apuracao — Lucro Real', y, SP_COLORS.navy);
    y = renderApuracao(pdf, comp.real, y, M, W);
    y += 6;

    // ─── COMPARATIVO POR IMPOSTO ───────────────────────────────────────────
    if (y > 200) y = r.newPage();
    y = r.sectionTitle('Comparativo Detalhado por Imposto', y, SP_COLORS.gold);
    y = renderComparativoImpostos(pdf, comp, y, M, W);
    y += 6;

    // ─── DISCLAIMER ────────────────────────────────────────────────────────
    if (y > 235) y = r.newPage();
    y = r.disclaimer(y);

    // ─── FOOTER em todas as paginas internas (capa nao tem) ────────────────
    const totalPages = (pdf as any).internal.getNumberOfPages();
    for (let p = 2; p <= totalPages; p++) {
        pdf.setPage(p);
        (r as any).pageNum = p;
        r.drawFooter(totalPages + 1);
    }

    return pdf.output('blob');
}

// ─── Helpers de tabela ──────────────────────────────────────────────────────

function renderKeyValueTable(pdf: any, rows: Array<[string, string]>, y: number, M: number, W: number): number {
    const rowH = 5;
    const colW = (W - 2 * M) / 2;
    rows.forEach((r, i) => {
        if (i % 2 === 1) {
            pdf.setFillColor(...SP_COLORS.slate100);
            pdf.rect(M, y - 3.5, W - 2 * M, rowH, 'F');
        }
        pdf.setTextColor(...SP_COLORS.slate600);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.text(r[0], M + 2, y);
        pdf.setTextColor(...SP_COLORS.slate900);
        pdf.setFont('helvetica', 'bold');
        pdf.text(r[1], M + colW * 2 - 2, y, { align: 'right' });
        y += rowH;
    });
    return y;
}

function renderApuracao(pdf: any, result: any, y: number, M: number, W: number): number {
    // Header tabela
    const cols = [
        { titulo: 'Imposto', w: 50, align: 'left' as const },
        { titulo: 'Base de Calculo', w: 40, align: 'right' as const },
        { titulo: 'Aliquota', w: 25, align: 'right' as const },
        { titulo: 'Valor', w: 35, align: 'right' as const },
        { titulo: 'Obs.', w: 24, align: 'left' as const },
    ];
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
        const tx = c.align === 'right' ? cx + c.w - 2 : cx;
        pdf.text(c.titulo.toUpperCase(), tx, y + 4, { align: c.align });
        cx += c.w;
    });
    y += 6;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    (result.detalhamento as DetalheImposto[]).forEach((d, i) => {
        if (i % 2 === 1) {
            pdf.setFillColor(...SP_COLORS.slate100);
            pdf.rect(tableX, y, tableW, rowH, 'F');
        }
        pdf.setTextColor(...SP_COLORS.slate900);
        cx = tableX + 2;
        const cels: Array<[string, 'left' | 'right']> = [
            [d.imposto, 'left'],
            [brl(d.baseCalculo), 'right'],
            [pct(d.aliquota), 'right'],
            [brl(d.valor), 'right'],
            [(d.observacao || '').slice(0, 20), 'left'],
        ];
        cels.forEach((cel, ci) => {
            const col = cols[ci];
            if (!col) return;
            const tx = cel[1] === 'right' ? cx + col.w - 2 : cx;
            pdf.text(cel[0], tx, y + 3.5, { align: cel[1] });
            cx += col.w;
        });
        y += rowH;
    });

    // Linha total
    pdf.setDrawColor(...SP_COLORS.slate200);
    pdf.line(tableX, y, tableX + tableW, y);
    y += 2;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(...SP_COLORS.navy);
    pdf.text('TOTAL DE IMPOSTOS', tableX + 2, y + 3);
    pdf.text(brl(result.totalImpostos), tableX + tableW - 2, y + 3, { align: 'right' });
    y += 6;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(...SP_COLORS.slate600);
    pdf.text(`Carga tributaria efetiva: ${pct(result.cargaTributaria, 2)}`, tableX + 2, y + 2);
    pdf.text(`Lucro liquido estimado: ${brl(result.lucroLiquidoEstimado)}`, tableX + tableW - 2, y + 2, { align: 'right' });
    return y + 6;
}

function renderComparativoImpostos(pdf: any, comp: ComparativoLucro, y: number, M: number, W: number): number {
    const cols = [
        { titulo: 'Imposto', w: 50, align: 'left' as const },
        { titulo: 'Presumido', w: 38, align: 'right' as const },
        { titulo: 'Real', w: 38, align: 'right' as const },
        { titulo: 'Diferenca', w: 35, align: 'right' as const },
        { titulo: 'Menor', w: 13, align: 'center' as const },
    ];
    const tableW = cols.reduce((s, c) => s + c.w, 0);
    const tableX = M;
    const rowH = 5;

    pdf.setFillColor(...SP_COLORS.gold);
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

    // Junta impostos dos dois regimes (alguns podem aparecer só em um).
    const mapaP = new Map(comp.presumido.detalhamento.map(d => [d.imposto, d.valor]));
    const mapaR = new Map(comp.real.detalhamento.map(d => [d.imposto, d.valor]));
    const todos = new Set([...mapaP.keys(), ...mapaR.keys()]);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    let i = 0;
    for (const imp of todos) {
        const vp = mapaP.get(imp) || 0;
        const vr = mapaR.get(imp) || 0;
        const dif = vp - vr;
        const menor = Math.abs(dif) < 0.01 ? '=' : (vp < vr ? 'P' : 'R');

        if (i % 2 === 1) {
            pdf.setFillColor(...SP_COLORS.slate100);
            pdf.rect(tableX, y, tableW, rowH, 'F');
        }
        pdf.setTextColor(...SP_COLORS.slate900);
        cx = tableX + 2;
        const cels: Array<[string, 'left' | 'right' | 'center']> = [
            [imp, 'left'],
            [brl(vp), 'right'],
            [brl(vr), 'right'],
            [(dif >= 0 ? '+' : '') + brl(dif), 'right'],
            [menor, 'center'],
        ];
        cels.forEach((cel, ci) => {
            const col = cols[ci];
            if (!col) return;
            const tx = cel[1] === 'right' ? cx + col.w - 2 : cel[1] === 'center' ? cx + col.w / 2 : cx;
            // Colore "Menor" em verde, "Maior" em vermelho na coluna Diferenca.
            if (ci === 3 && Math.abs(dif) >= 0.01) {
                pdf.setTextColor(...(dif < 0 ? SP_COLORS.danger : SP_COLORS.success));
            } else if (ci === 4) {
                pdf.setTextColor(...(menor === '=' ? SP_COLORS.slate600 : menor === 'P' ? SP_COLORS.navy : SP_COLORS.gold));
                pdf.setFont('helvetica', 'bold');
            }
            pdf.text(cel[0], tx, y + 3.5, { align: cel[1] });
            pdf.setTextColor(...SP_COLORS.slate900);
            pdf.setFont('helvetica', 'normal');
            cx += col.w;
        });
        y += rowH;
        i++;
    }

    pdf.setDrawColor(...SP_COLORS.slate200);
    pdf.line(tableX, y, tableX + tableW, y);
    y += 2;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(...SP_COLORS.navy);
    pdf.text('TOTAL', tableX + 2, y + 3);
    pdf.text(brl(comp.presumido.totalImpostos), tableX + 50 + 38 - 2, y + 3, { align: 'right' });
    pdf.text(brl(comp.real.totalImpostos), tableX + 50 + 38 + 38 - 2, y + 3, { align: 'right' });
    const difTotal = comp.presumido.totalImpostos - comp.real.totalImpostos;
    pdf.setTextColor(...(difTotal < 0 ? SP_COLORS.success : difTotal > 0 ? SP_COLORS.danger : SP_COLORS.slate600));
    pdf.text((difTotal >= 0 ? '+' : '') + brl(difTotal), tableX + 50 + 38 + 38 + 35 - 2, y + 3, { align: 'right' });
    pdf.setTextColor(...(comp.vencedor === 'Presumido' ? SP_COLORS.navy : comp.vencedor === 'Real' ? SP_COLORS.gold : SP_COLORS.slate600));
    pdf.text(comp.vencedor === 'Presumido' ? 'P' : comp.vencedor === 'Real' ? 'R' : '=', tableX + tableW - 13 / 2, y + 3, { align: 'center' });
    return y + 6;
}
