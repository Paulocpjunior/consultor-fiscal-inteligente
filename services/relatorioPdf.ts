/**
 * relatorioPdf.ts — casca PDF com a identidade da SP Assessoria Contábil.
 *
 * Formato escolhido pelo Paulo pro menu Relatórios (01/08): PDF com a cara da
 * SP — logo, cores do logo (#0E3BFA/#091D8D, as mesmas da casca de e-mail da
 * Legalização) e rodapé padrão. Toda aba do hub usa ESTA casca: cabeçalho,
 * tabela com quebra de página e numeração saem daqui, a aba só entrega
 * título, período e linhas.
 */

export interface ColunaPdf {
    titulo: string;
    /** Largura relativa (soma livre — normalizada pra área útil). */
    largura: number;
    alinhamento?: 'esquerda' | 'direita';
}

export interface RelatorioPdfParams {
    titulo: string;
    /** Ex.: 'Competência 06/2026 · EDUARDO GUERRA HORTIFRUTI'. */
    subtitulo: string;
    colunas: ColunaPdf[];
    linhas: (string | number)[][];
    /** Linha de totais (mesmo shape das linhas) — sai destacada no fim. */
    totais?: (string | number)[];
    /** Observações no rodapé do relatório (uma por linha). */
    observacoes?: string[];
    orientacao?: 'portrait' | 'landscape';
    fileName: string;
}

const AZUL: [number, number, number] = [14, 59, 250];      // #0E3BFA
const AZUL_ESCURO: [number, number, number] = [9, 29, 141]; // #091D8D
const TINTA: [number, number, number] = [30, 41, 59];
const CINZA: [number, number, number] = [100, 116, 139];
const BORDA: [number, number, number] = [203, 213, 225];

let logoCache: string | null | undefined;

/** Logo da SP como dataURL (uma busca por sessão; sem logo o PDF sai igual). */
async function carregarLogo(): Promise<string | null> {
    if (logoCache !== undefined) return logoCache;
    try {
        const r = await fetch('/sp-logo.png');
        if (!r.ok) throw new Error(String(r.status));
        const blob = await r.blob();
        logoCache = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = reject;
            fr.readAsDataURL(blob);
        });
    } catch {
        logoCache = null;
    }
    return logoCache;
}

export async function gerarRelatorioPdf(p: RelatorioPdfParams): Promise<void> {
    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: p.orientacao || 'landscape', unit: 'mm', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const M = 10;
    const logo = await carregarLogo();

    const somaLarguras = p.colunas.reduce((a, c) => a + c.largura, 0);
    const areaUtil = W - 2 * M;
    const larguras = p.colunas.map(c => (c.largura / somaLarguras) * areaUtil);

    const fmtCell = (v: string | number) =>
        typeof v === 'number'
            ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : String(v ?? '');

    let paginas = 0;
    let y = 0;

    const cabecalho = () => {
        paginas++;
        // Faixa da marca.
        pdf.setFillColor(...AZUL_ESCURO);
        pdf.rect(0, 0, W, 16, 'F');
        if (logo) {
            try { pdf.addImage(logo, 'PNG', M, 2.5, 11, 11); } catch { /* logo corrompido não derruba o PDF */ }
        }
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(11).setFont('helvetica', 'bold');
        pdf.text(p.titulo, logo ? M + 14 : M, 8);
        pdf.setFontSize(8).setFont('helvetica', 'normal');
        pdf.text(p.subtitulo, logo ? M + 14 : M, 12.5);
        pdf.setFontSize(7);
        pdf.text('SP Assessoria Contábil · Consultor Fiscal Inteligente', W - M, 8, { align: 'right' });
        pdf.text(new Date().toLocaleString('pt-BR'), W - M, 12.5, { align: 'right' });

        // Cabeçalho da tabela.
        y = 22;
        pdf.setFillColor(...AZUL);
        pdf.rect(M, y - 4, areaUtil, 6, 'F');
        pdf.setTextColor(255, 255, 255).setFontSize(7).setFont('helvetica', 'bold');
        let x = M;
        p.colunas.forEach((c, i) => {
            const w = larguras[i] ?? 10;
            pdf.text(c.titulo, c.alinhamento === 'direita' ? x + w - 1.5 : x + 1.5, y, {
                align: c.alinhamento === 'direita' ? 'right' : 'left',
            });
            x += w;
        });
        y += 4.5;
        pdf.setFont('helvetica', 'normal').setTextColor(...TINTA);
    };

    const rodape = () => {
        pdf.setFontSize(6.5).setTextColor(...CINZA);
        pdf.text(`Página ${paginas}`, W - M, H - 5, { align: 'right' });
        pdf.text('Gerado pelo Consultor Fiscal Inteligente — conferir antes de protocolar.', M, H - 5);
    };

    const linhaTabela = (valores: (string | number)[], destaque = false) => {
        if (y > H - 14) { rodape(); pdf.addPage(); cabecalho(); }
        if (destaque) {
            pdf.setFillColor(226, 232, 240);
            pdf.rect(M, y - 3.2, areaUtil, 4.6, 'F');
            pdf.setFont('helvetica', 'bold');
        }
        let x = M;
        valores.forEach((v, i) => {
            const w = larguras[i] ?? 10;
            const txt = fmtCell(v);
            const maxChars = Math.floor(w / 1.55);
            const recortado = txt.length > maxChars ? txt.slice(0, maxChars - 1) + '…' : txt;
            pdf.setFontSize(6.8);
            pdf.text(recortado, p.colunas[i]?.alinhamento === 'direita' ? x + w - 1.5 : x + 1.5, y, {
                align: p.colunas[i]?.alinhamento === 'direita' ? 'right' : 'left',
            });
            x += w;
        });
        if (destaque) pdf.setFont('helvetica', 'normal');
        pdf.setDrawColor(...BORDA);
        pdf.setLineWidth(0.1);
        pdf.line(M, y + 1.3, W - M, y + 1.3);
        y += 4.6;
    };

    cabecalho();
    for (const linha of p.linhas) linhaTabela(linha);
    if (p.totais) linhaTabela(p.totais, true);

    if (p.observacoes?.length) {
        if (y > H - 20 - p.observacoes.length * 3.5) { rodape(); pdf.addPage(); cabecalho(); }
        y += 3;
        pdf.setFontSize(6.5).setTextColor(...CINZA);
        for (const obs of p.observacoes) {
            pdf.text(`• ${obs}`, M, y);
            y += 3.5;
        }
        pdf.setTextColor(...TINTA);
    }
    rodape();
    pdf.save(p.fileName);
}
