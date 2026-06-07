/**
 * reportTemplate.ts
 *
 * Template Big4 reutilizavel para relatorios em PDF (jsPDF). Garante padrao
 * visual consistente em TODOS os relatorios futuros: paleta, tipografia,
 * capa, header, footer, secoes e disclaimer.
 *
 * Origem: a S&P Assessoria Contabil quer relatorios no estilo PwC/Deloitte
 * (sobrio, executivo, com sumario e disclaimer). Antes, cada relatorio fazia
 * do seu jeito — XML/Retencoes/DANFSe ja eram bons (paleta navy), mas os
 * outros eram capturas HTML genericas.
 *
 * NAO usa imagem/logo — branding e textual ("S&P ASSESSORIA CONTABIL").
 * Adicionar logo .png depois e direto: setar logoDataUrl no setup.
 */

// Sem `import jsPDF` aqui — quem chamar passa a instancia (jsPDF e ESM e
// importado dinamicamente pra nao inflar bundle).
type Color = [number, number, number];

// ── Paleta institucional S&P ─────────────────────────────────────────────
export const SP_COLORS = {
    navy: [30, 64, 175] as Color,            // #1E40AF brand primaria
    navyDeep: [2, 0, 38] as Color,           // #020026 fundo capa/header
    gold: [201, 161, 74] as Color,           // #C9A14A accent (do DANFSe)
    slate900: [15, 23, 42] as Color,         // #0F172A texto forte
    slate600: [71, 85, 105] as Color,        // #475569 texto medio
    slate400: [148, 163, 184] as Color,      // #94A3B8 texto muted
    slate100: [241, 245, 249] as Color,      // #F1F5F9 fundo tabela
    slate200: [226, 232, 240] as Color,      // #E2E8F0 borda
    white: [255, 255, 255] as Color,
    success: [16, 122, 87] as Color,         // #107657 verde
    danger: [220, 38, 38] as Color,          // #DC2626 vermelho
    warning: [217, 119, 6] as Color,         // #D97706 ambar
} as const;

export interface ReportMeta {
    /** Titulo do relatorio (ex: "Comparativo Presumido × Real"). */
    titulo: string;
    /** Subtitulo (ex: "Apuracao tributaria — junho/2026"). */
    subtitulo?: string;
    /** Nome do cliente (empresa). */
    cliente?: string;
    /** CNPJ do cliente (mascarado). */
    clienteCnpj?: string;
    /** Periodo de referencia (ex: "06/2026" ou "1T/2026"). */
    periodo?: string;
    /** Data de emissao do relatorio (default = agora). */
    emitidoEm?: Date;
    /** Texto legal no rodape de cada pagina. Default "S&P Assessoria Contabil". */
    rodape?: string;
}

// ─── Funcoes standalone (podem ser usadas por relatorios que NAO querem o
// setup completo — ex: XML/Retencoes que ja tinham proprio header/footer e
// so precisam ganhar capa Big4 + disclaimer no final). ─────────────────────

/** Desenha capa institucional na PAGINA ATUAL do PDF (substitui conteudo). */
export function drawBig4Cover(pdf: any, meta: ReportMeta): void {
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const M = 18;

    pdf.setFillColor(...SP_COLORS.navyDeep);
    pdf.rect(0, 0, W, H, 'F');
    pdf.setFillColor(...SP_COLORS.gold);
    pdf.rect(0, 0, 4, H, 'F');

    pdf.setTextColor(...SP_COLORS.gold);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.text('S&P ASSESSORIA CONTABIL', M, 30);

    pdf.setTextColor(...SP_COLORS.slate400);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.text('RELATORIO TECNICO CONFIDENCIAL', M, 36);

    pdf.setTextColor(...SP_COLORS.white);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(28);
    const tituloLinhas = pdf.splitTextToSize(meta.titulo, W - 2 * M);
    pdf.text(tituloLinhas, M, H / 2 - 20);

    if (meta.subtitulo) {
        pdf.setTextColor(...SP_COLORS.gold);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(13);
        pdf.text(meta.subtitulo, M, H / 2 - 5);
    }

    const infoY = H / 2 + 25;
    pdf.setTextColor(...SP_COLORS.slate400);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text('CLIENTE', M, infoY);
    pdf.text('PERIODO', M + 75, infoY);
    pdf.text('EMITIDO EM', M + 130, infoY);

    pdf.setTextColor(...SP_COLORS.white);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    const clienteTxt = meta.cliente || '—';
    const clienteLinhas = pdf.splitTextToSize(clienteTxt, 70);
    pdf.text(clienteLinhas, M, infoY + 6);
    if (meta.clienteCnpj) {
        pdf.setTextColor(...SP_COLORS.slate400);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.text(meta.clienteCnpj, M, infoY + 6 + clienteLinhas.length * 5);
    }

    pdf.setTextColor(...SP_COLORS.white);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text(meta.periodo || '—', M + 75, infoY + 6);

    const dt = (meta.emitidoEm || new Date()).toLocaleDateString('pt-BR');
    pdf.text(dt, M + 130, infoY + 6);

    pdf.setTextColor(...SP_COLORS.slate400);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.text(
        'Documento gerado automaticamente. As informacoes refletem a simulacao com dados informados pelo usuario e nao substituem parecer formal de profissional habilitado.',
        M, H - 18, { maxWidth: W - 2 * M },
    );
}

/** Desenha titulo de secao + paragrafo de disclaimer formal a partir de Y. */
export function drawBig4Disclaimer(pdf: any, yStart: number): number {
    const W = pdf.internal.pageSize.getWidth();
    const M = 18;

    pdf.setFillColor(...SP_COLORS.gold);
    pdf.rect(M, yStart, 1.2, 6, 'F');
    pdf.setTextColor(...SP_COLORS.slate900);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text('Disclaimer e Notas Tecnicas', M + 4, yStart + 5);
    let y = yStart + 9;

    pdf.setTextColor(...SP_COLORS.slate600);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    const txt =
        'Este relatorio foi gerado por sistema com base nos dados informados pelo usuario na competencia indicada na capa. ' +
        'As simulacoes consideram a legislacao vigente na data de emissao, incluindo as alteracoes da LC 214/2025 (Reforma Tributaria) ' +
        'quando aplicaveis ao periodo. Variacoes na receita real, regimes especiais, beneficios fiscais nao informados e operacoes ' +
        'atipicas podem alterar significativamente os valores apurados. As informacoes sao referenciais e nao substituem ' +
        'analise individualizada por contador responsavel.';
    const linhas = pdf.splitTextToSize(txt, W - 2 * M);
    pdf.text(linhas, M, y);
    return y + linhas.length * (8 * 0.45);
}

/**
 * Setup do PDF — desenha capa institucional e devolve API com helpers
 * (drawHeader, drawFooter, addSection, addTable, addKpiCards, etc).
 * Retorna a posicao Y atual e o pageNum corrente — quem chama controla o
 * cursor e adiciona paginas conforme necessario.
 */
export function setupReport(pdf: any, meta: ReportMeta) {
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const M = 18;
    let pageNum = 1;

    const setColor = (kind: 'fill' | 'text' | 'draw', c: Color) => {
        if (kind === 'fill') pdf.setFillColor(...c);
        else if (kind === 'text') pdf.setTextColor(...c);
        else pdf.setDrawColor(...c);
    };

    // ─── CAPA ──────────────────────────────────────────────────────────────
    // Delega pra funcao standalone (mesmo codigo, sem duplicacao).
    const drawCover = () => drawBig4Cover(pdf, meta);


    // ─── HEADER de paginas internas ────────────────────────────────────────
    const drawHeader = () => {
        // Faixa navy
        setColor('fill', SP_COLORS.navy);
        pdf.rect(0, 0, W, 14, 'F');
        // Acento gold
        setColor('fill', SP_COLORS.gold);
        pdf.rect(0, 14, W, 0.8, 'F');

        setColor('text', SP_COLORS.white);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10);
        pdf.text(meta.titulo, M, 9);

        setColor('text', SP_COLORS.white);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        const right = meta.cliente ? `${meta.cliente} · ${meta.periodo || ''}` : (meta.periodo || '');
        if (right) pdf.text(right.trim().replace(/·\s*$/, ''), W - M, 9, { align: 'right' });
    };

    // ─── FOOTER de paginas internas ────────────────────────────────────────
    const drawFooter = (totalPages: number) => {
        setColor('draw', SP_COLORS.slate200);
        pdf.line(M, H - 12, W - M, H - 12);

        setColor('text', SP_COLORS.slate400);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.text(meta.rodape || 'S&P ASSESSORIA CONTABIL', M, H - 7);
        pdf.text(`Pagina ${pageNum - 1} de ${totalPages - 1}`, W / 2, H - 7, { align: 'center' });
        pdf.text((meta.emitidoEm || new Date()).toLocaleDateString('pt-BR'), W - M, H - 7, { align: 'right' });
    };

    /** Adiciona uma nova pagina interna (header desenhado automaticamente).
     *  Retorna o Y inicial pra escrever conteudo. */
    const newPage = (): number => {
        pdf.addPage();
        pageNum++;
        drawHeader();
        return 24;
    };

    /** Titulo de secao com barra colorida. Avanca o cursor. */
    const sectionTitle = (titulo: string, y: number, cor: Color = SP_COLORS.navy): number => {
        setColor('fill', cor);
        pdf.rect(M, y, 1.2, 6, 'F');
        setColor('text', SP_COLORS.slate900);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.text(titulo, M + 4, y + 5);
        return y + 9;
    };

    /** Paragrafo de texto. Avanca o cursor. */
    const paragraph = (txt: string, y: number, opts: { size?: number; color?: Color; bold?: boolean } = {}): number => {
        const size = opts.size ?? 9;
        setColor('text', opts.color ?? SP_COLORS.slate600);
        pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal');
        pdf.setFontSize(size);
        const linhas = pdf.splitTextToSize(txt, W - 2 * M);
        pdf.text(linhas, M, y);
        return y + linhas.length * (size * 0.45);
    };

    /** Disclaimer formal — delega pra funcao standalone. */
    const disclaimer = (y: number): number => {
        let cur = drawBig4Disclaimer(pdf, y);
        return cur + 3;
    };

    return {
        W, H, M, SP_COLORS,
        get pageNum() { return pageNum; },
        drawCover,
        drawHeader,
        drawFooter,
        newPage,
        sectionTitle,
        paragraph,
        disclaimer,
    };
}

/** Helper: formata numero como moeda BRL. */
export function brl(n: number): string {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
}

/** Helper: formata numero como percentual. */
export function pct(n: number, casas = 2): string {
    return `${(n * 100).toFixed(casas).replace('.', ',')}%`;
}
